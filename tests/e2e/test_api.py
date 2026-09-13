from __future__ import annotations

import json
import re
from pathlib import Path

from tests.support.server import json_request, request, running_server

ROOT = Path(__file__).resolve().parents[2]


def project_request() -> dict:
    return {
        "projectTitle": "Three-color equipment label",
        "service": "print",
        "serviceLabel": "Print my model",
        "description": "Print three durable labels from the linked model for indoor equipment identification.",
        "modelUrl": "https://www.printables.com/model/123456-equipment-label",
        "deadline": None,
        "estimate": {
            "low": 28,
            "high": 42,
            "formatted": "$28–$42",
            "currency": "USD",
            "confidence": "rough",
            "breakdown": {"material": "PETG", "quantity": "3"},
        },
        "specifications": {"material": "petg", "colors": "3", "quantity": "3"},
        "contact": {
            "name": "Jordan Customer",
            "email": "JORDAN@example.com",
            "phone": None,
            "preferredContact": "email",
            "address": None,
        },
        "files": [],
        "consent": True,
        "userAgent": "3dprint4.me automated verification",
    }


def test_local_server_pages_security_and_request_lifecycle() -> None:
    log = ROOT / "data/dev-requests.ndjson"
    log.unlink(missing_ok=True)

    with running_server() as base_url:
        for route in ["/", "/services.html", "/portfolio.html", "/about.html", "/order.html", "/privacy.html", "/terms.html", "/services"]:
            status, headers, body = request(base_url + route)
            normalized_headers = {key.lower(): value for key, value in headers.items()}
            assert status == 200, route
            assert b"3dprint4.me" in body
            assert normalized_headers["x-content-type-options"] == "nosniff"
            assert normalized_headers["x-frame-options"] == "DENY"
            assert "text/html" in normalized_headers["content-type"]

        status, _, body = request(base_url + "/definitely-missing")
        assert status == 404
        assert b"This page does not exist" in body

        status, _, health = json_request(base_url + "/api/health")
        assert status == 200
        assert health["ok"] is True
        assert health["integrations"] == {"supabase": False, "email": False, "webhook": False, "stripe": False}

        status, _, created = json_request(
            base_url + "/api/request",
            method="POST",
            payload={"action": "create", "request": project_request(), "website": ""},
        )
        assert status == 201
        assert re.fullmatch(r"3DP-\d{8}-[A-F0-9]{20}", created["id"])
        assert created == {"id": created["id"], "mode": "local", "live": False}

        status, _, error = json_request(
            base_url + "/api/request",
            method="POST",
            payload={"action": "complete", "id": created["id"], "request": project_request(), "uploadedFiles": []},
        )
        assert status == 400
        assert error["error"] == "Use POST to create a project request."

        status, _, completed = json_request(
            base_url + "/api/request",
            method="PATCH",
            payload={"action": "complete", "id": created["id"], "request": project_request(), "uploadedFiles": []},
        )
        assert status == 200
        assert completed["id"] == created["id"]
        assert completed["mode"] == "local"
        assert completed["live"] is False
        assert completed["integrations"] == {"database": False, "email": False, "webhook": False}

        invalid = project_request()
        invalid["contact"]["email"] = "not-an-email"
        status, _, error = json_request(base_url + "/api/request", method="POST", payload={"request": invalid})
        assert status == 400
        assert error["error"] == "A valid contact email is required."

        status, _, error = json_request(
            base_url + "/api/upload-url",
            method="POST",
            payload={"requestId": created["id"], "filename": "part.stl", "contentType": "model/stl", "size": 100},
        )
        assert status == 503
        assert error["error"] == "The service could not complete this request."

        status, _, error = json_request(
            base_url + "/api/checkout",
            method="POST",
            payload={"requestId": created["id"], "projectTitle": "Example", "email": "jordan@example.com"},
        )
        assert status == 503
        assert error["error"] == "The service could not complete this request."

    entries = [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines() if line.strip()]
    matching = [entry for entry in entries if entry.get("id") == created["id"]]
    assert [entry["event"] for entry in matching] == ["create", "complete"]
    assert matching[0]["request"]["contact"]["email"] == "jordan@example.com"
