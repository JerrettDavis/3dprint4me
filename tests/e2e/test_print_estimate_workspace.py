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


def slicer_env(mode: str = "ok") -> dict[str, str]:
    return {
        "SLICER_PROVIDER": "local-cli",
        "SLICER_BIN": str(FIXTURES / "fake-slicer.mjs"),
        "SLICER_ARGS": json.dumps(["--export-gcode", f"--mode={mode}", "--output", "{output}", "{model}"]),
        "SLICER_PROFILE_ID": "pla-0.20mm-standard",
    }


def run_worker(store_path, env: dict[str, str]) -> dict:
    import os
    import subprocess

    result = subprocess.run(
        ["node", "scripts/print-estimate-worker.mjs", "--once"], cwd=ROOT, capture_output=True, text=True, timeout=60,
        env={**os.environ, "LOCAL_DEV": "1", "OPERATOR_DEV_AUTH": "1", "OPERATOR_DEV_STORE_PATH": str(store_path), **env},
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout.strip().splitlines()[-1])


def test_async_slicer_job_narrows_the_estimate_and_never_blocks_submission() -> None:
    model = (FIXTURES / "cube-20mm-binary.stl").read_bytes()
    env = slicer_env()
    with running_operator_workspace(env) as (storefront, _operator, store_path):
        _, _, session = json_request(storefront + "/api/print-estimate", method="POST", payload={"action": "create", "options": {}})
        sid, token = session["sessionId"], session["token"]
        _, _, upload = json_request(storefront + "/api/print-estimate", method="POST", payload={"action": "authorize-upload", "sessionId": sid, "token": token, "filename": "cube.stl", "size": len(model)})
        assert put_bytes(upload["uploadUrl"], model) == 200
        _, _, geometry = json_request(storefront + "/api/print-estimate", method="POST", payload={"action": "analyze", "sessionId": sid, "token": token, "assetId": upload["assetId"]})
        assert geometry["slice"] == {"status": "pending"}, "exact slicing is queued, never awaited"

        summary = run_worker(store_path, env)
        assert summary["ready"] == 1

        _, _, status = json_request(storefront + f"/api/print-estimate?id={sid}", headers={"X-Print-Estimate-Token": token})
        assert status["slice"]["status"] == "ready"
        assert status["slice"]["confidence"] == "better"
        geometry_width = geometry["price"]["high"] - geometry["price"]["low"]
        slice_width = status["slice"]["price"]["high"] - status["slice"]["price"]["low"]
        assert slice_width < geometry_width
        slice_row = next(item for item in local_print_state(store_path)["estimates"] if item["estimatorType"] == "slicer")
        assert (slice_row["engine"], slice_row["engineVersion"], slice_row["profileId"]) == ("prusaslicer-cli", "9.9.9", "pla-0.20mm-standard")


def test_failed_slicer_stays_private_and_the_request_still_submits() -> None:
    model = (FIXTURES / "cube-20mm-binary.stl").read_bytes()
    env = slicer_env("fail")
    with running_operator_workspace(env) as (storefront, _operator, store_path):
        _, _, session = json_request(storefront + "/api/print-estimate", method="POST", payload={"action": "create", "options": {}})
        sid, token = session["sessionId"], session["token"]
        _, _, upload = json_request(storefront + "/api/print-estimate", method="POST", payload={"action": "authorize-upload", "sessionId": sid, "token": token, "filename": "cube.stl", "size": len(model)})
        assert put_bytes(upload["uploadUrl"], model) == 200
        json_request(storefront + "/api/print-estimate", method="POST", payload={"action": "analyze", "sessionId": sid, "token": token, "assetId": upload["assetId"]})
        assert run_worker(store_path, env)["retrying"] == 1
        _, _, status = json_request(storefront + f"/api/print-estimate?id={sid}", headers={"X-Print-Estimate-Token": token})
        assert status["slice"]["status"] == "pending", "a retrying job is still pending publicly"
        assert "exit" not in json.dumps(status).lower()
        job = local_print_state(store_path)["jobs"][0]
        assert job["lastErrorCategory"] == "slicer_failed"

        payload = project_request()
        payload["files"] = [{"name": "cube.stl", "size": len(model), "type": "model/stl"}]
        _, _, created = json_request(storefront + "/api/request", method="POST", payload={"request": payload, "website": ""})
        status_code, _, completed = json_request(storefront + "/api/request", method="PATCH", payload={
            "id": created["id"], "request": payload,
            "uploadedFiles": [{"name": "cube.stl", "size": len(model), "type": "model/stl", "path": None, "mode": "estimate"}],
            "printEstimate": {"sessionId": sid, "token": token},
        })
        assert status_code == 200 and completed["printEstimate"]["attached"] is True
