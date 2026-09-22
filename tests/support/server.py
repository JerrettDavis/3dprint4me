from __future__ import annotations

import json
import os
import socket
import subprocess
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

ROOT = Path(__file__).resolve().parents[2]


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@contextmanager
def running_server(*, extra_env: dict[str, str] | None = None) -> Iterator[str]:
    port = free_port()
    env = {
        **os.environ,
        "PORT": str(port),
        "HOST": "127.0.0.1",
        "LOCAL_DEV": "1",
        "SITE_URL": f"http://127.0.0.1:{port}",
    }
    # Ensure tests prove the zero-account fallback rather than using accidental secrets.
    for key in [
        "DATABASE_URL", "BLOB_READ_WRITE_TOKEN",
        "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_STORAGE_BUCKET",
        "RESEND_API_KEY", "REQUEST_TO_EMAIL", "REQUEST_FROM_EMAIL",
        "REQUEST_WEBHOOK_URL", "REQUEST_WEBHOOK_SECRET", "STRIPE_SECRET_KEY",
    ]:
        env.pop(key, None)
    env.update(extra_env or {})
    process = subprocess.Popen(
        ["node", "scripts/dev-server.mjs"],
        cwd=ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
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
                    output = process.stdout.read() if process.stdout else ""
                    raise RuntimeError(f"Development server exited early:\n{output}")
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


def request(url: str, *, method: str = "GET", payload: Any | None = None, headers: dict[str, str] | None = None) -> tuple[int, dict[str, str], bytes]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    merged = {"Accept": "application/json", **(headers or {})}
    if data is not None:
        merged["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=merged)
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status, dict(response.headers.items()), response.read()
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers.items()), error.read()


def json_request(url: str, *, method: str = "GET", payload: Any | None = None, headers: dict[str, str] | None = None) -> tuple[int, dict[str, str], dict[str, Any]]:
    status, headers, body = request(url, method=method, payload=payload, headers=headers)
    return status, headers, json.loads(body.decode("utf-8"))
