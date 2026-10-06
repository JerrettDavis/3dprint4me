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


def seed_zip_pack(store_path: Path, request_id: str, *, foreign_request_id: str | None = None) -> dict:
    """Add a ready ZIP with two attached parts (and optionally a part of another request) to the local print store."""
    import secrets

    state_path = store_path.parent / "print-estimation-dev.json"
    files_root = store_path.parent / "print-private-files"
    state = json.loads(state_path.read_text(encoding="utf8"))
    template = next(row for row in state["assets"] if row["requestId"] == request_id)
    folder = f"print-estimates/est_{secrets.token_hex(16)}"
    (files_root / folder).mkdir(parents=True, exist_ok=True)

    def add(asset_id: str, name: str, content: bytes, **extra) -> dict:
        blob_path = f"{folder}/{secrets.token_hex(5)}-{name}"
        (files_root / blob_path).write_bytes(content)
        row = {**template, "id": asset_id, "originalName": name, "blobPath": blob_path, "sizeBytes": len(content), "declaredSizeBytes": len(content), "parentAssetId": None, "archiveEntry": None, "quantity": 1, "selected": False, "retentionHold": False, **extra}
        state["assets"].append(row)
        return row

    zip_id = "asset_" + secrets.token_hex(16)
    add(zip_id, "pack.zip", b"PK-seeded-zip", format="zip", state="ready", geometryMetrics={"format": "zip", "pack": {"ignored": [{"name": "views/1.png", "kind": "image"}]}})
    parts = {}
    for key, entry, quantity in (("base", "stl/base.stl", 3), ("lid", "stl/lid.stl", 2)):
        content = (FIXTURES / "cube-20mm-binary.stl").read_bytes() + key.encode()
        part_id = "asset_" + secrets.token_hex(16)
        add(part_id, entry.split("/")[-1], content, parentAssetId=zip_id, archiveEntry=entry, quantity=quantity, selected=True)
        parts[key] = {"assetId": part_id, "content": content}
    foreign = None
    if foreign_request_id:
        foreign_id = "asset_" + secrets.token_hex(16)
        add(foreign_id, "foreign.stl", b"foreign", requestId=foreign_request_id)
        foreign = foreign_id
    state_path.write_text(json.dumps(state), encoding="utf8")
    return {"zipId": zip_id, "parts": parts, "foreignAssetId": foreign}
