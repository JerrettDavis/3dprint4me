"""Rebuild a replacement Linux host from an exact trusted checkpoint on stdin.

Preview by default. Never run on the live host. --apply creates private files,
builds images and restores PostgreSQL; it never starts the API, writers or tunnel.
"""
import argparse
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import time

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('exporter', HERE / 'export-backup.py')
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)
PRIVATE_NAMES = exporter.PRIVATE_NAMES
LIMIT = 128 * 1024 * 1024
PROJECT = '3dprint4me-platform'


def run(args, data=None, timeout=180):
    return subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                          check=True, timeout=timeout).stdout


def checkpoint(data, expected_sha):
    if len(data) > LIMIT or not re.fullmatch('[a-f0-9]{64}', expected_sha) or hashlib.sha256(data).hexdigest() != expected_sha:
        raise ValueError('Exact trusted checkpoint required')
    files = {}
    with tarfile.open(fileobj=io.BytesIO(data),mode='r:') as tar:
        for item in tar:
            if not item.isfile() or item.name in files or item.size > LIMIT or item.name.startswith('/') or '..' in item.name.split('/') or '\\' in item.name:
                raise ValueError('Unsafe archive')
            files[item.name] = tar.extractfile(item).read()
    manifest = json.loads(files.pop('manifest.json'))
    if manifest['version'] != 1 or set(files) != set(manifest['sha256']) or any(hashlib.sha256(v).hexdigest() != manifest['sha256'][k] for k,v in files.items()):
        raise ValueError('Incomplete checkpoint')
    databases = exporter.selected_databases({}, manifest.get('deploymentSelection'))
    if databases != manifest['databases'] or len(databases) != 2:
        raise ValueError('Active control and business databases required')
    expected = {'private/' + name for name in PRIVATE_NAMES} | {'databases/' + name + '.dump' for name in databases}
    if set(files) not in (expected, expected | {'objects/private-blobs.json'}, expected | {'objects/required-paths.json'}):
        raise ValueError('Unexpected recovery members')
    if any(not files['databases/' + name + '.dump'].startswith(b'PGDMP') for name in databases):
        raise ValueError('Invalid database dump')
    credentials = json.loads(files['private/database.private.json'])
    if not all(re.fullmatch('[A-Za-z0-9_-]{32,128}', credentials[k]) for k in ['admin','owner','runtime']):
        raise ValueError('Invalid database credentials')
    return manifest, files


def destination(root):
    if not root.is_absolute() or root.resolve() != root or root == Path('/') or any(p.is_symlink() for p in [root, *root.parents]):
        raise ValueError('Resolved empty destination required')
    if not root.is_dir() or any(root.iterdir()):
        raise ValueError('Existing empty destination required')
    if os.name != 'nt' and (root.stat().st_uid != os.getuid() or root.stat().st_mode & 0o077):
        raise ValueError('Owner-only destination required')


def empty_docker(command=run):
    queries = [ ['docker','ps','-a','-q','--filter','label=com.docker.compose.project=' + PROJECT],
                ['docker','volume','ls','-q','--filter','label=com.docker.compose.project=' + PROJECT] ]
    # Compose can adopt an existing same-name volume even without its labels.
    for name in [PROJECT + '_postgres18','3dprint4me-health-jobs','3dprint4me-health-slicer']:
        queries.append(['docker','volume','ls','-q','--filter','name=^' + name + '$'])
    for args in queries:
        if command(args).strip():
            raise ValueError('Existing platform resources; recovery refused')


def write_private(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd,'wb') as file:
        file.write(data);file.flush();os.fsync(file.fileno())


def rebuild(root, source, release, data, expected_sha, apply=False):
    destination(root)
    if not re.fullmatch('[a-f0-9]{40}', release):
        raise ValueError('Exact source commit required')
    if run(['git','-C',str(source),'rev-parse',release + '^{commit}']).decode().strip() != release:
        raise ValueError('Unavailable source commit')
    manifest, files = checkpoint(data, expected_sha)
    empty_docker()
    plan = {'apply':apply,'databases':len(manifest['databases']),
            'private_objects_in_checkpoint':'objects/private-blobs.json' in files,
            'source_release':release,'api_started':False,'writers_started':False,'tunnel_started':False}
    if not apply:
        return plan
    if sys.platform != 'linux':
        raise ValueError('Replacement Docker host must run Linux')
    os.umask(0o077)
    # Only tracked files from the exact commit enter candidate-source, never .env,
    # local credentials, untracked files, dependencies or worktree metadata.
    archive = run(['git','-C',str(source),'archive','--format=tar',release])
    checkout = root / 'candidate-source';checkout.mkdir(mode=0o700)
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        for member in tar.getmembers():
            if not (member.isfile() or member.isdir()) or member.name.startswith('/') or '..' in Path(member.name).parts:
                raise ValueError('Unsafe source member')
        tar.extractall(checkout)
    for name in PRIVATE_NAMES:
        if name == 'compose.env':
            content = ('PLATFORM_CONFIG_DIR=' + json.dumps(str(root)) + '\nPLATFORM_RELEASE=' + release[:12] + '\n').encode()
        elif name == 'status-collector.private.json':
            config = json.loads(files['private/' + name]);config['platform_root'] = str(root)
            content = json.dumps(config).encode()
        else:
            content = files['private/' + name]
        write_private(root / name, content)
    compose = ['docker','compose','--env-file',str(root/'compose.env'),'-f',str(checkout/'deploy/platform/compose.yml')]
    # Initialization uses the existing postgres.env from the trusted checkpoint.
    run(compose + ['up','-d','--wait','postgres'],timeout=180)
    pg = run(compose + ['ps','-q','postgres']).decode().strip()
    if not re.fullmatch('[a-f0-9]{64}', pg):
        raise ValueError('Database container identity mismatch')
    def sql(text, database='postgres', user='platform_admin'):
        return run(['docker','exec','-i',pg,'psql','-X','-U',user,'-d',database,'-At','-v','ON_ERROR_STOP=1'],text.encode())
    credentials = json.loads(files['private/database.private.json'])
    sql("CREATE ROLE platform_backend NOLOGIN NOSUPERUSER NOBYPASSRLS; CREATE ROLE platform_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '" + credentials['owner'] + "'; CREATE ROLE platform_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '" + credentials['runtime'] + "'; GRANT platform_backend TO platform_app;")
    for database in manifest['databases']:
        # postgres.env may initialize 'platform'; accept only that empty database.
        exists = sql("SELECT 1 FROM pg_database WHERE datname='" + database + "'").strip()
        if not exists:sql('CREATE DATABASE ' + database + ' OWNER platform_owner')
        else:
            if sql("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'",database).strip() != b'0':
                raise ValueError('Non-empty recovery database refused')
            sql('ALTER DATABASE ' + database + ' OWNER TO platform_owner')
        sql('DROP SCHEMA public',database)
        run(['docker','exec','-i',pg,'pg_restore','-U','platform_owner','--dbname='+database,'--no-owner','--exit-on-error'], files['databases/'+database+'.dump'])
    actual = json.loads(sql('SELECT row_to_json(s) FROM (SELECT generation,database_name,source_dump_sha256 FROM platform_deployment_state WHERE singleton=true) s','platform','platform_owner'))
    if actual != manifest['deploymentSelection']:
        raise ValueError('Durable database selection differs')
    for database in manifest['databases']:
        if int(sql("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",database,'platform_app'))<25:
            raise ValueError('Recovered runtime cannot read complete schema')
        for statement in ['CREATE TABLE recovery_forbidden(id text)', 'UPDATE operators SET role=role', 'DELETE FROM operator_identity_bindings']:
            try:sql('BEGIN; '+statement+'; ROLLBACK;',database,'platform_app')
            except subprocess.CalledProcessError:pass
            else:raise ValueError('Recovered runtime permissions are unsafe')
    # Build both pinned Docker definitions from this commit. Do not start writers.
    run(compose + ['--profile','writers','build','api','slicer'],timeout=1800)
    run([sys.executable,str(checkout/'deploy/platform/prepare-host.py'),'--root',str(root),'--owner-uid',str(os.getuid()),'--apply'])
    if 'objects/private-blobs.json' in files:
        # Store recovery bytes privately for the separate explicit Blob restore.
        write_private(root/'private-blobs.recovery.json',files['objects/private-blobs.json'])
    write_private(root/'recovery-evidence.json',json.dumps({**plan,'checkpoint_sha256':expected_sha,'restored_at':int(time.time())}).encode())
    return {**plan,'database_restore':'passed','routing':'manual-review-required'}


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,required=True)
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--release',required=True)
    parser.add_argument('--sha256',required=True)
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    try:
        print(json.dumps(rebuild(args.root,args.source,args.release,sys.stdin.buffer.read(LIMIT+1),args.sha256,args.apply)))
    except Exception:
        raise SystemExit('Host rebuild failed; private diagnostics suppressed. Partial recovery is retained for inspection; no automatic cleanup or traffic activation.')
