"""Recovery controller security contracts; no production services required."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import shlex
import types

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
    source_id='a'*64;destination_id='b'*64;payload=b'{"type":"header","version":1}\n{"type":"footer","version":1,"objects":0,"downloadedObjects":0,"downloadedBytes":0,"reusedObjects":0,"reusedBytes":0}\n'
    class Input(io.BytesIO):
        def close(self):pass
    class Producer:
        stdin=Input();stdout=io.BytesIO(payload)
        def kill(self):pass
        def wait(self,timeout=None):return 0
        def poll(self):return 0
    producers=[]
    def popen(args,**kwargs):
        producers.append(args)
        return Producer()
    monkeypatch.setattr(backup.subprocess,'Popen',popen)
    calls=[]
    def command(args,**kwargs):
        calls.append(args)
        if 'backup' in args:
            while kwargs['data'].read(65536):pass
            return json.dumps({'message_type':'summary','snapshot_id':source_id}).encode()
        if 'snapshots' in args:
            if '--tag' in args:return b'[]'
            return json.dumps([{'id':destination_id,'original':source_id}]).encode()
        return b''
    monkeypatch.setattr(backup,'command',command)
    monkeypatch.setattr(backup,'stream_hash',lambda args,env:hashlib.sha256(payload).hexdigest())
    config={'ssh_host':'owner@example','stores':[{'repository':'/first'}],'password_file':'/key'}
    result=backup.backup_objects(config,b'[]',[(['restic','--repo','/first'],{}),(['restic','--repo','/second'],{})],'3dprint4me/platform-20261021T000000Z.tar')
    assert result['snapshots']==[source_id,destination_id]
    assert result['roundtrip_verified']
    assert any('copy' in args and '--from-password-file' in args for args in calls)
    assert any('snapshots' in args and str(Path('/'+result['filename']).absolute()) in args for args in calls)
    # Execute the actual remote wrapper against an old runtime without Docker.
    code=shlex.split(producers[0][-1])[2]
    legacy=b'{"type":"header","version":1}\n{"type":"object","size":7}\n{"type":"footer","version":1,"objects":1}\n'
    process=Producer();process.stdout=io.BytesIO(legacy)
    out=io.BytesIO();remote_calls=[]
    def remote_popen(args,**kwargs):
        remote_calls.append(args)
        return process
    fake_subprocess=types.SimpleNamespace(DEVNULL=-3,PIPE=-1,run=lambda *a,**k:types.SimpleNamespace(returncode=3),Popen=remote_popen)
    fake_sys=types.SimpleNamespace(stdin=types.SimpleNamespace(buffer=io.BytesIO(b'{"type":"requirements","paths":[]}\n'+payload)),stdout=types.SimpleNamespace(buffer=out),exit=lambda value:(_ for _ in ()).throw(SystemExit(value)))
    import builtins
    def imports(name,*args,**kwargs):
        return {'sys':fake_sys,'subprocess':fake_subprocess}.get(name) or builtins.__import__(name,*args,**kwargs)
    with pytest.raises(SystemExit) as exit:
        exec(code,{'__builtins__':{**vars(builtins),'__import__':imports}})
    assert exit.value.code==0
    footer=json.loads(out.getvalue().splitlines()[-1])
    assert footer['downloadedBytes']==7 and footer['downloadedObjects']==1
    assert footer['exportMode']=='legacy-bootstrap'
    assert remote_calls[0][-1]=='export-stream'


def test_prior_checkpoint_selects_newest_completed_receipt(monkeypatch):
    old='a'*64;new='b'*64;obj='c'*64
    name='3dprint4me/platform-20261125T000000Z-objects.ndjson'
    receipt={'version':1,'filename':name.replace('-objects.ndjson','.tar'),'roundtrip_verified':True,
             'private_objects':{'snapshots':[obj,'d'*64],'filename':name,'sha256':'e'*64,'roundtrip_verified':True}}
    def command(args,**kwargs):
        if 'snapshots' in args:return json.dumps([{'id':old,'time':'2026-11-24T00:00:00Z'},{'id':new,'time':'2026-11-25T00:00:00Z'}]).encode()
        if 'ls' in args:return json.dumps({'type':'node','path':'/'+name.replace('-objects.ndjson','-checkpoint.json'),'node_type':'file'}).encode()
        assert new in args
        return json.dumps(receipt).encode()
    monkeypatch.setattr(backup,'command',command)
    assert backup.previous_objects(['restic'],{})==receipt['private_objects']
    receipt['private_objects']['filename']='../escape'
    with pytest.raises(ValueError):backup.previous_objects(['restic'],{})


def test_incremental_footer_rejects_incomplete_stream():
    reader=backup.ObjectStreamReader(io.BytesIO(b'{"type":"header","version":1}\n'))
    while reader.read(65536):pass
    with pytest.raises(ValueError):reader.finish()


def test_prior_stream_hash_failure_cannot_complete_checkpoint(monkeypatch):
    payload=b'{"type":"header","version":1}\n{"type":"footer","version":1,"objects":0,"downloadedObjects":0,"downloadedBytes":0,"reusedObjects":0,"reusedBytes":0}\n'
    class Input(io.BytesIO):
        def close(self):pass
    class Process:
        def __init__(self,data):self.stdin=Input();self.stdout=io.BytesIO(data)
        def kill(self):pass
        def wait(self,timeout=None):return 0
        def poll(self):return 0
    monkeypatch.setattr(backup,'previous_objects',lambda *a:{'snapshots':['a'*64],'filename':'3dprint4me/platform-20261125T000000Z-objects.ndjson','sha256':'0'*64})
    producer=Process(payload)
    monkeypatch.setattr(backup.subprocess,'Popen',lambda args,**kwargs:producer if args[0]=='ssh' else Process(b'tampered'))
    def command(args,**kwargs):
        assert 'backup' in args
        while kwargs['data'].read(65536):pass
        return json.dumps({'message_type':'summary','snapshot_id':'b'*64}).encode()
    monkeypatch.setattr(backup,'command',command)
    config={'ssh_host':'owner@example','stores':[{'repository':'/first'}],'password_file':'/key'}
    with pytest.raises(ValueError,match='Prior object stream failed'):
        backup.backup_objects(config,b'[]',[(['restic'],{})],'3dprint4me/platform-20261125T010000Z.tar')
    assert json.loads(producer.stdin.getvalue().splitlines()[0])=={'type':'requirements','paths':[]}


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
