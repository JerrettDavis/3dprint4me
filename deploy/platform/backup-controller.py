"""Hourly off-host encrypted backup controller; no plaintext recovery files.

Private JSON config specifies existing Restic stores and verified SSH host. Run
under the owner account. Errors deliberately omit subprocess output and secrets.
"""
import argparse
import base64
import datetime
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tarfile
import threading
import hmac
import secrets
import time
import urllib.request

LIMIT = 128 * 1024 * 1024
RESTIC_SHA256 = {'win32': 'b0dd1fd21eea5d8fe1325f55f7118213c21f36de8a261e04c0624a5ab9fd7830',
                 'linux': '20d4142678d0d95ec11a4759def1b73fd9190abc9ca19e4b62d067c0b387e639'}


def command(args, *, data=None, env=None, timeout=180, limit=LIMIT):
    p = subprocess.Popen(args, stdin=subprocess.PIPE if data is not None else subprocess.DEVNULL,
                         stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)
    timer = threading.Timer(timeout, p.kill)
    timer.start()
    def write():
        try:
            p.stdin.write(data)
            p.stdin.close()
        except (BrokenPipeError, OSError):
            pass
    writer = threading.Thread(target=write, daemon=True) if data is not None else None
    if writer:
        writer.start()
    try:
        output = bytearray()
        while chunk := p.stdout.read(65536):
            output.extend(chunk)
            if len(output) > limit:
                raise ValueError('Output bound')
        if p.wait(timeout=5):
            raise ValueError('Command failed')
        return bytes(output)
    finally:
        timer.cancel()
        if p.poll() is None:
            p.kill()
        p.wait()
        if writer:
            writer.join(timeout=2)


def private(path):
    if not path.is_absolute() or not path.exists() or any(p.is_symlink() for p in [path, *path.parents]):
        raise ValueError('Existing resolved private path required')
    if os.name != 'nt':
        if path.stat().st_uid != os.getuid() or path.stat().st_mode & 0o077:
            raise ValueError('Owner-only path required')
        for parent in path.parents:
            info = parent.stat()
            if info.st_uid not in (0, os.getuid()) or info.st_mode & 0o022 and not info.st_mode & 0o1000:
                raise ValueError('Unsafe private ancestor')
        return
    # Use literal paths through the environment, never shell interpolation.
    script = r'''$ErrorActionPreference='Stop'
$sid=[System.Security.Principal.SecurityIdentifier]
$trusted=@([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544')
$path=$env:PLATFORM_ACL_PATH
$acl=Get-Acl -LiteralPath $path
if($acl.GetOwner($sid).Value -notin $trusted){exit 1}
foreach($rule in $acl.GetAccessRules($true,$true,$sid)){
 if($rule.AccessControlType -eq 'Allow' -and $rule.FileSystemRights -ne 0 -and $rule.IdentityReference.Value -notin $trusted){exit 1}
}
$parent=[IO.Path]::GetDirectoryName($path.TrimEnd('\'))
while($parent){
 $acl=Get-Acl -LiteralPath $parent
 foreach($rule in $acl.GetAccessRules($true,$true,$sid)){
  if($rule.AccessControlType -eq 'Allow' -and -not($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -and $rule.IdentityReference.Value -notin $trusted -and ([int]$rule.FileSystemRights -band 0x100c0040)){exit 1}
 }
 $next=[IO.Path]::GetDirectoryName($parent.TrimEnd('\'));if($next -eq $parent){break};$parent=$next
}
'''
    exe = Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
    env = {k: v for k, v in os.environ.items() if k.upper() != 'PSMODULEPATH'}
    env.update(PLATFORM_ACL_PATH=str(path), PSModulePath=str(exe.parent / 'Modules'))
    command([str(exe), '-NoProfile', '-NonInteractive', '-EncodedCommand', base64.b64encode(script.encode('utf-16-le')).decode()], env=env, limit=1024, timeout=20)


def verify_archive(data):
    if len(data) > LIMIT:
        raise ValueError('Archive bound')
    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        files = {}
        for member in tar.getmembers():
            name = Path(member.name)
            if not member.isfile() or name.is_absolute() or '..' in name.parts or member.name in files or member.size > LIMIT:
                raise ValueError('Unsafe archive')
            files[member.name] = tar.extractfile(member).read()
        manifest = json.loads(files.pop('manifest.json'))
        if manifest['version'] != 1 or set(files) != set(manifest['sha256']):
            raise ValueError('Incomplete archive')
        if any(hashlib.sha256(value).hexdigest() != manifest['sha256'][name] for name, value in files.items()):
            raise ValueError('Archive hash mismatch')
        if not manifest['databases'] or any(not files['databases/' + name + '.dump'].startswith(b'PGDMP') for name in manifest['databases']):
            raise ValueError('Missing database dump')
        return manifest


def backup(config_path):
    private(config_path)
    config = json.loads(config_path.read_text())
    if len(config['stores'])<2 or len({str(Path(x['repository']).resolve()) for x in config['stores']})!=len(config['stores']):
        raise ValueError('Distinct recovery repositories required')
    exe, password = Path(config['restic']), Path(config['password_file'])
    private(exe)
    private(password)
    if hashlib.sha256(exe.read_bytes()).hexdigest() != RESTIC_SHA256.get(sys.platform):
        raise ValueError('Restic executable must match pinned 0.19.1 release')
    host = config['ssh_host']
    if not re.fullmatch('[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.-]+', host):
        raise ValueError('Explicit SSH account and host required')
    # Execute this exact repository-owned exporter over the existing pinned SSH
    # trust boundary. Source contains no credentials and never touches disk.
    source = Path(__file__).with_name('export-backup.py').read_text()
    remote = 'python3 -c ' + shlex.quote(source) + ' --root /home/jd/3dprint4me-platform'
    data = command(['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=8', host, remote], timeout=300)
    manifest = verify_archive(data)
    name = '3dprint4me/platform-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.tar'
    snapshots = []
    # Write and round-trip independently to each existing encrypted repository.
    for store in config['stores']:
        repo, cache = Path(store['repository']), Path(store['cache'])
        private(repo)
        private(cache)
        if repo == cache or repo.is_relative_to(cache) or cache.is_relative_to(repo) or password.is_relative_to(repo) or password.is_relative_to(cache):
            raise ValueError('Repositories, cache and password must be separate')
        for root in (repo, cache):
            if any(p.is_symlink() for p in root.rglob('*')):
                raise ValueError('Symlinks forbidden in recovery storage')
        env = {k: v for k, v in os.environ.items() if not k.upper().startswith('RESTIC_')}
        env.update(TEMP=str(cache), TMP=str(cache), TMPDIR=str(cache))
        args = [str(exe), '--repo', str(repo), '--password-file', str(password), '--cache-dir', str(cache)]
        output = command(args + ['backup', '--stdin', '--stdin-filename', name, '--tag', 'platform:3dprint4me-native', '--json'], data=data, env=env, limit=1024*1024)
        summaries = [json.loads(line) for line in output.splitlines() if json.loads(line).get('message_type') == 'summary']
        if len(summaries) != 1 or not re.fullmatch('[a-f0-9]{64}', summaries[0].get('snapshot_id', '')):
            raise ValueError('Exact snapshot required')
        snapshot = summaries[0]['snapshot_id']
        restored = command(args + ['dump', snapshot, '/' + name], env=env)
        if hashlib.sha256(data).digest() != hashlib.sha256(restored).digest():
            raise ValueError('Encrypted round-trip mismatch')
        snapshots.append(snapshot)
    if len(snapshots) < 2:
        raise ValueError('Two independent repositories required')
    return {'version': 1, 'snapshots': snapshots, 'filename': name, 'sha256': hashlib.sha256(data).hexdigest(),
            'bytes': len(data), 'databases': manifest['databases'], 'roundtrip_verified': True,
            'operational_restore': 'not-established-by-backup', 'offsite': 'unverified'}


def report(config_path,success):
    private(config_path)
    config=json.loads(config_path.read_text())
    secret=config.get('status_backup_secret')
    if not isinstance(secret,str) or len(secret)<48:
        raise ValueError('Independent backup reporting key required')
    path='/heartbeat/backup'
    body=json.dumps({'observedAt':time.time_ns()//1_000_000,'nonce':secrets.token_hex(16),'details':{'success':success,'copied':success}},separators=(',',':')).encode()
    signature=hmac.new(secret.encode(),path.encode()+b'\n'+body,hashlib.sha256).hexdigest()
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs):return None
    request=urllib.request.Request('https://status-api.3dprint4.me'+path,data=body,method='POST',headers={'Content-Type':'application/json','X-Status-Signature':signature,'User-Agent':'3dprint4me-recovery/1'})
    with urllib.request.build_opener(NoRedirect).open(request,timeout=10) as response:
        if response.status!=200:raise ValueError('Backup evidence rejected')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=Path, required=True)
    args = parser.parse_args()
    try:
        result=backup(args.config)
        report(args.config,True)
        print(json.dumps(result))
    except Exception:
        try:report(args.config,False)
        except Exception:pass
        raise SystemExit('Encrypted platform backup failed; private diagnostics suppressed.')
