"""Initialize a new empty installation from private configuration and tracked source.

Run on Linux as the Docker owner. No customer recovery data is created by setup;
use rebuild-host.py after a loss. Preview is default; traffic stays disconnected.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import uuid

spec=importlib.util.spec_from_file_location('rebuild',Path(__file__).with_name('rebuild-host.py'))
rebuild=importlib.util.module_from_spec(spec)
spec.loader.exec_module(rebuild)


def bootstrap(root, release, owner_subject, apply=False):
    if not re.fullmatch('[a-f0-9]{40}',release) or not re.fullmatch('[1-9][0-9]{0,19}',owner_subject):
        raise ValueError('Exact source and confirmed numeric owner required')
    if not root.is_absolute() or root.resolve()!=root or root.is_symlink() or root.stat().st_uid!=os.getuid() or root.stat().st_mode&0o077:
        raise ValueError('Owner-private root required')
    source=root/'candidate-source'
    if rebuild.run(['git','-C',str(source),'rev-parse','HEAD']).decode().strip()!=release or rebuild.run(['git','-C',str(source),'status','--porcelain']).strip():
        raise ValueError('Clean exact source required')
    required=set(rebuild.PRIVATE_NAMES)-{'database-target.private.json','compose.env'}
    for name in required:
        path=root/name
        if not path.is_file() or path.is_symlink() or path.stat().st_uid!=os.getuid() or path.stat().st_mode&0o077:
            raise ValueError('Private configuration required')
    if (root/'database-target.private.json').exists() or (root/'compose.env').exists():
        raise ValueError('Existing installation refused')
    credentials=json.loads((root/'database.private.json').read_text())
    if not all(re.fullmatch('[A-Za-z0-9_-]{32,128}',credentials[k]) for k in ['admin','owner','runtime']):
        raise ValueError('Invalid database credentials')
    rebuild.empty_docker()
    plan={'apply':apply,'release':release,'owner_identity':'explicit-numeric-github-binding',
          'api_started':False,'writers_started':False,'tunnel_started':False}
    if not apply:return plan
    if sys.platform!='linux':raise ValueError('Linux Docker host required')
    os.umask(0o077)
    rebuild.write_private(root/'compose.env',('PLATFORM_CONFIG_DIR='+json.dumps(str(root))+'\nPLATFORM_RELEASE='+release[:12]+'\n').encode())
    compose=['docker','compose','--env-file',str(root/'compose.env'),'-f',str(source/'deploy/platform/compose.yml')]
    rebuild.run(compose+['up','-d','--wait','postgres'])
    pg=rebuild.run(compose+['ps','-q','postgres']).decode().strip()
    if not re.fullmatch('[a-f0-9]{64}',pg):raise ValueError('Database identity mismatch')
    def sql(text,db='postgres',user='platform_admin'):
        return rebuild.run(['docker','exec','-i',pg,'psql','-X','-U',user,'-d',db,'-At','-v','ON_ERROR_STOP=1'],text.encode())
    sql("CREATE ROLE platform_backend NOLOGIN NOSUPERUSER NOBYPASSRLS; CREATE ROLE platform_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '"+credentials['owner']+"'; CREATE ROLE platform_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+credentials['runtime']+"'; GRANT platform_backend TO platform_app;")
    database='platform_live_'+uuid.uuid4().hex[:16]
    for db in ['platform',database]:
        if sql("SELECT 1 FROM pg_database WHERE datname='"+db+"'").strip():
            if sql("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'",db).strip()!=b'0':raise ValueError('Non-empty database refused')
            sql('ALTER DATABASE '+db+' OWNER TO platform_owner')
        else:sql('CREATE DATABASE '+db+' OWNER platform_owner')
        for migration in sorted((source/'neon/migrations').glob('*.sql')):sql(migration.read_text(),db,'platform_owner')
        sql("INSERT INTO operators(id,auth_user_id,display_name,role) VALUES('op_bootstrap_owner','github:"+owner_subject+"','Owner','owner'); INSERT INTO operator_identity_bindings(issuer,subject,operator_id) VALUES('https://github.com/','"+owner_subject+"','op_bootstrap_owner');",db,'platform_owner')
    # Bootstrapping already uses native storage. The append-once control selection
    # survives restarts, exactly as a restored installation does.
    generation=str(uuid.uuid4());seed_sha=__import__('hashlib').sha256(('fresh-install:'+release).encode()).hexdigest()
    sql("INSERT INTO platform_deployment_state(singleton,generation,database_name,source_dump_sha256) VALUES(true,'"+generation+"','"+database+"','"+seed_sha+"');",'platform','platform_owner')
    url='postgresql://platform_app:'+credentials['runtime']+'@postgres:5432/'+database
    for name in ['api.env','activation.env','jobs.env','slicer.env']:
        path=root/name;values={}
        for line in path.read_text().splitlines():
            if line and not line.startswith('#'):
                k,v=line.split('=',1);values[k]=json.loads(v) if v.startswith('"') else v
        values.update(DATABASE_URL=url,DATABASE_DRIVER='postgres')
        if name in ['api.env','activation.env']:
            values.update(PLATFORM_CONTROL_DATABASE_URL=url.rsplit('/',1)[0]+'/platform',OPERATOR_AUTH_PROVIDER='github',PLATFORM_TARGET_AUTH_PROVIDER='github',OPERATOR_OWNER_SUBJECT=owner_subject)
        if name=='jobs.env':values['PLATFORM_JOBS_ENABLED']='1'
        temporary=root/(name+'.bootstrap')
        rebuild.write_private(temporary,''.join(k+'='+json.dumps(v)+'\n' for k,v in values.items()).encode());os.replace(temporary,path)
    rebuild.write_private(root/'database-target.private.json',json.dumps({'version':1,'phase':'fenced-and-restored','generation':generation,'databaseUrl':url,'sourceDumpSha256':seed_sha}).encode())
    rebuild.run(compose+['--profile','writers','build','api','slicer'],timeout=1800)
    rebuild.run([sys.executable,str(source/'deploy/platform/prepare-host.py'),'--root',str(root),'--owner-uid',str(os.getuid()),'--apply'])
    return {**plan,'setup':'passed','routing':'manual-review-required'}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,required=True)
    parser.add_argument('--release',required=True)
    parser.add_argument('--owner-subject',required=True)
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    try:print(json.dumps(bootstrap(args.root,args.release,args.owner_subject,args.apply)))
    except Exception:raise SystemExit('Fresh setup failed; private diagnostics suppressed. Partial setup retained; no traffic activated.')
