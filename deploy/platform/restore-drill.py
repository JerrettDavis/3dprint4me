"""Restore a specific encrypted snapshot into a disposable isolated PG18 container.

Never writes to a production database, publishes a port, or extracts private files
to disk. A drill proves database recovery and configuration hashes, not complete
provider/account recovery or offsite availability.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shlex
import sys

spec=importlib.util.spec_from_file_location('backup_controller',Path(__file__).with_name('backup-controller.py'))
controller=importlib.util.module_from_spec(spec)
spec.loader.exec_module(controller)

REMOTE = r'''import sys,io,tarfile,json,hashlib,secrets,subprocess,os,time,re
payload=sys.stdin.buffer.read(128*1024*1024+1)
assert len(payload)<=128*1024*1024
with tarfile.open(fileobj=io.BytesIO(payload)) as tar:
 files={}
 for m in tar.getmembers():
  assert m.isfile() and not m.name.startswith('/') and '..' not in m.name and m.name not in files and m.size<=128*1024*1024
  files[m.name]=tar.extractfile(m).read()
manifest=json.loads(files.pop('manifest.json'))
assert set(files)==set(manifest['sha256'])
assert all(hashlib.sha256(data).hexdigest()==manifest['sha256'][name] for name,data in files.items())
credentials=json.loads(files['private/database.private.json'])
assert all(re.fullmatch('[A-Za-z0-9_-]{32,128}',credentials[key]) for key in ['admin','owner','runtime'])
databases=manifest['databases']
assert databases and len(databases)<=2 and len(set(databases))==len(databases)
assert all(name=='platform' or re.fullmatch('platform_live_[a-z0-9_]{1,48}',name) for name in databases)
name='3dprint4me-restore-drill-'+secrets.token_hex(8)
env=os.environ.copy();env.update(POSTGRES_PASSWORD=credentials['admin'],POSTGRES_USER='platform_admin')
def run(args,**kw):
 return subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,check=True,timeout=120,**kw)
def sql(text,database='platform_admin',user='platform_admin'):
 return run(['docker','exec','-i',name,'psql','-U',user,'-d',database,'-At','-v','ON_ERROR_STOP=1'],input=text.encode()).stdout.decode().strip()
created=False
try:
 run(['docker','run','--detach','--name',name,'--label','app=3dprint4me-restore-drill','--network','none','--memory','512m','--cpus','1','--tmpfs','/var/lib/postgresql:rw,nosuid,size=384m','--env','POSTGRES_USER','--env','POSTGRES_PASSWORD','postgres:18-bookworm@sha256:afc7e2d441324c0388fa80c3d24f733b4194a4eb7f47dd8ee2b08eb1a24a647c'],env=env);created=True
 for attempt in range(60):
  if subprocess.run(['docker','exec',name,'pg_isready','-U','platform_admin'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=5).returncode==0:break
  time.sleep(1)
 else:raise ValueError('Readiness failed')
 sql("CREATE ROLE platform_backend NOLOGIN NOSUPERUSER NOBYPASSRLS; CREATE ROLE platform_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '"+credentials['owner']+"'; CREATE ROLE platform_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+credentials['runtime']+"'; GRANT platform_backend TO platform_app;")
 results=[]
 for database in databases:
  sql('CREATE DATABASE '+database+' OWNER platform_owner')
  sql('DROP SCHEMA public',database,user='platform_owner')
  run(['docker','exec','-i',name,'pg_restore','-U','platform_owner','--dbname='+database,'--no-owner','--exit-on-error'],input=files['databases/'+database+'.dump'])
  result=json.loads(sql("SELECT json_build_object('tables',(SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'),'operators',(SELECT count(*) FROM operators),'requests',(SELECT count(*) FROM service_requests),'work',(SELECT count(*) FROM work_items),'bindings',(SELECT count(*) FROM operator_identity_bindings))",database,user='platform_app'))
  assert result['tables']>=25 and result['operators']>=1
  for statement in ['CREATE TABLE forbidden(id text)',"UPDATE operators SET role='operator'",'DELETE FROM operator_identity_bindings']:
   p=subprocess.run(['docker','exec','-i',name,'psql','-U','platform_app','-d',database,'-v','ON_ERROR_STOP=1'],input=statement.encode(),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15)
   assert p.returncode!=0
  results.append(result)
 print(json.dumps({'isolated_database_restore':'passed','configuration_hashes_verified':len(manifest['sha256']),'databases':results,'runtime_privilege_denials':'passed','network':'none','persistent_restore_volume':False}))
finally:
 if created:subprocess.run(['docker','rm','--force',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=30)
'''


def drill(config_path,snapshot,filename,expected_sha):
    if not re.fullmatch('[a-f0-9]{64}',snapshot) or not re.fullmatch('[a-f0-9]{64}',expected_sha) or not re.fullmatch('3dprint4me/platform-[0-9TZ]+.tar',filename):
        raise ValueError('Exact backup identity required')
    controller.private(config_path)
    config=json.loads(config_path.read_text())
    exe,password=Path(config['restic']),Path(config['password_file'])
    for path in [exe,password,Path(config['stores'][0]['repository']),Path(config['stores'][0]['cache'])]:controller.private(path)
    if hashlib.sha256(exe.read_bytes()).hexdigest()!=controller.RESTIC_SHA256.get(sys.platform):raise ValueError('Unverified Restic')
    import os
    env={k:v for k,v in os.environ.items() if not k.upper().startswith('RESTIC_')}
    cache=config['stores'][0]['cache'];env.update(TEMP=cache,TMP=cache,TMPDIR=cache)
    data=controller.command([str(exe),'--repo',config['stores'][0]['repository'],'--password-file',str(password),'--cache-dir',cache,'dump',snapshot,'/'+filename],env=env)
    if hashlib.sha256(data).hexdigest()!=expected_sha:raise ValueError('Backup content mismatch')
    controller.verify_archive(data)
    if not re.fullmatch('[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.-]+',config['ssh_host']):raise ValueError('Explicit SSH target required')
    output=controller.command(['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',config['ssh_host'],'python3 -c '+shlex.quote(REMOTE)],data=data,timeout=300,limit=16384)
    return json.loads(output)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    for key in ['config','snapshot','filename','sha256']:parser.add_argument('--'+key,required=True,type=Path if key=='config' else str)
    args=parser.parse_args()
    try:print(json.dumps(drill(args.config,args.snapshot,args.filename,args.sha256)))
    except Exception:raise SystemExit('Isolated restore drill failed; private diagnostics suppressed.')
