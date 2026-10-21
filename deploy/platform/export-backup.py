"""Emit a private recovery archive to stdout; invoke only over authenticated SSH.

No plaintext dump is written to disk. The controller must encrypt stdout directly.
Both the independent control database and selected business database are included.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile

LIMIT = 128 * 1024 * 1024
PRIVATE_NAMES = ['postgres.env', 'api.env', 'activation.env', 'database.private.json',
                 'github.private.json', 'tunnel.token', 'compose.env', 'jobs.env',
                 'slicer.env', 'database-target.private.json', 'status-collector.private.json']


def selected_databases(manifest, selection):
    # The append-once control record survives stale env/manifest files and is
    # authoritative for all live writes. Never silently back up only candidate.
    if selection:
        if not re.fullmatch('platform_live_[a-z0-9_]{1,48}', selection.get('database_name', '')) or not re.fullmatch('[a-f0-9]{64}', selection.get('source_dump_sha256', '')):
            raise ValueError('Invalid durable selection')
        import uuid
        uuid.UUID(selection['generation'])
        return ['platform', selection['database_name']]
    if manifest.get('phase') == 'prepared':
        return ['platform']
    if manifest.get('phase') != 'fenced-and-restored':
        raise ValueError('Incomplete handover')
    from urllib.parse import urlsplit
    database = urlsplit(manifest['databaseUrl']).path.removeprefix('/')
    if not re.fullmatch('platform_live_[a-z0-9_]{1,48}', database):
        raise ValueError('Unexpected prepared target')
    return ['platform', database]


def export(root):
    if root.resolve() != root or root.is_symlink() or root.stat().st_uid != os.getuid() or root.stat().st_mode & 0o077:
        raise ValueError('Private root required')
    files = {}
    for name in PRIVATE_NAMES:
        path = root / name
        if path.is_symlink() or not path.is_file() or path.stat().st_uid != os.getuid() or path.stat().st_mode & 0o077:
            raise ValueError('Private configuration required')
        if path.stat().st_size > 1024 * 1024:
            raise ValueError('Configuration bound')
        files['private/' + name] = path.read_bytes()
    compose = ['docker', 'compose', '--env-file', str(root / 'compose.env'), '-f', str(root / 'candidate-source/deploy/platform/compose.yml')]
    container = subprocess.check_output(compose + ['ps', '-q', 'postgres'], timeout=15).decode().strip()
    if not re.fullmatch('[a-f0-9]{64}', container):
        raise ValueError('Expected database container')
    manifest = json.loads(files['private/database-target.private.json'])
    def selection():
        output=subprocess.check_output(['docker','exec',container,'psql','-U','platform_owner','-d','platform','-At','-v','ON_ERROR_STOP=1','-c',
            'SELECT row_to_json(s) FROM (SELECT generation,database_name,source_dump_sha256 FROM platform_deployment_state WHERE singleton=true) s'],stderr=subprocess.DEVNULL,timeout=15)
        return json.loads(output) if output.strip() else None
    selected=selection()
    databases=selected_databases(manifest,selected)
    for database in databases:
        # pg_dump runs as the existing non-superuser schema owner; preserve ACLs.
        process = subprocess.Popen(['docker', 'exec', container, 'pg_dump', '-U', 'platform_owner', '-d', database,
                                    '--format=custom', '--schema=public', '--no-owner'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        import threading
        timer = threading.Timer(120, process.kill)
        timer.start()
        try:
            output = bytearray()
            while chunk := process.stdout.read(65536):
                output.extend(chunk)
                if len(output) > LIMIT:
                    process.kill()
                    raise ValueError('Database archive bound')
            if process.wait(timeout=5) or not output.startswith(b'PGDMP'):
                raise ValueError('Database export failed')
            files['databases/' + database + '.dump'] = bytes(output)
        finally:
            timer.cancel()
            if process.poll() is None:
                process.kill()
            process.wait()
    if selection()!=selected:
        raise ValueError('Selection changed during backup; retry after handover')
    metadata = {'version': 1, 'databases': databases, 'phase': 'active' if selected else manifest['phase'], 'deploymentSelection':selected,
                'sha256': {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}}
    files['manifest.json'] = json.dumps(metadata, sort_keys=True).encode()
    archive = io.BytesIO()
    with tarfile.open(fileobj=archive, mode='w') as tar:
        for name, data in files.items():
            entry = tarfile.TarInfo(name)
            entry.size = len(data)
            entry.mode = 0o600
            tar.addfile(entry, io.BytesIO(data))
    if archive.tell() > LIMIT:
        raise ValueError('Recovery archive bound')
    return archive.getvalue()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    args = parser.parse_args()
    try:
        sys.stdout.buffer.write(export(args.root))
    except Exception:
        raise SystemExit('Private recovery export failed; diagnostics suppressed.')
