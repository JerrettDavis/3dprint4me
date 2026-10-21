"""Fixed read-only host collector. Secrets live in its owner-only JSON config."""
import argparse
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import subprocess
import time
import urllib.request


def private_file(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_uid != os.getuid() or path.stat().st_mode & 0o077:
        raise ValueError("Private configuration required")
    return json.loads(path.read_text())


def collect(config):
    root = Path(config["platform_root"])
    if not root.is_absolute() or root.is_symlink() or root.resolve() != root or root.stat().st_uid != os.getuid() or root.stat().st_mode & 0o077:
        raise ValueError("Private platform root required")
    command = ["docker", "compose", "--env-file", str(root / "compose.env"), "-f", str(root / "candidate-source/deploy/platform/compose.yml")]
    details = {"database": False, "provider": "unknown", "files": False, "email": False, "estimates": False, "jobs": False}
    try:
        result = subprocess.run(command + ["exec", "-T", "api", "node", "scripts/platform-status.mjs"], capture_output=True, timeout=35, check=True)
        if len(result.stdout) > 4096:
            raise ValueError("Evidence bound")
        data = json.loads(result.stdout)
        if set(data) != set(details) or data["provider"] not in ("postgres", "neon", "unknown") or any(not isinstance(data[k], bool) for k in ("database", "jobs")) or any(data[k] is not None and not isinstance(data[k], bool) for k in ("files", "email", "estimates")):
            raise ValueError("Unexpected evidence")
        details = data
    except Exception:
        pass  # Missing application evidence remains failed, never guessed healthy.
    disk = os.statvfs(root)
    details["diskFreePercent"] = round(100 * disk.f_bavail / max(1, disk.f_blocks), 2)
    memory = {}
    for line in Path("/proc/meminfo").read_text().splitlines():
        key, value = line.split(":", 1)
        if key in ("MemAvailable", "MemTotal"):
            memory[key] = int(value.split()[0])
    if len(memory) == 2:
        details["memoryUsedPercent"] = round(100 * (1 - memory["MemAvailable"] / memory["MemTotal"]), 2)
    return details


def send(details, secret):
    if not isinstance(secret, str) or len(secret) < 48:
        raise ValueError("Status credential required")
    path = "/heartbeat/platform"
    body = json.dumps({"observedAt": time.time_ns() // 1_000_000, "nonce": secrets.token_hex(16), "details": details}, separators=(",", ":")).encode()
    signature = hmac.new(secret.encode(), path.encode() + b"\n" + body, hashlib.sha256).hexdigest()
    request = urllib.request.Request("https://status-api.3dprint4.me" + path, data=body, method="POST", headers={"Content-Type": "application/json", "X-Status-Signature": signature, "User-Agent": "3dprint4me-platform-monitor/1"})
    # No redirects and no retry of ambiguous report delivery.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    with urllib.request.build_opener(NoRedirect).open(request, timeout=10) as response:
        if response.status != 200:
            raise ValueError("Evidence rejected")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    try:
        config = private_file(args.config)
        send(collect(config), config["secret"])
        print("Aggregate platform evidence recorded.")
    except Exception:
        raise SystemExit("Platform evidence collection failed; private diagnostics suppressed.")
