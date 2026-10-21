"""Recovery controller security contracts; no production services required."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile

import pytest

spec = importlib.util.spec_from_file_location("platform_backup", Path(__file__).parents[2] / "deploy/platform/backup-controller.py")
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)
export_spec=importlib.util.spec_from_file_location('platform_export',Path(__file__).parents[2]/'deploy/platform/export-backup.py')
exporter=importlib.util.module_from_spec(export_spec)
export_spec.loader.exec_module(exporter)


def archive(extra=None, tamper=False):
    files = {"databases/platform.dump": b"PGDMPfixture", "private/api.env": b"secret fixture"}
    manifest = {"version": 1, "databases": ["platform"], "sha256": {k: hashlib.sha256(v).hexdigest() for k, v in files.items()}}
    if tamper:
        files["private/api.env"] = b"tampered"
    files["manifest.json"] = json.dumps(manifest).encode()
    if extra:
        files.update(extra)
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode="w") as tar:
        for name, value in files.items():
            entry = tarfile.TarInfo(name)
            entry.size = len(value)
            tar.addfile(entry, io.BytesIO(value))
    return out.getvalue()


def test_recovery_archive_integrity_and_path_validation():
    assert backup.verify_archive(archive())["databases"] == ["platform"]
    for data in [archive(tamper=True), archive({"../escape": b"x"}), archive({"unhashed": b"x"})]:
        with pytest.raises(ValueError):
            backup.verify_archive(data)


def test_recovery_subprocess_bounds_and_redacts_failure():
    import sys
    with pytest.raises(ValueError, match="Output bound"):
        backup.command([sys.executable, "-c", "print('x'*5000)"], limit=100)
    with pytest.raises(ValueError, match="Command failed"):
        backup.command([sys.executable, "-c", "import sys; print('private'); sys.exit(1)"])


def test_durable_selection_overrides_stale_prepared_candidate_manifest():
    selection={'database_name':'platform_live_recovered','generation':'4a634eea-7a65-42dc-9b75-fce884ccdf1d','source_dump_sha256':'a'*64}
    assert exporter.selected_databases({'phase':'prepared'},selection)==['platform','platform_live_recovered']
    assert exporter.selected_databases({'phase':'prepared'},None)==['platform']
    with pytest.raises(ValueError):
        exporter.selected_databases({'phase':'prepared'},{**selection,'database_name':'unrelated'})
