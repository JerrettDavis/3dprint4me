from __future__ import annotations

import os
import subprocess
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from tests.support.server import ROOT, request
from tests.support.ports import reserved_loopback_ports


@contextmanager
def running_operator_workspace(extra_env: dict[str, str] | None = None) -> Iterator[tuple[str, str, Path]]:
    with reserved_loopback_ports(2) as reservations:
        storefront_port, operator_port = [held.getsockname()[1] for held in reservations]
        directory = tempfile.TemporaryDirectory(prefix="3dp-workspace-")
        store_path = Path(directory.name) / "operator-dev.json"
        env = {**os.environ, "STOREFRONT_PORT": str(storefront_port), "OPERATOR_PORT": str(operator_port), "OPERATOR_DEV_STORE_PATH": str(store_path), **(extra_env or {})}
        for held in reservations:held.close()
        process = subprocess.Popen(["node", "scripts/dev-workspace.mjs"], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        storefront = f"http://127.0.0.1:{storefront_port}"
        operator = f"http://127.0.0.1:{operator_port}"
        try:
            deadline = time.monotonic() + 12
            while time.monotonic() < deadline:
                try:
                    operator_status, _, operator_body = request(operator + "/")
                    if request(storefront + "/api/health")[0] == 200 and operator_status == 200 and b'id="workspace"' in operator_body:
                        if process.poll() is not None:raise RuntimeError("Workspace exited after readiness")
                        break
                except Exception:
                    if process.poll() is not None:
                        detail=process.stdout.read() if process.stdout else ""
                        reason="port already in use" if "EADDRINUSE" in detail else "process exited"
                        raise RuntimeError(f"Operator workspace unavailable ({reason})")
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
