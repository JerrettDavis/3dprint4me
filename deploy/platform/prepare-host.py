"""Prepare only this platform's private directories and health volumes.

Preview by default. Run as the Docker operator with --apply; configuration contents are never read.
Authentication uses hosted GitHub; no local identity service is required.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess


def run(args):
    return subprocess.run(args, capture_output=True, check=True, timeout=30).stdout


def prepare(root, user_id, apply=False):
    if not root.is_absolute() or root.resolve() != root or root.is_symlink() or root in (Path("/"), Path("/home")):
        raise ValueError("Explicit resolved platform root required")
    if not root.is_dir() or root.stat().st_uid != user_id or root.stat().st_mode & 0o077:
        raise ValueError("Existing owner-only platform root required")
    plan = {"health_volumes": ["3dprint4me-health-jobs", "3dprint4me-health-slicer"], "apply": apply}
    if not apply:
        return plan
    for name, uid, mode in [("jobs", 1000, "0700"), ("slicer", 10001, "2750")]:
        volume = "3dprint4me-health-" + name
        inspected = subprocess.run(["docker", "volume", "inspect", volume], capture_output=True, timeout=20)
        if inspected.returncode:
            run(["docker", "volume", "create", "--label", "app=3dprint4me", volume])
        elif json.loads(inspected.stdout)[0].get("Labels", {}).get("app") != "3dprint4me":
            raise ValueError("Existing health volume identity differs")
        # Ownership initialization is confined to a new named health volume,
        # never a host filesystem mount or an existing application database.
        image = "node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392"
        run(["docker", "run", "--rm", "--network", "none", "--read-only", "--user", "0", "--cap-drop", "ALL", "--cap-add", "CHOWN", "--cap-add", "FOWNER", "--mount", "type=volume,source=" + volume + ",target=/health", image, "node", "-e", "const f=require('node:fs');f.chownSync('/health'," + str(uid) + ",1000);f.chmodSync('/health',parseInt('" + mode + "',8));"])
    return plan


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--owner-uid", type=int, default=1000)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(args.root, args.owner_uid, args.apply)))
    except Exception:
        raise SystemExit("Host preparation failed; private diagnostics suppressed.")
