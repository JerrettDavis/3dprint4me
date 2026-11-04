"""Prepare isolated QA services on the pinned native host; JSON stdin, no secrets out.

Run from the exact committed release directory after the normal rehearsal built
its immutable API image. This never restarts the live API/jobs/storefront.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time
from urllib.parse import urlsplit, quote
ROOT=Path('/home/jd/3dprint4me-platform')


def run(args, data=None):
    result=subprocess.run(args,input=data,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=120)
    if result.returncode:raise ValueError('QA host command failed; private state retained for inspection.')
    return result.stdout.strip()


def private_write(path, data):
    if path.exists() or path.is_symlink():raise ValueError('Existing QA configuration requires inspection.')
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w',encoding='utf-8') as f:f.write(data)


def private_replace(path, data):
    if path.exists() and (path.is_symlink() or not path.is_file() or (os.name=='posix' and path.stat().st_mode&0o077)):raise ValueError('Private replacement target is invalid.')
    temporary=path.with_name(path.name+'.next-'+secrets.token_hex(6))
    private_write(temporary,data)
    os.replace(temporary,path)


def configure_qa_release(directory, image):
    if not re.fullmatch('sha256:[a-f0-9]{64}',image):raise ValueError('Immutable QA image required.')
    private_replace(directory/'compose.env','PARTNER_QA_CONFIG_DIR='+str(directory)+'\nPARTNER_QA_API_IMAGE='+image+'\n')


def env(path):
    if path.is_symlink() or path.stat().st_mode&0o077:raise ValueError('Private configuration permissions required.')
    result={}
    for line in path.read_text().splitlines():
        if not line or line.lstrip().startswith('#'):continue
        key,_,value=line.partition('=');result[key]=json.loads(value) if value.startswith('"') else value
    return result


def literal(value):return "'"+value.replace("'","''")+"'"


def prepare(config):
    release=config.get('release');phase=config.get('phase','preflight')
    if not re.fullmatch('[a-f0-9]{40}',release or '') or phase not in ['preflight','apply']:raise ValueError('Exact reviewed release and phase required.')
    source=ROOT/'releases'/release
    if source.resolve().parent!=(ROOT/'releases').resolve() or not (source/'deploy/platform/compose.partner-qa.yml').is_file():raise ValueError('Prepared committed release source required.')
    compose=['docker','compose','--env-file',str(ROOT/'compose.env'),'-f',str(ROOT/'source/deploy/platform/compose.yml')]
    current_env=env(ROOT/'api.env')
    if any(current_env.get(flag)!='0' for flag in ['PARTNER_PROGRAM_ENABLED','PARTNER_CLASSIFICATION_APPROVED','PARTNER_ACCOUNTING_APPROVED']):raise ValueError('Real launch flags must remain disabled.')
    live_id=run(compose+['ps','-q','postgres']);admin=env(ROOT/'postgres.env')['POSTGRES_USER']
    target=json.loads((ROOT/'database-target.private.json').read_text());selected=urlsplit(target['databaseUrl']).path[1:]
    if not re.fullmatch('platform_live_[a-z0-9_]{1,48}',selected):raise ValueError('Selected native store required.')
    def sql(cid,user,db,text):return run(['docker','exec','-i',cid,'psql','-X','-v','ON_ERROR_STOP=1','-U',user,'-d',db,'-Atq'],text)
    live_cluster=sql(live_id,admin,selected,'SELECT system_identifier FROM pg_control_system()')
    counts=sql(live_id,admin,selected,"SELECT json_build_object('programs',(SELECT count(*) FROM partner_programs),'accounts',(SELECT count(*) FROM partner_accounts),'reviews',(SELECT count(*) FROM partner_legal_reviews))")
    image=run(['docker','image','inspect','3dprint4me-platform:'+release[:12],'--format','{{.Id}}'])
    if not re.fullmatch('sha256:[a-f0-9]{64}',image):raise ValueError('Reviewed immutable image required.')
    if phase=='preflight':return {'ok':True,'phase':phase,'selectedDatabase':selected,'liveBusinessCounts':json.loads(counts),'apiImage':image}
    directory=ROOT/'partner-qa';directory.mkdir(mode=0o700,exist_ok=True)
    if directory.is_symlink() or directory.stat().st_mode&0o077:raise ValueError('Private QA directory required.')
    state_path=directory/'state.private.json'
    if not state_path.exists():
        state={'version':1,'qaAdminPassword':secrets.token_urlsafe(48),'qaAppPassword':secrets.token_urlsafe(48),'ownerAuthPassword':secrets.token_urlsafe(48)}
        private_write(state_path,json.dumps(state))
        private_write(directory/'postgres.env','POSTGRES_DB=3dprint4me_partner_qa\nPOSTGRES_USER=qa_admin\nPOSTGRES_PASSWORD='+state['qaAdminPassword']+'\n')
        qa_url='postgresql://platform_app:'+quote(state['qaAppPassword'],safe='')+'@partner-qa-postgres:5432/3dprint4me_partner_qa'
        private_write(directory/'jobs.env','PARTNER_QA_JOBS_ENABLED=1\nPARTNER_QA_DATABASE_URL='+qa_url+'\n')

    state=json.loads(state_path.read_text())
    configure_qa_release(directory,image)
    qa_compose=['docker','compose','--env-file',str(directory/'compose.env'),'-f',str(source/'deploy/platform/compose.partner-qa.yml')]
    run(qa_compose+['config','--quiet']);run(qa_compose+['up','-d','--no-deps','partner-qa-postgres'])
    qa_id=run(qa_compose+['ps','-q','partner-qa-postgres'])
    for attempt in range(60):
        try:qa_cluster=sql(qa_id,'qa_admin','3dprint4me_partner_qa','SELECT system_identifier FROM pg_control_system()');break
        except ValueError:
            if attempt==59:raise
            time.sleep(1)
    if qa_cluster==live_cluster:raise ValueError('QA and live clusters must differ before any schema writes.')
    tables=sql(qa_id,'qa_admin','3dprint4me_partner_qa',"SELECT count(*) FROM pg_tables WHERE schemaname='public'")
    if tables!='0' and sql(qa_id,'qa_admin','3dprint4me_partner_qa',"SELECT realm FROM partner_qa_identity WHERE singleton=true")!='qa':raise ValueError('Unknown QA contents; refusing migrations.')
    # Back up existing synthetic data before an additive upgrade. Never dump live here.
    if tables!='0':
        dump=subprocess.run(['docker','exec',qa_id,'pg_dump','-U','qa_admin','-d','3dprint4me_partner_qa','-Fc'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True,timeout=120).stdout
        stamp=time.strftime('%Y%m%dT%H%M%SZ',time.gmtime());backup=directory/('qa-before-'+stamp+'.dump')
        fd=os.open(backup,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'wb') as f:f.write(dump)
    sql(qa_id,'qa_admin','3dprint4me_partner_qa',"REVOKE CREATE ON SCHEMA public FROM PUBLIC; DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='platform_backend') THEN CREATE ROLE platform_backend NOLOGIN; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='platform_app') THEN CREATE ROLE platform_app LOGIN IN ROLE platform_backend; END IF; END $$; CREATE TABLE IF NOT EXISTS partner_qa_identity(singleton boolean PRIMARY KEY CHECK(singleton),realm text NOT NULL CHECK(realm='qa')); INSERT INTO partner_qa_identity VALUES(true,'qa') ON CONFLICT DO NOTHING;")
    sql(qa_id,'qa_admin','3dprint4me_partner_qa','ALTER TABLE partner_qa_identity ADD COLUMN IF NOT EXISTS cluster_identifier text; UPDATE partner_qa_identity SET cluster_identifier='+literal(qa_cluster)+' WHERE singleton=true; ALTER TABLE partner_qa_identity ALTER COLUMN cluster_identifier SET NOT NULL')
    names=re.findall(r'"([0-9]{3}_[a-z0-9_]+\.sql)"',(source/'scripts/migrate-neon.mjs').read_text())
    if len(names)!=16:raise ValueError('Reviewed migration inventory changed; inspect before applying.')
    for name in names:sql(qa_id,'qa_admin','3dprint4me_partner_qa',(source/'neon/migrations'/name).read_text())
    sql(qa_id,'qa_admin','3dprint4me_partner_qa','REVOKE ALL ON partner_qa_identity FROM PUBLIC,platform_backend; GRANT SELECT ON partner_qa_identity TO platform_backend; ALTER ROLE platform_app PASSWORD '+literal(state['qaAppPassword']))
    sql(qa_id,'qa_admin','3dprint4me_partner_qa',(source/'deploy/platform/partner-qa-identity.sql').read_text(encoding='utf-8-sig'))
    sql(live_id,admin,selected,"DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='partner_qa_auth') THEN CREATE ROLE partner_qa_auth LOGIN NOINHERIT; END IF; END $$; ALTER ROLE partner_qa_auth PASSWORD "+literal(state['ownerAuthPassword']))
    sql(live_id,admin,selected,(source/'deploy/platform/partner-qa-auth.sql').read_text(encoding='utf-8-sig'))
    if sql(live_id,admin,selected,"SELECT json_build_object('programs',(SELECT count(*) FROM partner_programs),'accounts',(SELECT count(*) FROM partner_accounts),'reviews',(SELECT count(*) FROM partner_legal_reviews))")!=counts:raise ValueError('Live business counts changed; stop and inspect.')
    # Save a proposed private API environment; activation uses the guarded release.
    original=(ROOT/'api.env').read_text();changes={'PARTNER_QA_ENABLED':'1','PARTNER_QA_DATABASE_URL':'postgresql://platform_app:'+quote(state['qaAppPassword'],safe='')+'@partner-qa-postgres:5432/3dprint4me_partner_qa','PARTNER_QA_OWNER_AUTH_URL':'postgresql://partner_qa_auth:'+quote(state['ownerAuthPassword'],safe='')+'@postgres:5432/'+selected}
    key=run(['docker','run','--rm','--network','none','--entrypoint','node',image,'-e',"process.stdout.write(require('node:crypto').generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'}))"])
    changes['PARTNER_QA_REVIEW_SIGNING_PRIVATE_KEY']=json.dumps(key+'\n')
    retained=[line for line in original.splitlines() if line.split('=',1)[0] not in changes]
    proposal='\n'.join(retained)+'\n'+''.join(k+'='+v+'\n' for k,v in changes.items())
    candidate=directory/'api.env.proposed'
    private_replace(candidate,proposal)
    private_replace(directory/('prepared-'+release+'.json'),json.dumps({'release':release,'image':image,'liveBusinessCounts':json.loads(counts),'qaClusterSha256':hashlib.sha256(qa_cluster.encode()).hexdigest()}))
    return {'ok':True,'phase':'prepared','selectedDatabase':selected,'liveBusinessCounts':json.loads(counts),'apiImage':image,'next':'Review private proposed env, activate it, rerun guarded rehearsal and deploy; start QA-only jobs after API verification.'}


if __name__=='__main__':
    try:print(json.dumps(prepare(json.load(sys.stdin))))
    except Exception:raise SystemExit('QA host preparation failed; existing private state retained. No secrets printed.')
