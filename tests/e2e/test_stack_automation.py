"""Configuration/command contracts never deploy or inspect real credentials."""
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath

import pytest

ROOT=Path(__file__).parents[2]


def load(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'deploy/platform'/f'{name}.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


def test_inventory_covers_every_runtime_and_every_source_exists():
    inventory=json.loads((ROOT/'deploy/platform/stack.json').read_text())
    ids=[item['id'] for item in inventory['components']]
    assert len(ids)==len(set(ids))
    assert {'storefront','operator','api','database','private-files','jobs','slicer','tunnel','public-status','operations','status-monitor','status-collector','encrypted-backups','github-identity','email-webhooks-payments','home-assistant'}==set(ids)
    for item in inventory['components']:
        assert (ROOT/item['source']).is_file()
        assert item['recovery']


def test_cloud_preview_never_executes_and_operations_requires_protection(monkeypatch):
    cloud=load('deploy-cloud')
    monkeypatch.setattr(cloud.subprocess,'run',lambda *a,**k:pytest.fail('Preview executed a process'))
    for target in [*cloud.TARGETS,'monitor']:
        assert cloud.deploy(target)['apply'] is False
    with pytest.raises(ValueError,match='authentication'):cloud.deploy('operations',True)
    assert 'status/wrangler.jsonc' in cloud.plan('monitor')[-1].replace('\\','/')


def test_status_units_use_matching_private_config_and_refuse_injected_names():
    installer=load('install-status-timer')
    result=installer.units(PurePosixPath('/home/owner/platform'),'owner')
    service=result['3dprint4me-status.service']
    assert '/status-collector.private.json' in service
    assert 'User=owner' in service
    assert 'REPLACE_' not in service
    assert 'Unit=3dprint4me-status.service' in result['3dprint4me-status.timer']
    for root,user in [(PurePosixPath('/home/owner/a b'),'owner'),(PurePosixPath('/home/owner/platform'),'owner\nExecStart=bad')]:
        with pytest.raises(ValueError):installer.units(root,user)


@pytest.mark.skipif(os.name=='nt',reason='Fresh-host apply contract targets Linux')
def test_fresh_setup_applies_all_migrations_and_never_starts_writers_or_tunnel(tmp_path,monkeypatch):
    bootstrap=load('bootstrap-host');root=tmp_path/'platform';root.mkdir(mode=0o700)
    source=root/'candidate-source';migrations=source/'neon/migrations';migrations.mkdir(parents=True)
    (migrations/'001_test.sql').write_text('SELECT 1;')
    for name in set(bootstrap.rebuild.PRIVATE_NAMES)-{'database-target.private.json','compose.env'}:
        content='EXAMPLE=value\n'
        if name=='database.private.json':content=json.dumps({key:'a'*48 for key in ['admin','owner','runtime']})
        path=root/name;path.write_text(content);path.chmod(0o600)
    calls=[]
    def run(args,data=None,timeout=180):
        calls.append((args,data))
        if 'rev-parse' in args:return b'a'*40+b'\n'
        if 'ps' in args and 'postgres' in args:return b'c'*64+b'\n'
        return b''
    monkeypatch.setattr(bootstrap.rebuild,'run',run)
    monkeypatch.setattr(bootstrap.rebuild,'empty_docker',lambda:None)
    result=bootstrap.bootstrap(root,'a'*40,'2610199',True)
    assert result['setup']=='passed'
    assert all(not result[k] for k in ['api_started','writers_started','tunnel_started'])
    assert sum(data==b'SELECT 1;' for args,data in calls)==2
    assert not any('up' in args and any(service in args for service in ['api','jobs','slicer','tunnel']) for args,data in calls)
    target=json.loads((root/'database-target.private.json').read_text())
    assert target['databaseUrl'].startswith('postgresql://platform_app:')
    assert (root/'api.env').stat().st_mode&0o077==0
