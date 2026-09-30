from __future__ import annotations

import json
import urllib.error
import urllib.request

from tests.e2e.test_api import project_request
from tests.support.browser_harness import ROOT, SiteBrowser
from tests.support.operator_harness import running_operator_workspace
from tests.support.server import json_request, request

FIXTURES = ROOT / "tests/fixtures/print-estimation"
FORBIDDEN_PUBLIC = ("cost", "margin", "floor", "landed", "wage", "print-estimates/", "sha256", "inventory")


def put_bytes(url: str, data: bytes) -> int:
    req = urllib.request.Request(url, data=data, method="PUT", headers={"Content-Type": "application/octet-stream"})
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


def local_print_state(store_path) -> dict:
    return json.loads((store_path.parent / "print-estimation-dev.json").read_text(encoding="utf-8"))


def test_private_estimate_session_upload_analysis_and_attachment_over_real_http() -> None:
    model = (FIXTURES / "cube-20mm-binary.stl").read_bytes()
    with running_operator_workspace() as (storefront, operator, store_path):
        status, _, health = json_request(storefront + "/api/health")
        assert health["integrations"]["printEstimation"] is True

        status, headers, session = json_request(storefront + "/api/print-estimate", method="POST", payload={"action": "create", "options": {"material": "pla"}})
        assert status == 201
        assert headers["Cache-Control"] == "no-store"
        sid, token = session["sessionId"], session["token"]

        status, _, rejected = json_request(storefront + "/api/print-estimate", method="POST", payload={"action": "authorize-upload", "sessionId": sid, "token": token, "filename": "notes.txt", "size": 10})
        assert status == 400
        status, _, upload = json_request(storefront + "/api/print-estimate", method="POST", payload={"action": "authorize-upload", "sessionId": sid, "token": token, "filename": "bracket.stl", "size": len(model)})
        assert status == 200
        assert "path" not in upload
        assert put_bytes(upload["uploadUrl"] + "tampered", model) == 403, "signature covers the upload grant"
        assert put_bytes(upload["uploadUrl"], model + b"x" * 10) == 413, "declared size is enforced"
        assert put_bytes(upload["uploadUrl"], model) == 200
        assert put_bytes(upload["uploadUrl"], model) == 409, "private objects are never overwritten"

        status, _, estimate = json_request(storefront + "/api/print-estimate", method="POST", payload={"action": "analyze", "sessionId": sid, "token": token, "assetId": upload["assetId"], "options": {"material": "pla", "quantity": 2}})
        assert status == 200, estimate
        assert estimate["status"] == "ready"
        assert estimate["model"]["dimensionsMm"] == [20, 20, 20]
        assert estimate["price"]["low"] >= 15
        serialized = json.dumps(estimate).lower()
        assert not [term for term in FORBIDDEN_PUBLIC if term in serialized]

        assert json_request(storefront + f"/api/print-estimate?id={sid}")[0] == 401
        assert json_request(storefront + f"/api/print-estimate?id={sid}", headers={"X-Print-Estimate-Token": "A" * 43})[0] == 404
        status, _, current = json_request(storefront + f"/api/print-estimate?id={sid}", headers={"X-Print-Estimate-Token": token})
        assert status == 200 and current["price"] == estimate["price"]

        payload = project_request()
        payload["service"] = "print"
        payload["files"] = [{"name": "bracket.stl", "size": len(model), "type": "model/stl"}]
        status, _, created = json_request(storefront + "/api/request", method="POST", payload={"request": payload, "website": ""})
        assert status == 201
        status, _, completed = json_request(storefront + "/api/request", method="PATCH", payload={
            "id": created["id"], "request": payload,
            "uploadedFiles": [{"name": "bracket.stl", "size": len(model), "type": "model/stl", "path": None, "mode": "estimate"}],
            "printEstimate": {"sessionId": sid, "token": token},
        })
        assert status == 200, completed
        assert completed["printEstimate"] == {"attached": True}

        state = local_print_state(store_path)
        asset = next(item for item in state["assets"] if item["id"] == upload["assetId"])
        assert asset["requestId"] == created["id"]
        assert asset["retentionExpiresAt"] is None
        assert all(item["requestId"] == created["id"] for item in state["estimates"])
        status, _, _ = json_request(storefront + "/api/print-estimate", method="POST", payload={"action": "analyze", "sessionId": sid, "token": token, "assetId": upload["assetId"]})
        assert status == 410, "the anonymous capability ends at submission"


def test_browser_uploads_model_privately_once_and_submits_without_reupload() -> None:
    with running_operator_workspace() as (storefront, _operator, store_path):
        with SiteBrowser(viewport=(1280, 1000)) as site:
            page = site.page
            puts: list[str] = []
            page.on("request", lambda req: puts.append(req.url) if req.method == "PUT" else None)
            page.goto(storefront + "/order.html?service=print", wait_until="networkidle")
            page.locator("#next-button").click()
            page.locator("#project-title").fill("Workspace bracket")
            page.locator("#description").fill("Please print the uploaded bracket in PLA.")
            page.locator("#model-file").set_input_files(str(FIXTURES / "cube-20mm-binary.stl"))
            page.locator(".model-private-verified").wait_for(timeout=15_000)
            assert "Uploaded privately and verified" in page.locator("#model-card").inner_text()
            page.locator("#next-button").click()
            page.locator("#name").fill("Taylor Customer")
            page.locator("#email").fill("taylor@example.com")
            page.locator("#next-button").click()
            page.locator("#terms").check()
            page.locator("#submit-button").click()
            page.locator("#submission-state.visible").wait_for(timeout=15_000)
            assert page.locator("#confirmation-title").inner_text() == "Your project request is in."
            assert "were not uploaded" not in page.locator("#confirmation-copy").inner_text()
            assert len(puts) == 1, f"model must upload exactly once: {puts}"
            site.assert_no_page_errors()
        state = local_print_state(store_path)
        assert len(state["assets"]) == 1 and state["assets"][0]["requestId"]
        purposes = sorted(item["purpose"] for item in state["estimates"])
        assert purposes == ["preview", "submission"], purposes
        assert request(storefront + "/api/dev-private-file?op=get&path=x")[0] == 403
