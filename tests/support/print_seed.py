from __future__ import annotations

import json
import os
import subprocess
import urllib.request
from pathlib import Path

from tests.support.server import ROOT, json_request

FIXTURES = ROOT / "tests/fixtures/print-estimation"


def fake_slicer_env(mode: str = "ok") -> dict[str, str]:
    return {
        "SLICER_PROVIDER": "local-cli",
        "SLICER_BIN": str(FIXTURES / "fake-slicer.mjs"),
        "SLICER_ARGS": json.dumps(["--export-gcode", f"--mode={mode}", "--output", "{output}", "{model}"]),
        "SLICER_PROFILE_ID": "pla-0.20mm-standard",
    }


def run_slice_worker(store_path: Path, env: dict[str, str]) -> dict:
    result = subprocess.run(
        ["node", "scripts/print-estimate-worker.mjs", "--once"], cwd=ROOT, capture_output=True, text=True, timeout=60,
        env={**os.environ, "LOCAL_DEV": "1", "OPERATOR_DEV_AUTH": "1", "OPERATOR_DEV_STORE_PATH": str(store_path), **env},
    )
    assert result.returncode == 0, result.stderr
    lines = result.stdout.strip().splitlines()
    return json.loads(lines[-1]) if lines else {}


def seed_print_request(storefront: str, store_path: Path, *, title: str, model_name: str = "cube-20mm-binary.stl", options: dict | None = None, slice_env: dict[str, str] | None = None) -> dict:
    """Create a submitted print request whose model was privately uploaded and estimated first."""
    model = (FIXTURES / model_name).read_bytes()
    options = options or {"material": "pla", "quantity": 4, "quality": "standard"}
    _, _, session = json_request(storefront + "/api/print-estimate", method="POST", payload={"action": "create", "options": options})
    sid, token = session["sessionId"], session["token"]
    _, _, upload = json_request(storefront + "/api/print-estimate", method="POST", payload={"action": "authorize-upload", "sessionId": sid, "token": token, "filename": "alignment-bracket.stl", "size": len(model)})
    urllib.request.urlopen(urllib.request.Request(upload["uploadUrl"], data=model, method="PUT"), timeout=5).close()
    _, _, estimate = json_request(storefront + "/api/print-estimate", method="POST", payload={"action": "analyze", "sessionId": sid, "token": token, "assetId": upload["assetId"], "options": options})
    if slice_env:
        run_slice_worker(store_path, slice_env)
    json_request(storefront + "/api/print-estimate", method="POST", payload={"action": "finalize", "sessionId": sid, "token": token, "assetId": upload["assetId"], "options": options})
    from tests.e2e.test_api import project_request

    payload = project_request()
    payload.update({"projectTitle": title, "service": "print", "serviceLabel": "Print my model", "files": [{"name": "alignment-bracket.stl", "size": len(model), "type": "model/stl"}]})
    payload["specifications"] = {key: str(value) for key, value in options.items()}
    _, _, created = json_request(storefront + "/api/request", method="POST", payload={"request": payload, "website": ""})
    status, _, completed = json_request(storefront + "/api/request", method="PATCH", payload={
        "id": created["id"], "request": payload,
        "uploadedFiles": [{"name": "alignment-bracket.stl", "size": len(model), "type": "model/stl", "path": None, "mode": "estimate"}],
        "printEstimate": {"sessionId": sid, "token": token},
    })
    assert status == 200 and completed["printEstimate"]["attached"], completed
    return {"requestId": created["id"], "assetId": upload["assetId"], "model": model, "estimate": estimate}
