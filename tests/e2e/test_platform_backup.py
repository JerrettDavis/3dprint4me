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


def test_recovery_command_streams_input_without_accumulating_it():
    import sys
    data=io.BytesIO(b'private-model-bytes')
    result=backup.command([sys.executable,'-c','import sys,hashlib; print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())'],data=data)
    assert result.strip().decode()==hashlib.sha256(b'private-model-bytes').hexdigest()


def test_stream_snapshot_copy_records_destination_identity(monkeypatch):
    source_id='a'*64;destination_id='b'*64;payload=b'{"type":"header","version":1}\n'
    class Input(io.BytesIO):
        def close(self):pass
    class Producer:
        stdin=Input();stdout=io.BytesIO(payload)
        def kill(self):pass
        def wait(self,timeout=None):return 0
        def poll(self):return 0
    monkeypatch.setattr(backup.subprocess,'Popen',lambda *a,**k:Producer())
    calls=[]
    def command(args,**kwargs):
        calls.append(args)
        if 'backup' in args:
            while kwargs['data'].read(65536):pass
            return json.dumps({'message_type':'summary','snapshot_id':source_id}).encode()
        if 'snapshots' in args:return json.dumps([{'id':destination_id,'original':source_id}]).encode()
        return b''
    monkeypatch.setattr(backup,'command',command)
    monkeypatch.setattr(backup,'stream_hash',lambda args,env:hashlib.sha256(payload).hexdigest())
    config={'ssh_host':'owner@example','stores':[{'repository':'/first'}],'password_file':'/key'}
    result=backup.backup_objects(config,b'[]',[(['restic','--repo','/first'],{}),(['restic','--repo','/second'],{})],'3dprint4me/platform-20261021T000000Z.tar')
    assert result['snapshots']==[source_id,destination_id]
    assert result['roundtrip_verified']
    assert any('copy' in args and '--from-password-file' in args for args in calls)
    assert any('snapshots' in args and str(Path('/'+result['filename']).absolute()) in args for args in calls)


def test_required_object_inventory_uses_same_snapshot_as_dump(monkeypatch):
    class Input(io.StringIO):
        def close(self):pass
    class Keeper:
        stdin=Input();stdout=io.StringIO('00000003-0000001A-1\n["3DP-id/model.stl"]\n')
        def kill(self):pass
        def poll(self):return 0
        def communicate(self,timeout=None):return ('','')
    keeper=Keeper()
    monkeypatch.setattr(exporter.subprocess,'Popen',lambda *a,**k:keeper)
    with exporter.database_snapshot('c'*64,'platform') as (snapshot,paths):
        assert snapshot=='00000003-0000001A-1'
        assert paths==['3DP-id/model.stl']
        assert 'REPEATABLE READ' in keeper.stdin.getvalue()
        assert "NOT IN ('pending_upload','deleted')" in keeper.stdin.getvalue()
        assert "FROM quick_inquiries" in keeper.stdin.getvalue()
        assert "status='submitted'" in keeper.stdin.getvalue()
        assert "f->>'mode'='signed'" not in keeper.stdin.getvalue()
        assert "f->>'mode' IS DISTINCT FROM 'estimate'" in keeper.stdin.getvalue()
