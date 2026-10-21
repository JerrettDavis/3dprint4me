"""Explicit isolated PostgreSQL setup/backup/rebuild rehearsal (requires Docker).

Run: python tests/integration/platform_recovery_docker.py
Uses synthetic credentials, no network, no host mounts and memory-only database
storage. Compose/image-building/health-volume operations are intercepted; this
tests real PostgreSQL initialization, exported snapshots, dump restore and ACLs,
not a complete host or provider rebuild. It never targets existing containers.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import stat
import subprocess
import tempfile
import time
from types import SimpleNamespace
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
IMAGE='postgres:18-bookworm@sha256:afc7e2d441324c0388fa80c3d24f733b4194a4eb7f47dd8ee2b08eb1a24a647c'


def load(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'deploy/platform'/f'{name}.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


def command(args,data=None,env=None,timeout=180):
    return subprocess.run(args,input=data,env=env,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,check=True,timeout=timeout).stdout


class FixturePath(type(Path())):
    # Windows has no POSIX ownership/mode enforcement. Only synthetic fixture
    # paths use this adapter; the normal security gates have separate tests.
    def stat(self,**kwargs):
        value=super().stat(**kwargs)
        if os.name!='nt':return value
        return SimpleNamespace(st_mode=stat.S_IFMT(value.st_mode)|0o700,st_uid=0,st_size=value.st_size)


def main():
    bootstrap=load('bootstrap-host');rebuilder=load('rebuild-host');exporter=load('export-backup')
    release=command(['git','-C',str(ROOT),'rev-parse','HEAD']).decode().strip()
    credentials={key:secrets.token_urlsafe(36) for key in ['admin','owner','runtime']}
    containers=[]
    def start():
        env=os.environ.copy();env.update(POSTGRES_USER='platform_admin',POSTGRES_DB='postgres',POSTGRES_PASSWORD=credentials['admin'])
        identity=command(['docker','run','-d','--name','3dprint4me-recovery-test-'+secrets.token_hex(8),'--label','app=3dprint4me-recovery-test','--network','none','--memory','512m','--cpus','1','--tmpfs','/var/lib/postgresql:rw,nosuid,size=384m','--env','POSTGRES_USER','--env','POSTGRES_DB','--env','POSTGRES_PASSWORD',IMAGE],env=env).decode().strip()
        if not re.fullmatch('[a-f0-9]{64}',identity):raise ValueError('Unexpected fixture identity')
        containers.append(identity)
        for attempt in range(100):
            try:command(['docker','exec',identity,'pg_isready','-U','platform_admin']);return identity
            except subprocess.CalledProcessError:time.sleep(.2)
        raise ValueError('Fixture readiness failed')
    def fixture_runner(identity):
        def run(args,data=None,timeout=180):
            if args[:1]==['git']:
                if 'status' in args:return b''
                if 'rev-parse' in args:return release.encode()+b'\n'
                if 'archive' in args:return command(['git','-C',str(ROOT),'archive','--format=tar',release])
            if args[:2]==['docker','compose']:
                if 'ps' in args:return identity.encode()+b'\n'
                if 'build' in args or ('up' in args and args[-1]=='postgres'):return b''
                raise ValueError('Unexpected Compose operation')
            if args[:2]==['docker','exec']:
                if identity not in args:raise ValueError('Unrelated container refused')
                return command(args,data=data,timeout=timeout)
            if len(args)>1 and args[1].endswith('prepare-host.py'):return b''
            raise ValueError('Unexpected fixture operation')
        return run
    try:
        with tempfile.TemporaryDirectory(prefix='3dprint4me-recovery-test-') as temporary:
            root=FixturePath(temporary)/'fresh';root.mkdir(mode=0o700)
            source=root/'candidate-source';(source/'neon').mkdir(parents=True)
            shutil.copytree(ROOT/'neon/migrations',source/'neon/migrations')
            for name in set(rebuilder.PRIVATE_NAMES)-{'compose.env','database-target.private.json'}:
                content=b'EXAMPLE=synthetic\n'
                if name=='database.private.json':content=json.dumps(credentials).encode()
                if name=='status-collector.private.json':content=json.dumps({'platform_root':str(root),'secret':'synthetic'}).encode()
                if name=='postgres.env':content=('POSTGRES_USER=platform_admin\nPOSTGRES_DB=postgres\nPOSTGRES_PASSWORD='+credentials['admin']+'\n').encode()
                rebuilder.write_private(root/name,content)
            first=start()
            with patch.object(bootstrap.rebuild,'run',fixture_runner(first)),patch.object(bootstrap.rebuild,'empty_docker',lambda:None),patch.object(os,'getuid',lambda:root.stat().st_uid,create=True),patch.object(bootstrap.sys,'platform','linux'):
                result=bootstrap.bootstrap(root,release,'2610199',True)
            assert result['setup']=='passed'
            original_check_output=subprocess.check_output
            def compose_ps(args,**kwargs):
                if args[:2]==['docker','compose']:return first.encode()+b'\n'
                return original_check_output(args,**kwargs)
            with patch.object(exporter.subprocess,'check_output',compose_ps),patch.object(os,'getuid',lambda:root.stat().st_uid,create=True):
                archive=exporter.export(root)
            second=start();destination=FixturePath(temporary)/'restored';destination.mkdir(mode=0o700)
            with patch.object(rebuilder,'run',fixture_runner(second)),patch.object(rebuilder,'empty_docker',lambda:None),patch.object(os,'getuid',lambda:0 if os.name=='nt' else destination.stat().st_uid,create=True),patch.object(rebuilder.sys,'platform','linux'):
                restored=rebuilder.rebuild(destination,ROOT,release,archive,hashlib.sha256(archive).hexdigest(),True)
            assert restored['database_restore']=='passed'
            print(json.dumps({'native_postgres_setup_backup_rebuild':'passed','databases':2,'runtime_privilege_denials':'passed','network':'none','persistent_database_volumes':False,'host_and_provider_rebuild':'not-established'}))
    finally:
        for identity in containers:command(['docker','rm','--force',identity])


if __name__=='__main__':
    try:main()
    except Exception:raise SystemExit('Isolated recovery rehearsal failed; synthetic fixture diagnostics suppressed.')
