from __future__ import annotations

import tempfile
from pathlib import Path

from tests.support.server import json_request, running_server


def test_received_inquiry_enters_inbox_and_operator_can_prepare_and_share_without_sending() -> None:
    origin = "http://127.0.0.1:4180"
    with tempfile.TemporaryDirectory(prefix="3dp-inquiry-api-") as directory:
        with running_server(extra_env={"OPERATOR_DEV_AUTH": "1", "OPERATOR_ALLOWED_ORIGINS": origin,
                                       "OPERATOR_DEV_STORE_PATH": str(Path(directory) / "work.json")}) as base:
            key = "a" * 64
            status, _, created = json_request(base + "/api/inquiry", method="POST", payload={
                "submissionKey": key, "inquiry": {"replyEmail": "customer@example.com", "message": "Can you help with a part?"}, "files": []})
            assert status == 201
            status, _, accepted = json_request(base + "/api/inquiry", method="PATCH", payload={"id": created["id"], "submissionKey": key})
            assert status == 200 and accepted["live"]
            headers = {"Origin": origin}
            status, _, inbox = json_request(base + "/api/operator-work?kind=inquiry", headers=headers)
            assert status == 200 and len(inbox["items"]) == 1
            item = inbox["items"][0]
            assert item["kind"] == "inquiry" and item["requestId"] is None
            status, _, invite = json_request(base + "/api/operator-work?resource=inquiries", method="POST", headers=headers,
                                             payload={"action": "invite", "workId": item["id"]})
            assert status == 200 and "#inquiry=" in invite["url"]
            assert invite["url"].startswith(base + "/order/#inquiry=")
            status, _, prefill = json_request(base + "/api/inquiry?kind=handoff", method="POST", payload={"action": "read", "token": invite["token"]})
            assert status == 200 and prefill["inquiry"]["replyEmail"] == "customer@example.com"
            assert "notes" not in prefill and "token" not in prefill
            status, _, prepared = json_request(base + "/api/operator-work?resource=inquiries", method="POST",
                                               headers={**headers, "Idempotency-Key": "test-key-00000000"},
                                               payload={"action": "prepare", "command": {"workId": item["id"], "revision": 1,
                                                                                         "title": "Replacement part", "service": "design"}})
            assert status == 200 and prepared["workId"] == item["id"]
            status, _, detail = json_request(base + f"/api/operator-work?id={item['id']}", headers=headers)
            assert status == 200 and detail["item"]["projectDraft"]
            assert detail["request"]["consent"] is False and detail["request"]["estimate"] is None
