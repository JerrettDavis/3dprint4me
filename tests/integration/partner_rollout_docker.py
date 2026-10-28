"""Exercise the rollout against an isolated synthetic Compose installation.

Requires an already built candidate API image. Uses no production configuration,
provider accounts, published ports, customer records or actual backup credentials.
Checkpoint metadata here is explicitly synthetic: real Restic readback has its
own integration test and is required by the real release CLI.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
PG_IMAGE = 'postgres:18@sha256:edb0c08dc33befd0262ab3b5cf1c4f3f8cfd8b09e88c05b45adee29d6761ddb6'
FLAGS = ('PARTNER_PROGRAM_ENABLED', 'PARTNER_CLASSIFICATION_APPROVED', 'PARTNER_ACCOUNTING_APPROVED')


def main(image, diagnostics=None):
    spec = importlib.util.spec_from_file_location('partner_rollout', ROOT/'deploy/platform/partner-rollout-host.py')
    rollout = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rollout)
    commands = []

    def run(args, *, input=None, timeout=180):
        commands.append(args)
        result = subprocess.run(args, input=input, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
        if result.returncode:
            if diagnostics:
                diagnostics.write_bytes(result.stderr)
            raise RuntimeError('Isolated rollout command failed: ' + ' '.join(args[:2]))
        return result.stdout.decode('utf-8').strip()

    api_image = run(['docker','image','inspect',image,'--format','{{.Id}}'])
    suffix = uuid.uuid4().hex[:12]
    project = 'partner-rollout-native-'+suffix
    selected, release = 'platform_live_'+suffix, 'a'*40
    with tempfile.TemporaryDirectory(prefix='partner-native-rollout-') as directory:
        root = Path(directory)
        root.chmod(0o700)
        source = root/'releases'/release
        (source/'neon/migrations').mkdir(parents=True)
        source.chmod(0o700)
        for name in ('012_partner_outreach.sql','013_partner_weekly_statements.sql','014_work_communications.sql','015_operator_model_revisions.sql'):
            (source/'neon/migrations'/name).write_bytes((ROOT/'neon/migrations'/name).read_bytes())
        old_source = root/'candidate-source'
        old_source.mkdir(mode=0o700)
        (old_source/'old-source-marker').write_text('synthetic prior source',encoding='utf-8')
        secret = 'synthetic-credential-'+'x'*32
        api_env = {'DATABASE_URL':'postgresql://retired@retired.invalid/source','DATABASE_DRIVER':'postgres',
                   'PLATFORM_CONTROL_DATABASE_URL':'postgresql://platform_app:'+secret+'@postgres:5432/platform',
                   'PLATFORM_TARGET_AUTH_PROVIDER':'github','OPERATOR_AUTH_PROVIDER':'github',
                   'OPERATOR_OWNER_SUBJECT':'1234','GITHUB_CLIENT_ID':'synthetic-client','GITHUB_CLIENT_SECRET':secret,
                   'PLATFORM_PROXY_SECRET':secret,'INQUIRY_WORKFLOW_ENABLED':'1',**{flag:'0' for flag in FLAGS}}
        vapid = json.loads(run(['docker','run','--rm','--network','none',api_image,'node','-e',
                               "process.stdout.write(JSON.stringify(require('web-push').generateVAPIDKeys()))"]))
        jobs_env = {'DATABASE_DRIVER':'postgres','DATABASE_URL':'postgresql://platform_app:'+secret+'@postgres:5432/'+selected,
                    'PLATFORM_JOBS_ENABLED':'1','VAPID_SUBJECT':'mailto:synthetic@example.invalid',
                    'VAPID_PUBLIC_KEY':vapid['publicKey'],'VAPID_PRIVATE_KEY':vapid['privateKey'],**{flag:'0' for flag in FLAGS}}
        for name, values in [('api.env',api_env),('jobs.env',jobs_env),('compose.env',{'PLATFORM_RELEASE':'synthetic-old','PLATFORM_CONFIG_DIR':str(root)})]:
            (root/name).write_text(''.join(k+'='+json.dumps(v)+'\n' for k,v in values.items()),encoding='utf-8',newline='\n')
            (root/name).chmod(0o600)
        (root/'database-target.private.json').write_text('{"version":1,"phase":"prepared"}',encoding='utf-8')
        (root/'database-target.private.json').chmod(0o600)
        common = {'image':api_image,'read_only':True,'cap_drop':['ALL'],'security_opt':['no-new-privileges:true'],
                  'networks':['database','egress'],'labels':{'3dprint4me.purpose':'partner-rollout-native'}}
        config = {'name':project,'services':{
            'postgres':{'image':PG_IMAGE,'environment':{'POSTGRES_USER':'platform_admin','POSTGRES_DB':'postgres','POSTGRES_HOST_AUTH_METHOD':'trust'},
                        'volumes':['postgres:/var/lib/postgresql'],'networks':['database'],
                        'healthcheck':{'test':['CMD','pg_isready','-U','platform_admin','-d','postgres'],'interval':'1s','timeout':'3s','retries':40}},
            'api':{**common,'env_file':[str(root/'api.env')],
                   'volumes':[str(root/'database-target.private.json')+':/run/platform/database-target.private.json:ro','job-health:/run/platform-health/jobs:ro'],
                   'healthcheck':{'test':['CMD','node','-e',"fetch('http://127.0.0.1:8080/internal/ready',{headers:{authorization:'Bearer '+process.env.PLATFORM_PROXY_SECRET}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],
                                  'interval':'1s','timeout':'3s','retries':40}},
            'jobs':{**common,'env_file':[str(root/'jobs.env')],'command':['node','scripts/platform-jobs.mjs'],
                    'environment':{'PLATFORM_JOB_HEALTH_DIR':'/run/platform-health/jobs'},'volumes':['job-health:/run/platform-health/jobs'],'profiles':['writers']},
            'slicer':{**common,'command':['node','-e','setInterval(()=>{},1000)']},
            'tunnel':{**common,'command':['node','-e','setInterval(()=>{},1000)']}},
            'volumes':{'postgres':{},'job-health':{}},'networks':{'database':{'internal':True},'egress':{'internal':True}}}
        for folder in (source,old_source):
            target = folder/'deploy/platform/compose.yml'
            target.parent.mkdir(parents=True)
            target.write_text(json.dumps(config),encoding='utf-8')
        compose = ['docker','compose','--env-file',str(root/'compose.env'),'-f',str(source/'deploy/platform/compose.yml')]
        started, continuity_probe = False, None
        try:
            started = True
            run(compose+['up','-d','--wait','--wait-timeout','75','postgres'],timeout=120)
            pg = run(compose+['ps','-q','postgres'])

            def sql(text, *, db='postgres', user='platform_admin'):
                return run(['docker','exec','-i',pg,'psql','-X','-U',user,'-d',db,'-At','-v','ON_ERROR_STOP=1'],input=text.encode('utf-8'))

            sql("CREATE ROLE platform_owner LOGIN;CREATE ROLE platform_backend NOLOGIN;CREATE ROLE platform_app LOGIN IN ROLE platform_backend PASSWORD '"+secret+"'")
            for db in ('platform',selected):
                sql('CREATE DATABASE '+db+' OWNER platform_owner')
                for migration in sorted((ROOT/'neon/migrations').glob('*.sql')):
                    if int(migration.name[:3]) < 12:
                        sql(migration.read_text(encoding='utf-8'),db=db,user='platform_owner')
            sql("INSERT INTO platform_deployment_state(singleton,generation,database_name,source_dump_sha256) VALUES(true,'"+str(uuid.uuid4())+"','"+selected+"','"+'0'*64+"')",db='platform',user='platform_owner')
            sql("INSERT INTO operators(id,auth_user_id,display_name,role) VALUES('op_synthetic','synthetic','Synthetic owner','owner');INSERT INTO operator_identity_bindings(issuer,subject,operator_id) VALUES('https://github.com/','1234','op_synthetic');INSERT INTO service_requests(id,service,project_title,contact_name,contact_email) VALUES('REQ-synthetic','print','Synthetic preserved intake','Synthetic','nobody@example.invalid')",db=selected,user='platform_owner')
            # Initialize only the fixture's health volume for the image's node UID.
            run(compose+['--profile','writers','run','--rm','--no-deps','--user','0','--cap-add','CHOWN','jobs','node','-e',"require('fs').chownSync('/run/platform-health/jobs',1000,1000)"])
            run(compose+['--profile','writers','up','-d','--wait','--wait-timeout','75','--no-deps','api','jobs','slicer','tunnel'],timeout=120)
            services = {name:run(compose+['ps','-q',name]) for name in ('api','jobs','slicer','tunnel')}
            networks = json.loads(run(['docker','inspect',services['api'],'--format','{{json .NetworkSettings.Networks}}']))
            egress = next(name for name in networks if name.endswith('_egress'))
            probe_code = """import{existsSync}from'node:fs';let checked=0,failed=0;const deadline=Date.now()+180000;
while(!existsSync('/tmp/stop')&&Date.now()<deadline){try{const r=await fetch('http://api:8080/api/partner/v1/status',{signal:AbortSignal.timeout(2000)});
if(!r.ok||(await r.json()).invitationRequired!==true)failed++;}catch{failed++;}checked++;await new Promise(r=>setTimeout(r,100));}
if(!existsSync('/tmp/stop'))failed++;console.log(JSON.stringify({checked,failed}));"""
            continuity_probe = run(['docker','run','-d','--name',project+'-continuity-probe','--network',egress,
                                    '--label','3dprint4me.purpose=partner-rollout-native','--read-only',
                                    '--tmpfs','/tmp:size=1m,mode=1777','--cap-drop=ALL','--security-opt=no-new-privileges:true',
                                    api_image,'node','--input-type=module','-e',probe_code])
            original = sql("SELECT id||':'||project_title FROM service_requests ORDER BY id",db=selected,user='platform_owner')
            checkpoint = {'createdAt':int(time.time()),'roundtripVerified':True,'databases':['platform',selected],
                          'databaseSha256':'0'*64,'objectSha256':'1'*64,'databaseSnapshots':['2'*64,'3'*64],
                          'objectSnapshots':['4'*64,'5'*64],'checkpointReceipts':['6'*64,'7'*64]}
            context = {'root':root,'source':source,'release':release,'selected':selected,'postgres':pg,
                       'images':{'api':api_image,'slicer':api_image},'checkpoint':checkpoint,
                       'previous':{'services':services,'source':str(old_source.resolve()),'selected':selected,
                                   **{name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in ('api.env','jobs.env','compose.env','database-target.private.json')}},
                       'rehearsalProof':{'status':'passed','phase':'rehearse','archiveSha256':'0'*64,'release':release,
                                         'images':{'api':api_image,'slicer':api_image},'checks':{key:True for key in
                                          ['schema','leastPrivilege','disabledProgram','sessionDenials','noMessagesSent','isolatedApiOverlap','scratchCleanup','liveStateUnchanged']}}}
            proof = rollout.deploy_release(context,runner=run)
            assert all(proof.values())
            run(['docker','exec',continuity_probe,'node','-e',"require('fs').writeFileSync('/tmp/stop','')"])
            assert run(['docker','wait',continuity_probe]) == '0'
            continuity = json.loads(run(['docker','logs',continuity_probe]))
            assert continuity['checked'] > 0 and continuity['failed'] == 0
            assert sql("SELECT id||':'||project_title FROM service_requests ORDER BY id",db=selected,user='platform_owner') == original
            assert sql("SELECT to_regclass('public.partner_weekly_statements') IS NOT NULL",db=selected,user='platform_owner') == 't'
            assert sql("SELECT to_regclass('public.partner_weekly_statements') IS NULL",db='platform',user='platform_owner') == 't'
            assert sql('SELECT count(*) FROM partner_invites',db=selected,user='platform_owner') == '0'
            assert sql('SELECT count(*) FROM partner_legal_reviews',db=selected,user='platform_owner') == '0'
            assert (root/'candidate-source').resolve() == source.resolve()
            assert not any(args[:2] == ['docker','stop'] and args[-1] in (services['slicer'],services['tunnel']) for args in commands)
        finally:
            if continuity_probe:
                run(['docker','rm','-f',continuity_probe])
            if started:
                run(compose+['--profile','writers','down','--volumes','--remove-orphans'],timeout=120)
    print(json.dumps({'isolatedNativeRollout':'passed','apiImage':api_image,'continuity':continuity,'existingIntakePreserved':True,'selectedDatabaseOnly':True,
                      'freshStatementWorker':True,'slicerAndTunnelPreserved':True,'productionContacted':False,
                      'realBackupPerformed':False,'disposableResourcesRemoved':True}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image',required=True)
    parser.add_argument('--diagnostics',type=Path)
    args = parser.parse_args()
    main(args.image,args.diagnostics)
