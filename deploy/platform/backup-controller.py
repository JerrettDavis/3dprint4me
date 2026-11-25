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
    write_errors = []
    def write():
        try:
            if hasattr(data, 'read'):
                while chunk := data.read(65536):p.stdin.write(chunk)
            else:p.stdin.write(data)
        except Exception:
            write_errors.append(True)
        finally:
            try:p.stdin.close()
            except OSError:pass
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
        if writer:writer.join(timeout=2)
        if write_errors or writer and writer.is_alive():raise ValueError('Input stream failed')
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
    platform_root = config.get('platform_root', '/home/jd/3dprint4me-platform')
    if not platform_root.startswith('/') or '\n' in platform_root:raise ValueError('Explicit platform root required')
    remote = 'python3 -c ' + shlex.quote(source) + ' --root ' + shlex.quote(platform_root)
    data = command(['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=8', host, remote], timeout=300)
    manifest = verify_archive(data)
    name = '3dprint4me/platform-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.tar'
    snapshots = []
    repositories = []
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
        repositories.append((args, env))
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
    # Files have a separate streamed snapshot, so growing customer data cannot
    # exhaust the bounded in-memory database/configuration recovery archive.
    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        required = tar.extractfile('objects/required-paths.json').read()
    object_result = backup_objects(config, required, repositories, name)
    result = {'version': 1, 'snapshots': snapshots, 'filename': name, 'sha256': hashlib.sha256(data).hexdigest(),
            'bytes': len(data), 'databases': manifest['databases'], 'roundtrip_verified': True,
            'private_objects': object_result,
            'operational_restore': 'not-established-by-backup', 'offsite': 'unverified'}
    receipt_name=name.removesuffix('.tar')+'-checkpoint.json'
    receipt=json.dumps(result,sort_keys=True).encode();receipts=[]
    for args,env in repositories:
        snapshot=summary_snapshot(command(args+['backup','--stdin','--stdin-filename',receipt_name,'--tag','platform:3dprint4me-complete-checkpoint','--json'],data=receipt,env=env,limit=1024*1024))
        if command(args+['dump',snapshot,'/'+receipt_name],env=env)!=receipt:raise ValueError('Checkpoint receipt mismatch')
        receipts.append(snapshot)
    return {**result,'checkpoint_receipts':receipts,'checkpoint_filename':receipt_name}


def stream_hash(args, env):
    """Hash a decrypted Restic readback without storing it or bounding store size."""
    process=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=env)
    timer=threading.Timer(900,process.kill);timer.start();digest=hashlib.sha256()
    try:
        while chunk:=process.stdout.read(65536):digest.update(chunk)
        if process.wait(timeout=5):raise ValueError('Encrypted stream readback failed')
        return digest.hexdigest()
    finally:
        timer.cancel()
        if process.poll() is None:process.kill()
        process.wait()


def summary_snapshot(output):
    summaries=[json.loads(line) for line in output.splitlines() if json.loads(line).get('message_type')=='summary']
    if len(summaries)!=1 or not re.fullmatch('[a-f0-9]{64}',summaries[0].get('snapshot_id','')):
        raise ValueError('Exact stream snapshot required')
    return summaries[0]['snapshot_id']


def copied_snapshot(destination, env, source_snapshot, filename):
    # Restic records an absolute native path in snapshot metadata: Windows uses
    # C:\\3dprint4me\\..., while dump/ls accept the virtual /3dprint4me/... path.
    path_filter=str(Path('/'+filename).absolute())
    candidates=json.loads(command(destination+['snapshots','--json','--path',path_filter],env=env,limit=1024*1024))
    copied=[entry['id'] for entry in candidates if entry.get('original')==source_snapshot or entry.get('id')==source_snapshot]
    if len(copied)!=1 or not re.fullmatch('[a-f0-9]{64}',copied[0]):raise ValueError('Copied snapshot identity unknown')
    return copied[0]


def previous_objects(args, env):
    """Only completed receipts qualify; a selected damaged receipt fails closed."""
    entries=json.loads(command(args+['snapshots','--json','--tag','platform:3dprint4me-complete-checkpoint'],env=env,limit=8*1024*1024))
    if not isinstance(entries,list):raise ValueError('Invalid checkpoint inventory')
    if not entries:return None
    selected=max(entries,key=lambda entry:entry['time'])
    snapshot=selected['id']
    if not re.fullmatch('[a-f0-9]{64}',snapshot):raise ValueError('Invalid checkpoint identity')
    listing=command(args+['ls','--json',snapshot],env=env,limit=8*1024*1024)
    paths=[entry.get('path','') for line in listing.splitlines() if (entry:=json.loads(line)).get('path','').endswith('-checkpoint.json')]
    if len(paths)!=1 or not re.fullmatch(r'/3dprint4me/platform-\d{8}T\d{6}Z-checkpoint\.json',paths[0]):raise ValueError('Invalid checkpoint path')
    receipt=json.loads(command(args+['dump',snapshot,paths[0]],env=env,limit=1024*1024))
    objects=receipt['private_objects']
    expected=paths[0][1:].replace('-checkpoint.json','-objects.ndjson')
    if (receipt.get('version')!=1 or receipt.get('roundtrip_verified') is not True or
        receipt.get('filename')!=expected.replace('-objects.ndjson','.tar') or
        objects.get('roundtrip_verified') is not True or objects.get('filename')!=expected or
        not isinstance(objects.get('snapshots'),list) or len(objects['snapshots'])<2 or
        any(not isinstance(value,str) or not re.fullmatch('[a-f0-9]{64}',value) for value in objects['snapshots']) or
        not isinstance(objects.get('sha256'),str) or not re.fullmatch('[a-f0-9]{64}',objects['sha256'])):
        raise ValueError('Invalid completed object checkpoint')
    return objects


class ObjectStreamReader:
    """Hash outgoing bytes and retain only a bounded trailing footer."""
    def __init__(self,stream):
        self.stream=stream;self.digest=hashlib.sha256();self.tail=b''
    def read(self,size):
        chunk=self.stream.read(size);self.digest.update(chunk)
        self.tail=(self.tail+chunk)[-8192:]
        return chunk
    def finish(self):
        if not self.tail.endswith(b'\n'):raise ValueError('Incomplete object stream')
        footer=json.loads(self.tail.rstrip(b'\n').rsplit(b'\n',1)[-1])
        if footer.get('type')!='footer' or footer.get('version')!=1:raise ValueError('Object footer required')
        names=('objects','downloadedObjects','downloadedBytes','reusedObjects','reusedBytes')
        if any(type(footer.get(key)) is not int or footer[key]<0 for key in names):raise ValueError('Invalid object counters')
        if footer['objects']!=footer['downloadedObjects']+footer['reusedObjects']:raise ValueError('Object counter mismatch')
        return {**{key:footer[key] for key in names},'legacyFallback':footer.get('exportMode')=='legacy-bootstrap'}


def backup_objects(config, required, repositories, database_filename):
    root=config.get('platform_root','/home/jd/3dprint4me-platform')
    args,env=repositories[0]
    prior=previous_objects(args,env)
    paths=json.loads(required)
    if not isinstance(paths,list):raise ValueError('Required object paths required')
    # Guarded releases checkpoint the OLD image before deploying the new one.
    # Probe the fixed CLI capability without provider reads; preserve that gate.
    remote_code="root="+repr(root)+"\n"+r'''
import json,subprocess,sys
base=['docker','compose','--env-file',root+'/compose.env','-f',root+'/candidate-source/deploy/platform/compose.yml','exec','-T','api','node']
probe=subprocess.run(base+['-e',"process.exit(require('node:fs').readFileSync('scripts/blob-recovery.mjs','utf8').includes(\"mode==='export-incremental'\")?0:3)"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
if probe.returncode==0:
 sys.exit(subprocess.call(base+['scripts/blob-recovery.mjs','export-incremental'],stdin=sys.stdin.buffer,stderr=subprocess.DEVNULL))
if probe.returncode!=3:sys.exit(1)
line=sys.stdin.buffer.readline(8*1024*1024+1)
if len(line)>8*1024*1024 or not line.endswith(b'\n'):sys.exit(1)
request=json.loads(line)
if request.get('type')!='requirements' or not isinstance(request.get('paths'),list):sys.exit(1)
while sys.stdin.buffer.read(65536):pass
p=subprocess.Popen(base+['scripts/blob-recovery.mjs','export-stream'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
p.stdin.write(json.dumps(request['paths']).encode());p.stdin.close()
count=total=0;footer=False
while True:
 line=p.stdout.readline(96*1024*1024+1)
 if not line:break
 if len(line)>96*1024*1024 or not line.endswith(b'\n') or footer:p.kill();sys.exit(1)
 record=json.loads(line)
 if record.get('type')=='object':count+=1;total+=record['size']
 if record.get('type')=='footer':
  if record.get('objects')!=count:p.kill();sys.exit(1)
  footer=True;record.update(downloadedObjects=count,downloadedBytes=total,reusedObjects=0,reusedBytes=0,exportMode='legacy-bootstrap')
  line=json.dumps(record,separators=(',',':')).encode()+b'\n'
 sys.stdout.buffer.write(line);sys.stdout.buffer.flush()
code=p.wait()
sys.exit(code if code else (0 if footer else 1))
'''
    producer=subprocess.Popen(['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8',config['ssh_host'],'python3 -c '+shlex.quote(remote_code)],
                              stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
    timer=threading.Timer(900,producer.kill);timer.start()
    reader=ObjectStreamReader(producer.stdout)
    write_errors=[]
    def write_prior():
        source=None;source_timer=None
        try:
            producer.stdin.write(json.dumps({'type':'requirements','paths':paths},separators=(',',':')).encode()+b'\n')
            if prior:
                source=subprocess.Popen(args+['dump',prior['snapshots'][0],'/'+prior['filename']],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=env)
                source_timer=threading.Timer(900,source.kill);source_timer.start()
                digest=hashlib.sha256()
                while chunk:=source.stdout.read(65536):
                    digest.update(chunk);producer.stdin.write(chunk)
                if source.wait(timeout=5) or digest.hexdigest()!=prior['sha256']:raise ValueError('Prior checkpoint read failed')
            else:
                producer.stdin.write(b'{"type":"header","version":1}\n{"type":"footer","version":1,"objects":0}\n')
        except Exception:write_errors.append(True)
        finally:
            if source_timer:source_timer.cancel()
            if source:
                if source.poll() is None:source.kill()
                source.wait()
            try:producer.stdin.close()
            except OSError:pass
    writer=threading.Thread(target=write_prior,daemon=True);writer.start()
    filename=database_filename.removesuffix('.tar')+'-objects.ndjson'
    try:
        output=command(args+['backup','--stdin','--stdin-filename',filename,'--tag','platform:3dprint4me-private-objects','--json'],data=reader,env=env,timeout=900,limit=1024*1024)
        if producer.wait(timeout=10):raise ValueError('Private object export incomplete')
        writer.join(timeout=10)
        if writer.is_alive() or write_errors:raise ValueError('Prior object stream failed')
        counters=reader.finish()
        snapshot=summary_snapshot(output)
    finally:
        timer.cancel()
        if producer.poll() is None:producer.kill()
        producer.wait()
        writer.join(timeout=2)
    expected=reader.digest.hexdigest();snapshots=[]
    for index,(destination,store_env) in enumerate(repositories):
        destination_snapshot=snapshot
        if index:
            # Copy encrypted snapshot identities without re-exporting a changing
            # store; both destinations must contain the exact same checkpoint.
            command(destination+['copy','--from-repo',config['stores'][0]['repository'],'--from-password-file',config['password_file'],snapshot],env=store_env,timeout=900,limit=1024*1024)
            destination_snapshot=copied_snapshot(destination,store_env,snapshot,filename)
        if stream_hash(destination+['dump',destination_snapshot,'/'+filename],store_env)!=expected:raise ValueError('Private object roundtrip mismatch')
        snapshots.append(destination_snapshot)
    return {'snapshots':snapshots,'filename':filename,'sha256':expected,'roundtrip_verified':True,**counters}


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
