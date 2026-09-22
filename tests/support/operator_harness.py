from __future__ import annotations

import os
import subprocess
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from tests.support.server import ROOT, free_port, request


@contextmanager
def running_operator_workspace() -> Iterator[tuple[str, str, Path]]:
    storefront_port, operator_port = free_port(), free_port()
    directory = tempfile.TemporaryDirectory(prefix="3dp-workspace-")
    store_path = Path(directory.name) / "operator-dev.json"
    env = {**os.environ, "STOREFRONT_PORT": str(storefront_port), "OPERATOR_PORT": str(operator_port), "OPERATOR_DEV_STORE_PATH": str(store_path)}
    process = subprocess.Popen(["node", "scripts/dev-workspace.mjs"], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    storefront = f"http://127.0.0.1:{storefront_port}"
    operator = f"http://127.0.0.1:{operator_port}"
    try:
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            try:
                if request(storefront + "/api/health")[0] == 200 and request(operator + "/")[0] == 200:
                    break
            except Exception:
                if process.poll() is not None:
                    raise RuntimeError(process.stdout.read() if process.stdout else "Workspace exited early")
                time.sleep(0.08)
        else:
            raise TimeoutError("Operator workspace did not become ready")
        yield storefront, operator, store_path
    finally:
        process.terminate()
        try:
            process.wait(timeout=6)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        directory.cleanup()
