"""Guarded additive partner rollout; called only with host-private verified context.

Failures retain migration data and a published guard. Recovery is a deliberate
forward repair, never an automatic restore of an earlier database or source.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import time
import uuid
from urllib.parse import urlsplit

FLAGS = ('PARTNER_PROGRAM_ENABLED', 'PARTNER_CLASSIFICATION_APPROVED', 'PARTNER_ACCOUNTING_APPROVED')


def private_path(path, *, directory=False):
    if path.is_symlink() or not (path.is_dir() if directory else path.is_file()):
        raise ValueError('Private rollout path is invalid.')
    if os.name == 'posix' and (path.stat().st_uid != os.getuid() or path.stat().st_mode & 0o077):
        raise ValueError('Private rollout permissions are invalid.')
    return path


def read_env(path):
    values = {}
    for line in private_path(path).read_text(encoding='utf-8').splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        key, separator, value = line.partition('=')
        if not separator or not re.fullmatch(r'[A-Z][A-Z0-9_]*', key) or key in values:
            raise ValueError('Private rollout environment is invalid.')
        values[key] = json.loads(value) if value.startswith('"') else value
        if not isinstance(values[key], str):
            raise ValueError('Private rollout environment is invalid.')
    return values


def atomic_write(path, data, *, replace=False):
    if replace:
        private_path(path)
    elif path.exists() or path.is_symlink():
        raise ValueError('Existing rollout state requires owner inspection.')
    temporary = path.with_name(path.name + '.next')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def set_env(path, changes):
    current = read_env(path)
    if all(current.get(key) == value for key, value in changes.items()):
        return
    # Preserve every unrelated byte, including provider quoting/escaping.
    retained = [line for line in path.read_bytes().splitlines(keepends=True)
                if line.split(b'=', 1)[0].decode('utf-8') not in changes]
    data = b''.join(retained)
    if data and not data.endswith(b'\n'):
        data += b'\n'
    data += ''.join(key + '=' + value + '\n' for key, value in changes.items()).encode('utf-8')
    atomic_write(path, data, replace=True)


def checkpoint_ready(checkpoint, selected):
    if (not isinstance(checkpoint, dict) or checkpoint.get('roundtripVerified') is not True
            or type(checkpoint.get('createdAt')) is not int
            or not -30 <= time.time() - checkpoint['createdAt'] <= 1800
            or checkpoint.get('databases') != ['platform', selected]):
        raise ValueError('A fresh complete native checkpoint is required.')
    for key in ('databaseSha256', 'objectSha256'):
        if not re.fullmatch(r'[a-f0-9]{64}', str(checkpoint.get(key, ''))):
            raise ValueError('Complete checkpoint identity is required.')
    for key in ('databaseSnapshots', 'objectSnapshots', 'checkpointReceipts'):
        ids = checkpoint.get(key)
        if not isinstance(ids, list) or len(ids) < 2 or any(not re.fullmatch(r'[a-f0-9]{64}', str(value)) for value in ids):
            raise ValueError('Two readback-verified checkpoint stores are required.')


API_SMOKE = """const flags=['PARTNER_PROGRAM_ENABLED','PARTNER_CLASSIFICATION_APPROVED','PARTNER_ACCOUNTING_APPROVED'];
if(flags.some(key=>process.env[key]!=='0'))throw Error('Disabled rollout required');
const base='http://127.0.0.1:8080';async function get(path,options){const r=await fetch(base+path,{...options,signal:AbortSignal.timeout(5000)});
if(r.headers.get('cache-control')!=='no-store')throw Error('Private cache boundary failed');return {status:r.status,body:await r.json()};}
const status=await get('/api/partner/v1/status');if(status.status!==200||status.body.invitationRequired!==true)throw Error('Partner status failed');
for(const path of ['/api/partner/v1/session','/api/partner/v1/gigs','/api/operator-partners'])if((await get(path)).status!==401)throw Error('Private denial failed');
if((await get('/api/partner/v1/status',{headers:{Origin:'https://untrusted.invalid'}})).status!==403)throw Error('Origin denial failed');
console.log(JSON.stringify({featureOff:true,privateDenied:true,originDenied:true}));"""

STATEMENT_POLL_PARSER = """function parseStatementPoll(text,{startedAt,now,maxAge=180000}) {
try {
if(typeof text!=='string'||Buffer.byteLength(text)>512||!Number.isSafeInteger(startedAt)||!Number.isSafeInteger(now)||!Number.isSafeInteger(maxAge)||maxAge<1)return null;
const row=JSON.parse(text),c=row?.counts;
if(row?.name!=='statements'||typeof row.ok!=='boolean'||!Number.isSafeInteger(row.observedAt)||row.observedAt<startedAt||row.observedAt>now+30000||now-row.observedAt>maxAge||!c||typeof c!=='object'||Array.isArray(c))return null;
if(['claimed','generated','skipped'].some(k=>!Number.isSafeInteger(c[k])||c[k]<0)||!Number.isSafeInteger(c.generated+c.skipped)||c.generated+c.skipped!==c.claimed)return null;
if(['failed','retrying','errors'].some(k=>Object.hasOwn(c,k)&&(!Number.isSafeInteger(c[k])||c[k]!==0)))return null;
if(!row.ok&&c.claimed!==0)return null;
return {statementsProcessingHealthy:row.ok};
}catch{return null;}
}
"""
JOBS_SMOKE = """import{readFileSync,openSync,readSync,closeSync}from'node:fs';
""" + STATEMENT_POLL_PARSER + """
const config=JSON.parse(readFileSync(0,'utf8')),url=new URL(process.env.DATABASE_URL);
if(process.env.PLATFORM_JOBS_ENABLED!=='1'||process.env.DATABASE_DRIVER!=='postgres'||url.hostname!=='postgres'||url.username!=='platform_app'||url.pathname!=='/'+config.selected)throw Error('Native writer scope failed');
if(['PARTNER_PROGRAM_ENABLED','PARTNER_CLASSIFICATION_APPROVED','PARTNER_ACCOUNTING_APPROVED'].some(key=>process.env[key]!=='0'))throw Error('Disabled rollout required');
let poll=null;for(let i=0;i<90;i++){const directory=process.env.PLATFORM_JOB_HEALTH_DIR;
try{const fd=openSync(directory+'/statements.json','r');let text;try{const b=Buffer.alloc(513);text=b.subarray(0,readSync(fd,b,0,b.length,0)).toString('utf8');}finally{closeSync(fd);}
poll=parseStatementPoll(text,{startedAt:config.startedAt,now:Date.now()});if(poll)break;}catch{}
await new Promise(r=>setTimeout(r,1000));}if(!poll)throw Error('Fresh statement worker poll evidence unavailable');
console.log(JSON.stringify({nativeWriter:true,flagsOff:true,statementsPolled:true,...poll}));"""

def writer_proof(value):
    return (isinstance(value, dict) and set(value) == {'nativeWriter','flagsOff','statementsPolled','statementsProcessingHealthy'}
            and all(value[key] is True for key in ('nativeWriter','flagsOff','statementsPolled'))
            and type(value['statementsProcessingHealthy']) is bool)

def source_tree_sha256(source):
    """Compare with a digest derived independently from the verified release archive."""
    digest = hashlib.sha256()
    for path in sorted(Path(source).rglob('*'), key=lambda path:path.relative_to(source).as_posix()):
        if path.is_symlink():
            raise ValueError('Release source must not contain symbolic links.')
        if path.is_file():
            digest.update(path.relative_to(source).as_posix().encode('utf-8') + b'\0'
                          + hashlib.sha256(path.read_bytes()).hexdigest().encode('ascii') + b'\n')
    return digest.hexdigest()

def resume_admitted_release(verified_context, *, runner):
    """Forward-only completion of one inspected candidate-api-admitted journal.

    Caller holds the deployment lock and supplies independently verified private
    hashes/identities. Never restart services, rerun migrations or rewrite health.
    """
    try:
        ctx = verified_context
        root, source, release = Path(ctx['root']), Path(ctx['source']), ctx['release']
        selected, pg, images, expected = ctx['selected'], ctx['postgres'], ctx['images'], ctx['resume']
        if (not re.fullmatch(r'[a-f0-9]{40}', release) or source != root/'releases'/release
                or not re.fullmatch(r'platform_live_[a-z0-9_]{1,48}', selected)
                or not re.fullmatch(r'[a-f0-9]{64}', pg)
                or set(images) != {'api','slicer'}
                or any(not re.fullmatch(r'sha256:[a-f0-9]{64}', value) for value in images.values())):
            raise ValueError('Verified admitted release context required.')
        private_path(root, directory=True)
        private_path(source, directory=True)
        checkpoint_ready(ctx.get('checkpoint'), selected)
        journal = root/('partner-rollout-'+release[:12]+'.private.json')
        override = root/('partner-rollout-'+release[:12]+'.private.yml')
        config_names = {'api.env','jobs.env','compose.env','database-target.private.json'}
        if (set(expected['configSha256']) != config_names
                or not re.fullmatch(r'[a-f0-9]{64}', expected['jobs'])
                or not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,62}', expected['project'])
                or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}_egress', expected['egress'])):
            raise ValueError('Verified resume identities required.')
        def unchanged():
            for path, wanted in [(journal,expected['journalSha256']), (override,expected['overrideSha256'])] + [(root/name,expected['configSha256'][name]) for name in sorted(config_names)]:
                if not re.fullmatch(r'[a-f0-9]{64}', wanted) or hashlib.sha256(private_path(path).read_bytes()).hexdigest() != wanted:
                    raise ValueError('Private rollout state changed.')
            if ((root/'candidate-source').is_symlink() is not True or (root/'candidate-source').resolve() != source.resolve()
                    or not re.fullmatch(r'[a-f0-9]{64}', expected['sourceSha256'])
                    or source_tree_sha256(source) != expected['sourceSha256']):
                raise ValueError('Immutable admitted source changed.')
            for name in ('api.env','jobs.env'):
                if any(read_env(root/name).get(flag) != '0' for flag in FLAGS):
                    raise ValueError('Engagement must remain disabled.')
            if read_env(root/'compose.env').get('PLATFORM_RELEASE') != release[:12]:
                raise ValueError('Selected release changed.')
        unchanged()
        state = json.loads(journal.read_text(encoding='utf-8'))
        if (state.get('stage') != 'candidate-api-admitted' or state.get('release') != release
                or state.get('selected') != selected or state.get('candidateImages') != images):
            raise ValueError('Only an inspected admitted candidate can resume.')
        for key in ('api','guard'):
            if not re.fullmatch(r'[a-f0-9]{64}', state.get(key,'')):
                raise ValueError('Admitted API identities missing.')
        if len({state['api'],state['guard'],expected['jobs']}) != 3:
            raise ValueError('Distinct admitted services required.')
        compose = ['docker','compose','--env-file',str(root/'compose.env'),'-f',str(source/'deploy/platform/compose.yml'),'-f',str(override)]
        def validate_live():
            unchanged()
            answer = runner(['docker','exec','-i',pg,'psql','-X','-U','platform_owner','-d','platform','-At','-v','ON_ERROR_STOP=1'],input=b'SELECT database_name FROM platform_deployment_state WHERE singleton=true')
            if answer != selected:
                raise ValueError('Selected native generation changed.')
            for name, cid in [('api',state['api']),('api_guard',state['guard']),('jobs',expected['jobs'])]:
                if runner(compose+['ps','-q',name]) != cid:
                    raise ValueError('Admitted service identity changed.')
                if (runner(['docker','inspect',cid,'--format','{{.Image}}']) != images['api']
                        or runner(['docker','inspect',cid,'--format','{{.State.Running}}']) != 'true'
                        or runner(['docker','inspect',cid,'--format','{{index .Config.Labels "com.docker.compose.project"}}']) != expected['project']):
                    raise ValueError('Admitted service is incompatible.')
                if name != 'jobs':
                    if runner(['docker','inspect',cid,'--format','{{.Image}} {{.State.Running}} {{.State.Health.Status}}']) != images['api']+' true healthy':
                        raise ValueError('Admitted API is unhealthy.')
                    networks = json.loads(runner(['docker','inspect',cid,'--format','{{json .NetworkSettings.Networks}}']))
                    if 'api' not in networks.get(expected['egress'],{}).get('Aliases',[]):
                        raise ValueError('Admitted API network changed.')
                    if json.loads(runner(['docker','exec',cid,'node','--input-type=module','-e',API_SMOKE])) != {'featureOff':True,'privateDenied':True,'originDenied':True}:
                        raise ValueError('Admitted API smoke failed.')
            for name in ('slicer','tunnel'):
                cid = state['previousServices'][name]
                if (runner(compose+['ps','-q',name]) != cid
                        or runner(['docker','inspect',cid,'--format','{{.Image}}']) != state['previousImages'][name]
                        or runner(['docker','inspect',cid,'--format','{{.State.Running}}']) != 'true'):
                    raise ValueError('Unrelated service changed.')
            old_jobs = state['previousServices']['jobs']
            if old_jobs and (not re.fullmatch(r'[a-f0-9]{64}',old_jobs) or old_jobs == expected['jobs']
                             or runner(['docker','ps','-q','--no-trunc','--filter','id='+old_jobs])):
                raise ValueError('Prior writer has not drained.')
        started_at = int(time.time()*1000)
        validate_live()
        proof = json.loads(runner(['docker','exec','-i',expected['jobs'],'node','--input-type=module','-e',JOBS_SMOKE],input=json.dumps({'selected':selected,'startedAt':started_at}).encode(),timeout=120))
        if not writer_proof(proof):
            raise ValueError('Fresh writer poll evidence unavailable.')
        validate_live()
        checkpoint_ready(ctx.get('checkpoint'), selected)
        state['writerProof'] = proof
        state['resumeCheckpointReceipts'] = ctx['checkpoint']['checkpointReceipts']
        state['stage'] = 'compatible-writer-intent-preserved'
        atomic_write(journal,json.dumps(state,sort_keys=True).encode(),replace=True)
        runner(['docker','stop','-t','45',state['guard']],timeout=90)
        if runner(['docker','inspect',state['guard'],'--format','{{.State.Running}}']) != 'false':
            raise RuntimeError('Guard did not drain.')
        runner(['docker','rm',state['guard']])
        state['stage'] = 'disabled-rollout-passed'
        atomic_write(journal,json.dumps(state,sort_keys=True).encode(),replace=True)
        override.unlink()
        return proof
    except Exception:
        raise RuntimeError('Admitted rollout resume stopped; retain private state and inspect admitted API/guard before further recovery.') from None


def deploy_release(verified_context, *, runner):
    """Deploy after verified rehearsal/checkpoint; serialize no private context."""
    try:
        ctx = verified_context
        root, source, release = Path(ctx['root']), Path(ctx['source']), ctx['release']
        selected, pg, previous, images = ctx['selected'], ctx['postgres'], ctx['previous'], ctx['images']
        if (not re.fullmatch(r'[a-f0-9]{40}', release)
                or not re.fullmatch(r'platform_live_[a-z0-9_]{1,48}', selected)
                or not re.fullmatch(r'[a-f0-9]{64}', pg)
                or source != root / 'releases' / release):
            raise ValueError('Verified native release context is required.')
        private_path(root, directory=True)
        private_path(source, directory=True)
        checkpoint_ready(ctx.get('checkpoint'), selected)
        rehearsal = ctx['rehearsalProof']
        required_checks = {'schema','leastPrivilege','disabledProgram','sessionDenials','noMessagesSent',
                           'isolatedApiOverlap','scratchCleanup','liveStateUnchanged'}
        if (rehearsal.get('status') != 'passed' or rehearsal.get('release') != release
                or rehearsal.get('phase') != 'rehearse'
                or not re.fullmatch(r'[a-f0-9]{64}',str(rehearsal.get('archiveSha256','')))
                or rehearsal.get('images') != images or set(rehearsal.get('checks', {})) != required_checks
                or any(value is not True for value in rehearsal['checks'].values())):
            raise ValueError('An unchanged-state candidate rehearsal is required.')
        if set(images) != {'api', 'slicer'} or any(not re.fullmatch(r'sha256:[a-f0-9]{64}', value) for value in images.values()):
            raise ValueError('Immutable candidate images are required.')
        api_env, jobs_env = read_env(root/'api.env'), read_env(root/'jobs.env')
        for values in (api_env, jobs_env):
            if any(values.get(flag, '0') != '0' for flag in FLAGS):
                raise ValueError('Existing engagement must remain disabled.')
        for name in ('api.env', 'jobs.env', 'compose.env', 'database-target.private.json'):
            if hashlib.sha256(private_path(root/name).read_bytes()).hexdigest() != previous[name]:
                raise ValueError('Configuration changed after the candidate rehearsal.')
        if str((root/'candidate-source').resolve()) != previous['source'] or previous['selected'] != selected:
            raise ValueError('Selected source or native generation changed.')
        jobs_enabled = jobs_env.get('PLATFORM_JOBS_ENABLED', '0') == '1'
        if jobs_env.get('PLATFORM_JOBS_ENABLED', '0') not in ('0', '1'):
            raise ValueError('Writer intent is invalid.')
        if previous['services']['jobs'] and not jobs_enabled:
            raise ValueError('Unexpected running writer requires owner inspection.')
        if jobs_enabled:
            url = urlsplit(jobs_env['DATABASE_URL'])
            if (jobs_env.get('DATABASE_DRIVER') != 'postgres' or url.hostname != 'postgres'
                    or url.username != 'platform_app' or url.path != '/'+selected or url.query or url.fragment):
                raise ValueError('Existing writer must use selected native storage.')
        compose = ['docker', 'compose', '--env-file', str(root/'compose.env'), '-f', str(source/'deploy/platform/compose.yml')]

        def cid(name):
            value = runner((full if name == 'api_guard' else compose)+['ps', '-q', name])
            if value and not re.fullmatch(r'[a-f0-9]{64}', value):
                raise ValueError('Service identity is invalid.')
            return value

        def sql(text):
            return runner(['docker','exec','-i',pg,'psql','-X','-U','platform_owner','-d',
                           'platform' if text.startswith('SELECT database_name') else selected,
                           '-At','-v','ON_ERROR_STOP=1'], input=text.encode('utf-8'))

        def assert_selection():
            if sql('SELECT database_name FROM platform_deployment_state WHERE singleton=true') != selected:
                raise ValueError('Native selection changed during release.')

        assert_selection()
        if any(cid(name) != value for name,value in previous['services'].items()):
            raise ValueError('Service identity changed after rehearsal.')
        old_images = {name: runner(['docker','inspect',value,'--format','{{.Image}}'])
                      for name,value in previous['services'].items() if value}
        if any(not re.fullmatch(r'sha256:[a-f0-9]{64}', value) for value in old_images.values()):
            raise ValueError('Prior image identities are unavailable.')
        project = runner(['docker','inspect',previous['services']['api'],'--format',
                          '{{index .Config.Labels "com.docker.compose.project"}}'])
        if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,62}',project):
            raise ValueError('Existing Compose project identity is unavailable.')
        if runner(['docker','ps','-aq','--no-trunc','--filter','label=com.docker.compose.project='+project,
                   '--filter','label=com.docker.compose.service=api_guard']):
            raise ValueError('Existing guarded rollout requires owner inspection before retry.')
        networks = json.loads(runner(['docker','inspect',previous['services']['api'], '--format','{{json .NetworkSettings.Networks}}']))
        egress = [name for name in networks if name.endswith('_egress')]
        if len(egress) != 1:
            raise ValueError('Existing API egress network is ambiguous.')
        journal = root / ('partner-rollout-'+release[:12]+'.private.json')
        override = root / ('partner-rollout-'+release[:12]+'.private.yml')
        state = {'release': release, 'selected': selected, 'previousSource': previous['source'],
                 'previousServices': previous['services'], 'previousImages': old_images,
                 'candidateImages': images, 'checkpointReceipts': ctx['checkpoint']['checkpointReceipts'],
                 'stage': 'preflight-passed'}
        atomic_write(journal, json.dumps(state, sort_keys=True).encode())

        def stage(value):
            state['stage'] = value
            atomic_write(journal, json.dumps(state, sort_keys=True).encode(), replace=True)

        policy = '    environment: {' + ', '.join(flag+': "0"' for flag in FLAGS) + '}\n'
        content = ('services:\n  api:\n    image: '+json.dumps(images['api'])+'\n    networks: !override [database]\n'+policy
                   +'  jobs:\n    image: '+json.dumps(images['api'])+'\n'+policy
                   +'  api_guard:\n    extends: {file: '+json.dumps(str(source/'deploy/platform/compose.yml'))+', service: api}\n'
                   +'    image: '+json.dumps(images['api'])+'\n    networks: !override [database]\n'+policy)
        atomic_write(override, content.encode('utf-8'))
        full = compose+['-f',str(override)]
        runner(full+['config','--quiet'])
        migrations = '\n'.join((source/'neon/migrations'/name).read_text(encoding='utf-8')
                               for name in ('012_partner_outreach.sql','013_partner_weekly_statements.sql','014_work_communications.sql','015_operator_model_revisions.sql', '016_partner_statement_rls.sql','017_notification_skipped.sql','018_supply_ledger.sql','019_product_catalogue.sql','020_invoice_tracking.sql'))
        assert_selection()
        sql("BEGIN;SET LOCAL lock_timeout='5s';"+migrations+'\nCOMMIT;')
        stage('selected-native-partner-schema-ready')

        def healthy(name):
            runner(full+['up','-d','--wait','--wait-timeout','75','--no-deps',name], timeout=120)
            service = cid(name)
            if not service or runner(['docker','inspect',service,'--format','{{.Image}} {{.State.Running}} {{.State.Health.Status}}']) != images['api']+' true healthy':
                raise RuntimeError('Candidate API is not healthy.')
            if json.loads(runner(['docker','exec',service,'node','--input-type=module','-e',API_SMOKE])) != {'featureOff': True, 'privateDenied': True, 'originDenied': True}:
                raise RuntimeError('Candidate API admission checks failed.')
            return service

        guard = healthy('api_guard')
        assert_selection()
        runner(['docker','network','connect','--alias','api',egress[0],guard])
        state['guard'] = guard
        stage('guarded-api-admitted')

        def stop(service):
            runner(['docker','stop','-t','45',service], timeout=90)
            if runner(['docker','inspect',service,'--format','{{.State.Running}}']) != 'false':
                raise RuntimeError('Prior service has not drained.')

        if previous['services']['jobs']:
            stop(previous['services']['jobs'])
        stage('prior-jobs-drained')
        assert_selection()
        stop(previous['services']['api'])
        runner(['docker','rm',previous['services']['api']])
        stage('prior-api-drained-guard-serving')
        for name in ('api.env','jobs.env'):
            set_env(root/name, {flag:'0' for flag in FLAGS})
        pointer, next_pointer = root/'candidate-source', root/'candidate-source.next'
        if next_pointer.exists() or next_pointer.is_symlink():
            raise ValueError('Existing source switch requires owner inspection.')
        next_pointer.symlink_to(source, target_is_directory=True)
        if not pointer.is_symlink():
            prior = root/'releases'/('source-before-partner-'+uuid.uuid4().hex[:12])
            pointer.rename(prior)
            state['retainedPreviousSource'] = str(prior)
            stage('prior-source-retained-guard-serving')
        os.replace(next_pointer, pointer)
        set_env(root/'compose.env', {'PLATFORM_RELEASE': release[:12]})
        stage('candidate-source-selected-guard-serving')
        final_api = healthy('api')
        assert_selection()
        runner(['docker','network','connect','--alias','api',egress[0],final_api])
        state['api'] = final_api
        stage('candidate-api-admitted')
        if jobs_enabled:
            started_at = int(time.time()*1000)
            runner(full+['--profile','writers','up','-d','--wait','--wait-timeout','75','--no-deps','jobs'], timeout=120)
            jobs = cid('jobs')
            if (not jobs or runner(['docker','inspect',jobs,'--format','{{.Image}}']) != images['api']
                    or runner(['docker','inspect',jobs,'--format','{{.State.Running}}']) != 'true'):
                raise RuntimeError('Compatible writer did not start.')
            proof = json.loads(runner(['docker','exec','-i',jobs,'node','--input-type=module','-e',JOBS_SMOKE],
                                     input=json.dumps({'selected':selected,'startedAt':started_at}).encode(), timeout=120))
            if not writer_proof(proof):
                raise RuntimeError('Compatible writer evidence is unavailable.')
            state['writerProof'] = proof
        stage('compatible-writer-intent-preserved')
        for name in ('slicer','tunnel'):
            current = cid(name)
            if current != previous['services'][name] or runner(['docker','inspect',current,'--format','{{.Image}}']) != old_images[name]:
                raise RuntimeError('An unrelated service changed during release.')
        assert_selection()
        if hashlib.sha256(private_path(root/'database-target.private.json').read_bytes()).hexdigest() != previous['database-target.private.json']:
            raise RuntimeError('Private database target changed during release.')
        for name, original in [('api.env',api_env),('jobs.env',jobs_env)]:
            actual = read_env(root/name)
            if ({k:v for k,v in actual.items() if k not in FLAGS} != {k:v for k,v in original.items() if k not in FLAGS}
                    or any(actual.get(flag) != '0' for flag in FLAGS)):
                raise RuntimeError('Private environment changed unexpectedly.')
        stop(guard)
        runner(['docker','rm',guard])
        stage('disabled-rollout-passed')
        override.unlink()
        return {'freshCheckpoint': True, 'guardedApi': True, 'jobsHandover': True,
                'featureOffSmoke': True, 'existingServices': True}
    except Exception:
        raise RuntimeError('Partner rollout stopped; retain private rollout state and healthy guard for owner recovery.') from None
