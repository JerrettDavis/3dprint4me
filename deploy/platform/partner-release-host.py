"""Private native-host partner release executor. Never prints child diagnostics."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import types
import uuid
from urllib.parse import urlsplit, urlunsplit

MAX_ARCHIVE = 32 * 1024 * 1024
REQUIRED = {'deploy/platform/Dockerfile', 'deploy/platform/partner-release-host.py',
            'deploy/platform/partner-rollout-host.py',
            'deploy/slicer-worker/Dockerfile.bambu', 'scripts/rehearse-partner.mjs',
            'neon/migrations/012_partner_outreach.sql', 'neon/migrations/013_partner_weekly_statements.sql',
            'package.json', 'package-lock.json'}
PREFIXES = ('api/', 'lib/', 'neon/', 'scripts/', 'deploy/', 'contracts/partner/', 'public/assets/js/')
MARKER = '.partner-release-proof.json'


def private_directory(path):
    if path.is_symlink() or not path.is_dir() or path.resolve() != path.absolute():
        raise ValueError('Private release directory is invalid.')
    if os.name == 'posix':
        stat = path.stat()
        if stat.st_uid != os.getuid() or stat.st_mode & 0o077:
            raise ValueError('Private release directory permissions are invalid.')


def validated_archive(config):
    if (not isinstance(config, dict)
            or not re.fullmatch(r'[a-f0-9]{40}', str(config.get('release', '')))
            or config.get('phase') not in ('rehearse', 'deploy')
            or not re.fullmatch(r'[a-f0-9]{64}', str(config.get('archiveSha256', '')))
            or not isinstance(config.get('archive'), str)
            or len(config['archive']) > ((MAX_ARCHIVE + 2) // 3) * 4):
        raise ValueError('Invalid committed release payload.')
    try:
        archive = base64.b64decode(config['archive'], validate=True)
    except (ValueError, TypeError):
        raise ValueError('Invalid release archive encoding.') from None
    if len(archive) > MAX_ARCHIVE or hashlib.sha256(archive).hexdigest() != config['archiveSha256']:
        raise ValueError('Release archive digest mismatch.')
    files, directories, seen = {}, set(), set()
    try:
        with tarfile.open(fileobj=io.BytesIO(archive), mode='r:') as tar:
            for member in tar:
                name = member.name.rstrip('/') if member.isdir() else member.name
                path = PurePosixPath(name)
                if (not name or path.is_absolute() or '..' in path.parts or '\\' in name
                        or str(path) != name or name in seen
                        or not (member.isfile() or member.isdir())
                        or any(part.startswith('.env') or part.endswith('.private.json')
                               or part.endswith('.private.env') for part in path.parts)):
                    raise ValueError('Unsafe release archive member.')
                allowed = name in ('package.json', 'package-lock.json') or name.startswith(PREFIXES)
                if member.isdir():
                    allowed = allowed or any(prefix.startswith(name + '/') for prefix in PREFIXES)
                if not allowed:
                    raise ValueError('Unexpected release archive member.')
                seen.add(name)
                if member.isdir():
                    directories.add(name)
                else:
                    stream = tar.extractfile(member)
                    if not stream or member.size > MAX_ARCHIVE:
                        raise ValueError('Unsupported release archive member.')
                    data = stream.read(MAX_ARCHIVE + 1)
                    if len(data) != member.size:
                        raise ValueError('Incomplete release archive member.')
                    files[name] = (data, bool(member.mode & 0o111))
    except tarfile.TarError:
        raise ValueError('Invalid release archive.') from None
    if (not REQUIRED.issubset(files)
            or not any(name.startswith('contracts/partner/') for name in files)
            or any(str(parent) in files for name in seen for parent in PurePosixPath(name).parents)):
        raise ValueError('Incomplete or conflicting release archive.')
    return files, directories


def prepare_source(config: dict, *, root: Path) -> Path:
    private_directory(root)
    files, directories = validated_archive(config)
    releases = root / 'releases'
    releases.mkdir(mode=0o700, exist_ok=True)
    private_directory(releases)
    source = releases / config['release']
    proof = {'release': config['release'], 'archiveSha256': config['archiveSha256'],
             'files': {name: hashlib.sha256(data).hexdigest() for name, (data, _) in files.items()}}
    if source.exists() or source.is_symlink():
        private_directory(source)
        marker = source / MARKER
        if marker.is_symlink() or not marker.is_file():
            raise ValueError('Existing release is incomplete.')
        try:
            if json.loads(marker.read_text(encoding='utf-8')) != proof:
                raise ValueError('Existing release has different source.')
        except (ValueError, OSError):
            raise ValueError('Existing release proof is invalid.') from None
        actual = set()
        for entry in source.rglob('*'):
            if entry.is_symlink() or not (entry.is_file() or entry.is_dir()):
                raise ValueError('Existing release contains unsafe source.')
            if entry.is_file() and entry != marker:
                name = entry.relative_to(source).as_posix()
                actual.add(name)
                if name not in files or hashlib.sha256(entry.read_bytes()).hexdigest() != proof['files'][name]:
                    raise ValueError('Existing release source was changed.')
        if actual != set(files):
            raise ValueError('Existing release source is incomplete.')
        return source
    staging = Path(tempfile.mkdtemp(prefix='.partner-source-', dir=releases))
    try:
        for name in directories:
            (staging / name).mkdir(parents=True, mode=0o700, exist_ok=True)
        for name, (data, executable) in files.items():
            target = staging / name
            target.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
            with target.open('xb') as stream:
                stream.write(data)
            # COPY preserves modes but assigns root ownership in both images.
            # The enclosing release root stays private; runtime source must be
            # readable by the images' non-root users.
            target.chmod(0o755 if executable else 0o644)
        for entry in staging.rglob('*'):
            if entry.is_dir():
                entry.chmod(0o755)
        (staging / MARKER).write_text(json.dumps(proof, sort_keys=True), encoding='utf-8')
        (staging / MARKER).chmod(0o600)
        staging.rename(source)
    finally:
        if staging.exists():
            if staging.resolve().parent != releases.resolve():
                raise ValueError('Unexpected release staging path.')
            shutil.rmtree(staging)
    return source


def private_file(root, name):
    path = root / name
    if path.is_symlink() or not path.is_file() or path.resolve().parent != root.resolve():
        raise ValueError('Private configuration file is invalid.')
    if os.name == 'posix' and (path.stat().st_uid != os.getuid() or path.stat().st_mode & 0o077):
        raise ValueError('Private configuration permissions are invalid.')
    return path


def read_env(root, name):
    values = {}
    for line in private_file(root, name).read_text(encoding='utf-8').splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        key, separator, value = line.partition('=')
        if not separator or not re.fullmatch(r'[A-Z][A-Z0-9_]*', key) or key in values:
            raise ValueError('Private environment format is invalid.')
        values[key] = json.loads(value) if value.startswith('"') else value
        if not isinstance(values[key], str):
            raise ValueError('Private environment value is invalid.')
    return values


def container_id(value, *, optional=False):
    if optional and not value:
        return value
    if not re.fullmatch(r'[a-f0-9]{64}', value):
        raise ValueError('Unexpected native service identity.')
    return value


NATIVE_PROBE = """import {readFileSync} from 'node:fs';
import pg from 'pg';
import {createNativeDatabase,nativePoolOptions} from './lib/database.js';
import {assertScratchEnvironment,verifyNativeSchema,rehearseDisabledRuntime} from './scripts/rehearse-partner.mjs';
const config=JSON.parse(readFileSync(0,'utf8'));Object.assign(process.env,config.env);
const url=assertScratchEnvironment(process.env);const pool=new pg.Pool(nativePoolOptions(url.href));
try {const checks={...await verifyNativeSchema({pool,env:process.env}),
...await rehearseDisabledRuntime({database:createNativeDatabase({pool}),env:process.env,programId:config.programId})};
console.log(JSON.stringify(checks));}finally{await pool.end();}
"""


ORIGIN_SERVER = """import pg from 'pg';
import {createNativeDatabase,nativePoolOptions} from './lib/database.js';
import {assertScratchEnvironment} from './scripts/rehearse-partner.mjs';
import {createPartnerRuntime} from './lib/partner-outreach/runtime.js';
import {createPartnerHandlers} from './lib/partner-outreach/http.js';
import {createPlatformServer} from './lib/platform/api-server.js';
const url=assertScratchEnvironment(process.env);const pool=new pg.Pool(nativePoolOptions(url.href));
const runtime=createPartnerRuntime({database:createNativeDatabase({pool}),env:process.env});
const partner=createPartnerHandlers({getRuntime:()=>runtime,env:process.env});
const server=createPlatformServer({...partner,env:{PLATFORM_PROXY_SECRET:'synthetic-rehearsal'},ready:()=>pool.query('SELECT 1')});
server.listen(8080,'0.0.0.0');process.on('SIGTERM',()=>server.close(async()=>{await pool.end();process.exit(0)}));
"""
CHECK_ORIGIN = """fetch('http://127.0.0.1:8080/internal/ready',{headers:{authorization:'Bearer synthetic-rehearsal'},signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"""
OVERLAP_PROBE = """let checked=0,failed=0;for(let i=0;i<48;i++){try{
const r=await fetch('http://api:8080/api/partner/v1/status',{signal:AbortSignal.timeout(2000)});
if(!r.ok||r.headers.get('cache-control')!=='no-store'||(await r.json()).invitationRequired!==true)failed++;
}catch{failed++;}checked++;await new Promise(r=>setTimeout(r,250));}console.log(JSON.stringify({checked,failed}));"""


def rehearse_overlap(*, root, runner, image, database_network, scratch_url):
    name = '3dprint4me-partner-rehearsal-' + uuid.uuid4().hex[:12]
    env_path = root / (name + '.private.env')
    fd = os.open(env_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as stream:
        stream.write('DATABASE_URL=' + scratch_url + '\n')
        for flag in ('PARTNER_PROGRAM_ENABLED', 'PARTNER_CLASSIFICATION_APPROVED', 'PARTNER_ACCOUNTING_APPROVED'):
            stream.write(flag + '=0\n')
    names, network_attempted, errors = [], False, []
    try:
        network_attempted = True
        runner(['docker', 'network', 'create', '--internal', '--label', '3dprint4me.purpose=partner-rehearsal', name])

        def start_origin(suffix):
            origin_name = name + '-' + suffix
            names.append(origin_name)
            cid = container_id(runner(['docker', 'run', '-d', '--name', origin_name,
                '--label', '3dprint4me.purpose=partner-rehearsal', '--network', database_network,
                '--env-file', str(env_path), '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges:true',
                '--memory=256m', '--pids-limit=64', image, 'node', '--input-type=module', '-e', ORIGIN_SERVER]))
            for _ in range(40):
                try:
                    runner(['docker', 'exec', cid, 'node', '-e', CHECK_ORIGIN])
                    break
                except Exception:
                    time.sleep(.25)
            else:
                raise RuntimeError('Disposable origin did not become ready.')
            runner(['docker', 'network', 'connect', '--alias', 'api', name, cid])
            return cid

        old = start_origin('old')
        probe_name = name + '-probe'
        names.append(probe_name)
        probe = container_id(runner(['docker', 'run', '-d', '--name', probe_name,
            '--label', '3dprint4me.purpose=partner-rehearsal', '--network', name, '--read-only',
            '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--memory=128m', '--pids-limit=64',
            image, 'node', '--input-type=module', '-e', OVERLAP_PROBE]))
        time.sleep(1)
        start_origin('new')
        time.sleep(1)
        runner(['docker', 'stop', '-t', '45', old])
        if runner(['docker', 'wait', probe], timeout=180) not in ('0', ''):
            raise RuntimeError('Disposable overlap probe failed.')
        if json.loads(runner(['docker', 'logs', probe])) != {'checked': 48, 'failed': 0}:
            raise RuntimeError('Disposable overlap lost requests.')
    finally:
        for container_name in names:
            try:
                matches = runner(['docker', 'ps', '-aq', '--no-trunc', '--filter', 'name=^/' + container_name + '$',
                                  '--filter', 'label=3dprint4me.purpose=partner-rehearsal'])
                if matches:
                    runner(['docker', 'rm', '-f', container_id(matches)])
            except Exception:
                errors.append('container-cleanup')
        if network_attempted:
            try:
                runner(['docker', 'network', 'rm', name])
            except Exception:
                errors.append('network-cleanup')
        env_path.unlink()
        if errors:
            raise RuntimeError('Disposable overlap cleanup requires attention.')


def run_release(config: dict, *, root: Path, runner) -> dict:
    """Rehearse without live writes; explicit deploy then consumes private context."""
    try:
        if config.get('phase') not in ('rehearse','deploy'):
            raise ValueError('Supported release phase is required.')
        if config['phase'] == 'deploy' and not isinstance(config.get('checkpoint'), dict):
            raise ValueError('Explicit deploy requires a fresh complete checkpoint.')
        private_directory(root)
        api_env, jobs_env = read_env(root, 'api.env'), read_env(root, 'jobs.env')
        for env in (api_env, jobs_env):
            for flag in ('PARTNER_PROGRAM_ENABLED', 'PARTNER_CLASSIFICATION_APPROVED', 'PARTNER_ACCOUNTING_APPROVED'):
                if env.get(flag, '0') != '0':
                    raise ValueError('Existing engagement must be disabled.')
        # Bootstrap selects business storage using the native control connection;
        # DATABASE_URL may still contain the retired source and must not be used.
        original = urlsplit(api_env['PLATFORM_CONTROL_DATABASE_URL'])
        if (original.scheme not in ('postgres', 'postgresql') or original.hostname != 'postgres'
                or original.username != 'platform_app' or original.path != '/platform'
                or original.query or original.fragment or original.port != 5432):
            raise ValueError('Native control connection is required.')
        compose = ['docker', 'compose', '--env-file', str(private_file(root, 'compose.env')),
                   '-f', str(root / 'candidate-source/deploy/platform/compose.yml')]
        pg = container_id(runner(compose + ['ps', '-q', 'postgres']))

        def sql(text, *, db='platform', user='platform_owner'):
            return runner(['docker', 'exec', '-i', pg, 'psql', '-X', '-U', user, '-d', db,
                           '-At', '-v', 'ON_ERROR_STOP=1'], input=text.encode('utf-8'))

        def snapshot():
            state = {name: hashlib.sha256(private_file(root, name).read_bytes()).hexdigest()
                     for name in ('api.env', 'jobs.env', 'compose.env', 'database-target.private.json')}
            pointer = root / 'candidate-source'
            state['source'] = str(pointer.resolve())
            state['services'] = {name: container_id(runner(compose + ['ps', '-q', name]), optional=name == 'jobs')
                                 for name in ('api', 'jobs', 'slicer', 'tunnel')}
            state['selected'] = sql('SELECT database_name FROM platform_deployment_state WHERE singleton=true')
            if not re.fullmatch(r'platform_live_[a-z0-9_]{1,48}', state['selected']):
                raise ValueError('A selected native database is required.')
            return state

        before = snapshot()
        source = prepare_source(config, root=root)
        rollout = None
        if config['phase'] == 'deploy':
            module_path = source/'deploy/platform/partner-rollout-host.py'
            rollout = types.ModuleType('partner_rollout')
            rollout.__file__ = str(module_path)
            # Load verified bytes without generating __pycache__ in immutable
            # release source or accepting an interpreter-generated cache there.
            exec(compile(module_path.read_bytes(), str(module_path), 'exec'), rollout.__dict__)
            rollout.checkpoint_ready(config['checkpoint'], before['selected'])
        images, tags = {}, {'api': '3dprint4me-platform:' + config['release'][:12],
                            'slicer': '3dprint4me-slicer:' + config['release'][:12]}
        for key, dockerfile in [('api', 'deploy/platform/Dockerfile'), ('slicer', 'deploy/slicer-worker/Dockerfile.bambu')]:
            runner(['docker', 'build', '-t', tags[key], '-f', str(source / dockerfile), str(source)], timeout=1800)
            images[key] = runner(['docker', 'image', 'inspect', tags[key], '--format', '{{.Id}}'])
            if not re.fullmatch(r'sha256:[a-f0-9]{64}', images[key]):
                raise ValueError('Candidate image identity is unavailable.')
        networks = json.loads(runner(['docker', 'inspect', pg, '--format', '{{json .NetworkSettings.Networks}}']))
        choices = [name for name in networks if name.endswith('_database')]
        if len(choices) != 1:
            raise ValueError('Native database network is ambiguous.')
        database_network = choices[0]
        if runner(['docker', 'network', 'inspect', database_network, '--format', '{{.Internal}}']) != 'true':
            raise ValueError('Disposable database network must block external egress.')
        scratch = 'platform_partner_rehearsal_' + uuid.uuid4().hex[:12]
        scratch_url = urlunsplit((original.scheme, original.netloc, '/' + scratch, '', ''))
        if any(char in scratch_url for char in '\r\n'):
            raise ValueError('Invalid disposable connection value.')
        if sql("SELECT count(*) FROM pg_database WHERE datname='" + scratch + "'", db='postgres', user='platform_admin') != '0':
            raise ValueError('Disposable database name is already present.')
        checks, cleanup_errors, failure = {}, [], None
        try:
            sql('CREATE DATABASE ' + scratch + ' OWNER platform_owner', db='postgres', user='platform_admin')
            for migration in sorted((source / 'neon/migrations').glob('*.sql')):
                sql("BEGIN;SET LOCAL lock_timeout='5s';" + migration.read_text(encoding='utf-8') + '\nCOMMIT;', db=scratch)
            program_id = str(uuid.uuid4())
            sql("INSERT INTO partner_programs(id,label,starts_on,synthetic) VALUES('" + program_id
                + "','Synthetic disabled release rehearsal','2026-10-01',true)", db=scratch)
            env = {'DATABASE_URL': scratch_url, 'PARTNER_PROGRAM_ENABLED': '0',
                   'PARTNER_CLASSIFICATION_APPROVED': '0', 'PARTNER_ACCOUNTING_APPROVED': '0'}
            checks = json.loads(runner(['docker', 'run', '--rm', '-i', '--network', database_network,
                '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--memory=256m',
                '--pids-limit=64', images['api'], 'node', '--input-type=module', '-e', NATIVE_PROBE],
                input=json.dumps({'env': env, 'programId': program_id}).encode('utf-8')))
            if checks != {key: True for key in ('schema', 'leastPrivilege', 'disabledProgram', 'sessionDenials', 'noMessagesSent')}:
                raise ValueError('Disposable native proof is incomplete.')
            rehearse_overlap(root=root, runner=runner, image=images['api'], database_network=database_network, scratch_url=scratch_url)
            checks['isolatedApiOverlap'] = True
        except Exception:
            failure = True
        finally:
            try:
                sql('DROP DATABASE ' + scratch + ' WITH (FORCE)', db='postgres', user='platform_admin')
            except Exception:
                cleanup_errors.append('scratch-database')
        if failure or cleanup_errors:
            raise RuntimeError('Disposable native rehearsal or cleanup requires attention.')
        checks['scratchCleanup'] = True
        if snapshot() != before:
            raise RuntimeError('Live configuration changed during rehearsal; inspect private state.')
        checks['liveStateUnchanged'] = True
        proof = {'phase': 'rehearse', 'status': 'passed', 'release': config['release'],
                 'archiveSha256': config['archiveSha256'], 'images': images, 'checks': checks}
        if rollout is not None:
            context = {'root':root, 'source':source, 'release':config['release'], 'postgres':pg,
                       'selected':before['selected'], 'images':images, 'previous':before,
                       'rehearsalProof':proof, 'checkpoint':config['checkpoint']}
            deployed = rollout.deploy_release(context, runner=runner)
            proof = {**proof, 'phase':'deploy', 'checks':{**checks, **deployed}}
        return proof
    except Exception:
        raise RuntimeError('Partner release stopped; retain private rollout state and any admitted guard before owner recovery.') from None


def main():
    root = Path('/home/jd/3dprint4me-platform')
    try:
        if os.name != 'posix':
            raise ValueError('Native Linux host is required.')
        import fcntl
        private_directory(root)
        # The lock belongs to this protocol, never to a payload-selected path.
        fd = os.open(root / '.partner-release.lock', os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as lock:
            stat = os.fstat(lock.fileno())
            if stat.st_uid != os.getuid() or stat.st_mode & 0o077 or stat.st_nlink != 1:
                raise ValueError('Private release lock is invalid.')
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            raw = sys.stdin.buffer.read(46 * 1024 * 1024 + 1)
            if len(raw) > 46 * 1024 * 1024:
                raise ValueError('Release payload is oversized.')
            config = json.loads(raw)
            diagnostic = root / ('partner-release-' + uuid.uuid4().hex[:12] + '.private.jsonl')
            log_fd = os.open(diagnostic, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(log_fd, 'w', encoding='utf-8') as log:
                def runner(args, *, input=None, timeout=180):
                    # Record only an operation label and status; never argv, SQL,
                    # stdin, environment values, provider output or raw errors.
                    started = time.monotonic()
                    try:
                        result = subprocess.run(args, input=input, stdout=subprocess.PIPE,
                                                stderr=subprocess.PIPE, timeout=timeout, check=True)
                        return result.stdout.decode('utf-8').strip()
                    finally:
                        log.write(json.dumps({'operation': ' '.join(args[:2]),
                                              'elapsedSeconds': round(time.monotonic() - started, 3)}) + '\n')
                        log.flush()
                proof = run_release(config, root=root, runner=runner)
                log.write(json.dumps(proof) + '\n')
            print(json.dumps(proof))
        return 0
    except Exception:
        print('Partner release stopped; retain private rollout state and any admitted guard before owner recovery.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
