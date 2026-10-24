"""Send a reviewed partner release to the pinned native host over SSH stdin.

Rehearsal is the default. The committed host executor owns all host-side checks.
Local or uncommitted files never enter the release archive or remote program.
"""
import argparse
import base64
import datetime
import hashlib
import importlib.util
import io
import json
from pathlib import Path, PurePosixPath
import re
import shlex
import subprocess
import tarfile
import tempfile
import time

ARCHIVE_PATHS = ('api', 'lib', 'neon', 'scripts', 'deploy', 'contracts/partner',
                 'public/assets/js', 'package.json', 'package-lock.json')
REQUIRED_FILES = ('deploy/platform/Dockerfile', 'deploy/platform/partner-release-host.py',
                  'deploy/platform/partner-rollout-host.py',
                  'deploy/slicer-worker/Dockerfile.bambu', 'scripts/rehearse-partner.mjs',
                  'neon/migrations/012_partner_outreach.sql', 'neon/migrations/013_partner_weekly_statements.sql',
                  'package.json', 'package-lock.json')
MAX_ARCHIVE = 32 * 1024 * 1024


def git_bytes(repo, *args):
    try:
        return subprocess.run(['git', *args], cwd=repo, check=True,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              timeout=60).stdout
    except (subprocess.SubprocessError, OSError):
        raise ValueError('Committed release source is unavailable.') from None


def build_payload(release: str, phase: str, repo: Path) -> dict:
    if not re.fullmatch(r'[a-f0-9]{40}', release) or phase not in ('rehearse', 'deploy'):
        raise ValueError('A full commit SHA and supported phase are required.')
    resolved = git_bytes(repo, 'rev-parse', '--verify', release + '^{commit}').decode().strip()
    if resolved != release:
        raise ValueError('The release must name the exact commit.')
    archive = git_bytes(repo, 'archive', '--format=tar', release, *ARCHIVE_PATHS,
                        ':(exclude)deploy/slicer-worker/.env.worker.example')
    if not archive or len(archive) > MAX_ARCHIVE:
        raise ValueError('Release archive exceeds the supported size.')
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        files = set()
        for member in tar:
            path = PurePosixPath(member.name)
            if (not (member.isfile() or member.isdir()) or path.is_absolute()
                    or '..' in path.parts or '\\' in member.name
                    or any(part.startswith('.env') or part.endswith('.private.json')
                           or part.endswith('.private.env') for part in path.parts)):
                raise ValueError('Release archive contains unsafe input.')
            if member.isfile():
                files.add(member.name)
        if (any(name not in files for name in REQUIRED_FILES)
                or not any(name.startswith('contracts/partner/') for name in files)):
            raise ValueError('Release archive lacks required build inputs.')
    return {'release': release, 'phase': phase,
            'archive': base64.b64encode(archive).decode('ascii'),
            'archiveSha256': hashlib.sha256(archive).hexdigest()}


def collect_checkpoint(release: str, config_path: Path, repo: Path, host: str) -> dict:
    """Run the committed existing controller, returning only verified identities."""
    controller, verified_custody = None, False
    try:
        if (not re.fullmatch(r'[a-f0-9]{40}', release) or not config_path.is_absolute()
                or not re.fullmatch(r'[a-zA-Z0-9_][a-zA-Z0-9_.-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*', host)):
            raise ValueError('Explicit reviewed source and private backup custody are required.')
        with tempfile.TemporaryDirectory(prefix='partner-checkpoint-source-') as directory:
            temporary = Path(directory)
            for name in ('backup-controller.py', 'export-backup.py'):
                (temporary/name).write_bytes(git_bytes(repo, 'show', release+':deploy/platform/'+name))
            spec = importlib.util.spec_from_file_location('partner_release_backup', temporary/'backup-controller.py')
            controller = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(controller)
            controller.private(config_path)
            config = json.loads(config_path.read_text(encoding='utf-8'))
            if (config.get('ssh_host') != host
                    or config.get('platform_root', '/home/jd/3dprint4me-platform') != '/home/jd/3dprint4me-platform'):
                raise ValueError('Backup and release must name the same native host/root.')
            verified_custody = True
            result = controller.backup(config_path)
            objects = result['private_objects']
            name = re.fullmatch(r'3dprint4me/platform-(\d{8}T\d{6}Z)\.tar', result['filename'])
            if (result.get('version') != 1 or result.get('roundtrip_verified') is not True
                    or objects.get('roundtrip_verified') is not True or not name):
                raise ValueError('Complete checkpoint readback is required.')
            created = int(datetime.datetime.strptime(name[1], '%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.timezone.utc).timestamp())
            if not -30 <= time.time() - created <= 1800:
                raise ValueError('Checkpoint is stale.')
            databases = result['databases']
            if (not isinstance(databases, list) or len(databases) != 2 or databases[0] != 'platform'
                    or not re.fullmatch(r'platform_live_[a-z0-9_]{1,48}', str(databases[1]))):
                raise ValueError('Selected native checkpoint is required.')
            proof = {'createdAt': created, 'roundtripVerified': True, 'databases': databases,
                     'databaseSha256': result['sha256'], 'databaseSnapshots': result['snapshots'],
                     'objectSha256': objects['sha256'], 'objectSnapshots': objects['snapshots'],
                     'checkpointReceipts': result['checkpoint_receipts']}
            for key in ('databaseSha256', 'objectSha256'):
                if not re.fullmatch(r'[a-f0-9]{64}', str(proof[key])):
                    raise ValueError('Checkpoint digest is invalid.')
            for key in ('databaseSnapshots', 'objectSnapshots', 'checkpointReceipts'):
                if (not isinstance(proof[key], list) or len(proof[key]) < 2
                        or any(not re.fullmatch(r'[a-f0-9]{64}', str(value)) for value in proof[key])):
                    raise ValueError('Two verified checkpoint stores are required.')
            controller.report(config_path, True)
            return proof
    except Exception:
        if verified_custody:
            try:
                controller.report(config_path, False)
            except Exception:
                pass
        raise RuntimeError('Fresh complete checkpoint unavailable; inspect private backup custody and diagnostics.') from None


def send_payload(host: str, payload: dict, program: str) -> dict:
    if not re.fullmatch(r'[a-zA-Z0-9_][a-zA-Z0-9_.-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*', host):
        raise ValueError('An explicit user and valid SSH hostname are required.')
    command = ['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
               host, 'python3 -c ' + shlex.quote(program)]
    try:
        result = subprocess.run(command, input=json.dumps(payload).encode('utf-8'),
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=3600)
        if result.returncode or len(result.stdout) > 32768:
            raise RuntimeError()
        proof = json.loads(result.stdout)
        if (not isinstance(proof, dict) or proof.get('phase') not in ('rehearse', 'deploy')
                or proof.get('status') != 'passed'
                or set(proof) != {'phase', 'status', 'release', 'archiveSha256', 'checks', 'images'}
                or any(proof[key] != payload.get(key) for key in ('release', 'phase', 'archiveSha256'))):
            raise RuntimeError()
        for key, length in [('release', 40), ('archiveSha256', 64)]:
            if key in proof and not re.fullmatch('[a-f0-9]{' + str(length) + '}', str(proof[key])):
                raise RuntimeError()
        if 'checks' in proof:
            checks = proof['checks']
            required = {'schema', 'leastPrivilege', 'disabledProgram', 'sessionDenials', 'noMessagesSent',
                        'isolatedApiOverlap', 'scratchCleanup', 'liveStateUnchanged'}
            if proof['phase'] == 'deploy':
                required.update(('guardedApi', 'jobsHandover', 'freshCheckpoint', 'featureOffSmoke', 'existingServices'))
            if (not isinstance(checks, dict)
                    or set(checks) != required
                    or any(value is not True for value in checks.values())):
                raise RuntimeError()
        if 'images' in proof:
            images = proof['images']
            if (not isinstance(images, dict) or set(images) != {'api', 'slicer'}
                    or any(not isinstance(value, str) or not re.fullmatch(r'sha256:[a-f0-9]{64}', value)
                           for value in images.values())):
                raise RuntimeError()
        return proof
    except (subprocess.SubprocessError, OSError, ValueError, RuntimeError):
        raise RuntimeError('Partner release stopped; inspect private host diagnostics before retrying.') from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', required=True)
    parser.add_argument('--phase', choices=('rehearse', 'deploy'), default='rehearse')
    parser.add_argument('--host', default='jd@jdh-docker-00')
    parser.add_argument('--backup-config', type=Path)
    args = parser.parse_args()
    if args.phase == 'deploy' and not args.backup_config:
        parser.error('Explicit deploy requires --backup-config for a fresh complete checkpoint.')
    if args.phase != 'deploy' and args.backup_config:
        parser.error('--backup-config is only valid for an explicitly approved deploy phase.')
    repo = Path(__file__).resolve().parents[2]
    try:
        payload = build_payload(args.release, args.phase, repo)
        if args.phase == 'deploy':
            payload['checkpoint'] = collect_checkpoint(args.release, args.backup_config, repo, args.host)
        program = git_bytes(repo, 'show', args.release + ':deploy/platform/partner-release-host.py').decode('utf-8')
        print(json.dumps(send_payload(args.host, payload, program)))
    except (ValueError, RuntimeError, UnicodeError):
        parser.exit(1, 'Partner release stopped; verify committed inputs and private host diagnostics.\n')


if __name__ == '__main__':
    main()
