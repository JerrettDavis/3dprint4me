"""Cold recovery preflight must never overwrite an installed platform."""
import importlib.util
import io
import json
import hashlib
from pathlib import Path
import tarfile

import pytest

spec = importlib.util.spec_from_file_location('rebuild', Path(__file__).parents[2] / 'deploy/platform/rebuild-host.py')
rebuild = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rebuild)


def recovery_archive():
    files = {f'private/{name}': b'fixture' for name in rebuild.PRIVATE_NAMES}
    files['private/database.private.json'] = json.dumps({k: 'a'*48 for k in ['admin','owner','runtime']}).encode()
    files['databases/platform.dump'] = b'PGDMPfixture'
    files['databases/platform_live_recovered.dump'] = b'PGDMPfixture'
    manifest = {'version':1,'databases':['platform','platform_live_recovered'],
                'deploymentSelection': {'database_name':'platform_live_recovered','generation':'4a634eea-7a65-42dc-9b75-fce884ccdf1d','source_dump_sha256':'a'*64},
                'sha256':{k:hashlib.sha256(v).hexdigest() for k,v in files.items()}}
    files['manifest.json'] = json.dumps(manifest).encode()
    out = io.BytesIO()
    with tarfile.open(fileobj=out,mode='w') as tar:
        for name,data in files.items():
            item=tarfile.TarInfo(name);item.size=len(data);tar.addfile(item,io.BytesIO(data))
    return out.getvalue()


def test_rebuild_validates_exact_checkpoint_and_private_file_allowlist():
    data=recovery_archive()
    manifest,files=rebuild.checkpoint(data,hashlib.sha256(data).hexdigest())
    assert manifest['databases']==['platform','platform_live_recovered']
    assert len(files)==len(rebuild.PRIVATE_NAMES)+2
    with pytest.raises(ValueError):rebuild.checkpoint(data,'0'*64)


def test_rebuild_refuses_existing_resources_and_dirty_destination(tmp_path):
    root=tmp_path/'recovery';root.mkdir(mode=0o700)
    rebuild.destination(root)
    (root/'existing').write_text('do not overwrite')
    with pytest.raises(ValueError):rebuild.destination(root)
    with pytest.raises(ValueError):rebuild.destination(Path('/'))
    with pytest.raises(ValueError):rebuild.empty_docker(lambda args: b'production-resource')


def test_rebuild_docker_preflight_checks_containers_and_all_persistent_volumes():
    calls=[]
    rebuild.empty_docker(lambda args: calls.append(args) or b'')
    assert any('ps' in c and '-a' in c for c in calls)
    assert sum('volume' in c for c in calls)==3
    assert all('rm' not in c and 'down' not in c for c in calls)
