"""Server-level validation of the request lifecycle against a configured Supabase backend.

test_api.py exercises the zero-account local fallback. This module proves the same
Node server subprocess behaves correctly when SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
are actually configured, by standing in a minimal mock of the exact Supabase REST and
Storage endpoints lib/supabase.js calls and driving the real HTTP API end to end.
"""

from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import parse_qs, urlparse

from tests.support.server import free_port, json_request, request

ROOT = Path(__file__).resolve().parents[2]


class MockSupabase:
    """In-memory stand-in for the Supabase REST/Storage endpoints the app calls."""

    def __init__(self) -> None:
        self.rows: dict[str, dict[str, Any]] = {}
        self.requests: list[dict[str, Any]] = []

    def handle(self, method: str, path: str, headers: dict[str, str], body: bytes) -> tuple[int, dict[str, Any] | list[Any]]:
        parsed = urlparse(path)
        query = parse_qs(parsed.query)
        self.requests.append({"method": method, "path": path, "headers": headers})

        assert headers.get("apikey") == "mock-service-role-key", "service-role key must be sent as apikey"
        assert headers.get("authorization") == "Bearer mock-service-role-key"

        if parsed.path == "/rest/v1/service_requests" and method == "POST":
            payload = json.loads(body)
            self.rows[payload["id"]] = {**payload, "status": "draft"}
            return 201, {}

        if parsed.path == "/rest/v1/service_requests" and method == "GET":
            id_filter = next((v[0] for v in [query.get("id", [])] if v), None)
            row_id = id_filter.split("eq.", 1)[1] if id_filter and id_filter.startswith("eq.") else None
            row = self.rows.get(row_id)
            if not row:
                return 200, []
            return 200, [{"id": row["id"], "status": row["status"]}]

        if parsed.path == "/rest/v1/service_requests" and method == "PATCH":
            id_filter = query.get("id", [None])[0]
            status_filter = query.get("status", [None])[0]
            row_id = id_filter.split("eq.", 1)[1] if id_filter else None
            required_status = status_filter.split("eq.", 1)[1] if status_filter else None
            row = self.rows.get(row_id)
            if not row or row.get("status") != required_status:
                return 200, []
            payload = json.loads(body)
            row.update(payload)
            return 200, [row]

        match = re.match(r"^/storage/v1/object/upload/sign/([^/]+)/(.+)$", parsed.path)
        if match and method == "POST":
            bucket, object_path = match.groups()
            return 200, {"url": f"/object/upload/sign/{bucket}/{object_path}?token=mock-upload-token"}

        return 404, {"message": f"unhandled mock route {method} {path}"}


def _make_handler(mock: MockSupabase):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
            pass

        def _dispatch(self) -> None:
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else b""
            headers = {key.lower(): value for key, value in self.headers.items()}
            status, payload = mock.handle(self.command, self.path, headers, body)
            data = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self) -> None: self._dispatch()  # noqa: N802
        def do_POST(self) -> None: self._dispatch()  # noqa: N802
        def do_PATCH(self) -> None: self._dispatch()  # noqa: N802

    return Handler


@contextmanager
def mock_supabase_server() -> Iterator[tuple[str, MockSupabase]]:
    mock = MockSupabase()
    port = free_port()
    httpd = ThreadingHTTPServer(("127.0.0.1", port), _make_handler(mock))
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{port}", mock
    finally:
        httpd.shutdown()
        thread.join(timeout=5)


@contextmanager
def running_server_with_supabase(supabase_url: str) -> Iterator[str]:
    port = free_port()
    env = {
        **os.environ,
        "PORT": str(port),
        "HOST": "127.0.0.1",
        "LOCAL_DEV": "1",
        "SITE_URL": f"http://127.0.0.1:{port}",
        "SUPABASE_URL": supabase_url,
        "SUPABASE_SERVICE_ROLE_KEY": "mock-service-role-key",
        "SUPABASE_STORAGE_BUCKET": "service-files",
    }
    for key in ["RESEND_API_KEY", "REQUEST_TO_EMAIL", "REQUEST_FROM_EMAIL", "REQUEST_WEBHOOK_URL", "REQUEST_WEBHOOK_SECRET", "STRIPE_SECRET_KEY"]:
        env.pop(key, None)
    process = subprocess.Popen(
        ["node", "scripts/dev-server.mjs"], cwd=ROOT, env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    base_url = f"http://127.0.0.1:{port}"
    try:
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            try:
                request(base_url + "/api/health")
                break
            except Exception:
                if process.poll() is not None:
                    raise RuntimeError(f"Development server exited early:\n{process.stdout.read() if process.stdout else ''}")
                time.sleep(0.08)
        else:
            raise TimeoutError("Development server did not become ready")
        yield base_url
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def project_request() -> dict:
    return {
        "projectTitle": "Signed-upload verification bracket",
        "service": "print",
        "serviceLabel": "Print my model",
        "description": "Server-level verification of the Supabase-backed request lifecycle.",
        "modelUrl": "https://www.printables.com/model/123456-verification-bracket",
        "estimate": {"low": 28, "high": 42, "formatted": "$28–$42", "currency": "USD", "confidence": "rough", "breakdown": {}},
        "specifications": {"material": "petg"},
        "contact": {"name": "Jordan Customer", "email": "jordan@example.com"},
        "files": [],
        "consent": True,
    }


def test_health_reports_supabase_configured() -> None:
    with mock_supabase_server() as (supabase_url, _mock), running_server_with_supabase(supabase_url) as base_url:
        status, _, health = json_request(base_url + "/api/health")
        assert status == 200
        assert health["integrations"]["supabase"] is True
        assert health["integrations"]["email"] is False
        assert health["integrations"]["stripe"] is False


def test_full_request_lifecycle_persists_to_supabase_and_gates_uploads() -> None:
    with mock_supabase_server() as (supabase_url, mock), running_server_with_supabase(supabase_url) as base_url:
        # 1. Uploading against a request that does not exist yet is rejected.
        status, _, error = json_request(
            base_url + "/api/upload-url", method="POST",
            payload={"requestId": "3DP-20260101-0000000000000000000A", "filename": "bracket.stl", "contentType": "model/stl", "size": 1000},
        )
        assert status == 404
        assert "does not exist" in error["error"]

        # 2. Create the draft request. The API is live (Supabase configured).
        status, _, created = json_request(
            base_url + "/api/request", method="POST",
            payload={"action": "create", "request": project_request(), "website": ""},
        )
        assert status == 201
        assert created["mode"] == "supabase"
        assert created["live"] is True
        request_id = created["id"]
        assert mock.rows[request_id]["status"] == "draft"
        assert mock.rows[request_id]["contact_email"] == "jordan@example.com"

        # 3. Now that a draft row exists, a signed upload URL can be minted for it.
        status, _, upload = json_request(
            base_url + "/api/upload-url", method="POST",
            payload={"requestId": request_id, "filename": "bracket v2.stl", "contentType": "model/stl", "size": 51200},
        )
        assert status == 200
        assert upload["mode"] == "signed"
        assert upload["path"].startswith(f"{request_id}/")
        assert upload["path"].endswith("bracket v2.stl")
        assert upload["uploadUrl"].startswith(supabase_url)
        assert "token=mock-upload-token" in upload["uploadUrl"]

        # A path traversal / mismatched extension attempt is rejected before it ever reaches Supabase.
        status, _, error = json_request(
            base_url + "/api/upload-url", method="POST",
            payload={"requestId": request_id, "filename": "payload.exe", "contentType": "application/octet-stream", "size": 100},
        )
        assert status == 400
        assert "unsupported file type" in error["error"]

        # 4. Complete the request; the draft row transitions to submitted.
        status, _, completed = json_request(
            base_url + "/api/request", method="PATCH",
            payload={
                "action": "complete", "id": request_id, "request": project_request(),
                "uploadedFiles": [{"name": "bracket v2.stl", "size": 51200, "type": "model/stl", "path": upload["path"], "mode": "signed"}],
            },
        )
        assert status == 200
        assert completed["integrations"]["database"] is True
        assert mock.rows[request_id]["status"] == "submitted"
        assert mock.rows[request_id]["uploaded_files"][0]["path"] == upload["path"]

        # 5. Completing the same request a second time is rejected (no double-submission).
        status, _, error = json_request(
            base_url + "/api/request", method="PATCH",
            payload={"action": "complete", "id": request_id, "request": project_request(), "uploadedFiles": []},
        )
        assert status == 409
        assert "already been completed" in error["error"]

        # 6. Uploads are no longer accepted once the request left draft status.
        status, _, error = json_request(
            base_url + "/api/upload-url", method="POST",
            payload={"requestId": request_id, "filename": "late-file.stl", "contentType": "model/stl", "size": 1000},
        )
        assert status == 404

        # Every mock call carried the service-role credential; never a public/anon key.
        assert all(call["headers"].get("apikey") == "mock-service-role-key" for call in mock.requests)


def test_honeypot_field_is_silently_ignored_without_touching_supabase() -> None:
    with mock_supabase_server() as (supabase_url, mock), running_server_with_supabase(supabase_url) as base_url:
        status, _, created = json_request(
            base_url + "/api/request", method="POST",
            payload={"action": "create", "request": project_request(), "website": "http://spam.example"},
        )
        assert status == 201
        assert created["mode"] == "ignored"
        assert created["id"] not in mock.rows
        assert mock.requests == []
