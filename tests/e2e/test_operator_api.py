from __future__ import annotations

import tempfile
from pathlib import Path

from tests.e2e.test_api import project_request
from tests.support.server import json_request, running_server


def test_local_operator_api_ingests_reads_and_updates_work() -> None:
    origin = "http://127.0.0.1:4180"
    with tempfile.TemporaryDirectory(prefix="3dp-operator-") as directory:
        with running_server(extra_env={
            "OPERATOR_DEV_AUTH": "1",
            "OPERATOR_ALLOWED_ORIGINS": origin,
            "OPERATOR_DEV_STORE_PATH": str(Path(directory) / "operator-dev.json"),
        }) as base_url:
            status, _, created = json_request(base_url + "/api/request", method="POST", payload={"request": project_request(), "website": ""})
            assert status == 201
            status, _, completed = json_request(base_url + "/api/request", method="PATCH", payload={
                "id": created["id"], "request": project_request(), "uploadedFiles": []
            })
            assert status == 200
            assert completed["live"] is True

            headers = {"Origin": origin}
            status, _, session = json_request(base_url + "/api/operator-session", headers=headers)
            assert status == 200
            assert session == {"authenticated": True, "operator": {"id": "op_local_owner", "displayName": "Local owner", "role": "owner"}}

            status, _, inbox = json_request(base_url + "/api/operator-work?view=unacknowledged", headers=headers)
            assert status == 200
            assert len(inbox["items"]) == 1
            work = inbox["items"][0]
            assert work["requestId"] == created["id"]
            assert "description" not in work
            assert "contact" not in work

            status, _, updated = json_request(base_url + "/api/operator-work-update", method="PATCH", headers=headers, payload={
                "id": work["id"], "command": {"type": "acknowledge", "revision": 1}, "idempotencyKey": "e2e_acknowledge_1"
            })
            assert status == 200
            assert updated["item"]["acknowledged"] is True
            assert updated["item"]["revision"] == 2

            status, _, detail = json_request(base_url + f"/api/operator-work?id={work['id']}", headers=headers)
            assert status == 200
            assert detail["request"]["contact"]["email"] == "jordan@example.com"
            assert [event["type"] for event in detail["events"]] == ["work.created", "work.acknowledged"]


def test_operator_api_denies_missing_and_untrusted_origins() -> None:
    origin = "http://127.0.0.1:4180"
    with tempfile.TemporaryDirectory(prefix="3dp-operator-") as directory:
        with running_server(extra_env={
            "OPERATOR_DEV_AUTH": "1",
            "OPERATOR_ALLOWED_ORIGINS": origin,
            "OPERATOR_DEV_STORE_PATH": str(Path(directory) / "operator-dev.json"),
        }) as base_url:
            status, headers, body = json_request(base_url + "/api/operator-session")
            assert status == 403
            assert body["code"] == "origin_forbidden"
            assert "Access-Control-Allow-Origin" not in headers

            status, headers, body = json_request(base_url + "/api/operator-session", headers={"Origin": "https://evil.example"})
            assert status == 403
            assert body["code"] == "origin_forbidden"
            assert "Access-Control-Allow-Origin" not in headers
