"""Rehearse or roll out a committed inquiry release without exposing private config.

Uses the existing SSH host, native database, private env files and Docker networks.
No Neon connection is made. --phase deploy is an explicitly mutating operation.
"""
import argparse
import base64
import json
from pathlib import Path
import re
import subprocess

REMOTE = r'''
import base64,io,json,os,pathlib,re,subprocess,sys,tarfile,time,uuid
config=json.loads(sys.stdin.read());root=pathlib.Path('/home/jd/3dprint4me-platform')
assert root.resolve()==root and root.stat().st_uid==os.getuid() and not root.stat().st_mode&0o077
sha=config['release'];assert re.fullmatch('[a-f0-9]{40}',sha)
def run(args,**kw):
 return subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True,timeout=kw.pop('timeout',180),**kw).stdout.decode().strip()
def private(name):
 p=root/name;assert p.is_file() and not p.is_symlink() and not p.stat().st_mode&0o077;return p
def env(name):
 values={}
 for line in private(name).read_text().splitlines():
  if '=' in line and not line.startswith('#'):
   k,v=line.split('=',1);values[k]=json.loads(v) if v.startswith('"') else v
 return values
def write_env(name,changes):
 values=env(name);values.update(changes);p=private(name);temp=p.with_suffix('.next')
 fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as f:f.write(''.join(k+'='+json.dumps(v)+'\n' for k,v in values.items()));f.flush();os.fsync(f.fileno())
 os.replace(temp,p)
source=root/'releases'/sha;source.parent.mkdir(mode=0o700,exist_ok=True)
if not source.exists():
 source.mkdir(mode=0o700)
 archive=base64.b64decode(config['archive']);assert len(archive)<32*1024*1024
 with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
  for member in tar.getmembers():
   assert not member.issym() and not member.islnk() and not member.name.startswith('/') and '..' not in pathlib.PurePosixPath(member.name).parts
  tar.extractall(source,filter='data')
image='3dprint4me-platform:'+sha[:12]
run(['docker','build','-t',image,'-f',str(source/'deploy/platform/Dockerfile'),str(source)],timeout=600)
compose=['docker','compose','--env-file',str(root/'compose.env'),'-f',str(root/'candidate-source/deploy/platform/compose.yml')]
pg=run(compose+['ps','-q','postgres']);assert re.fullmatch('[a-f0-9]{64}',pg)
def sql(text,db='platform',user='platform_owner'):
 return run(['docker','exec','-i',pg,'psql','-X','-U',user,'-d',db,'-At','-v','ON_ERROR_STOP=1'],input=text.encode())
selected=sql('SELECT database_name FROM platform_deployment_state WHERE singleton=true')
assert re.fullmatch('platform_live_[a-z0-9_]{1,48}',selected)
scratch='platform_inquiry_rehearsal_'+uuid.uuid4().hex[:12]
sql('CREATE DATABASE '+scratch+' OWNER platform_owner',db='postgres',user='platform_admin')
try:
 for migration in sorted((source/'neon/migrations').glob('*.sql')):sql(migration.read_text(),db=scratch)
 sql("INSERT INTO operators(id,auth_user_id,display_name,role) VALUES('op_rehearsal123','rehearsal','Rehearsal','owner')",db=scratch)
 from urllib.parse import urlsplit,urlunsplit
 original=urlsplit(env('api.env')['DATABASE_URL']);assert original.hostname=='postgres' and original.username=='platform_app'
 scratch_url=urlunsplit((original.scheme,original.netloc,'/'+scratch,'',''))
 network=run(['docker','inspect',pg,'--format','{{range $name, $value := .NetworkSettings.Networks}}{{$name}} {{end}}']).split()
 database_network=next(n for n in network if n.endswith('_database'))
 # URL travels in stdin, never the command line or printed output.
 code="import { readFileSync } from 'node:fs';process.env.DATABASE_URL=JSON.parse(readFileSync(0,'utf8')).url;await import('./scripts/rehearse-inquiry.mjs');"
 result=run(['docker','run','--rm','-i','--network',database_network,'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges:true','--memory=256m','--pids-limit=64',image,'node','--input-type=module','-e',code],input=json.dumps({'url':scratch_url}).encode())
 assert json.loads(result)['nativePostgresRehearsal']=='passed'
 print(result,flush=True)
finally:
 sql('DROP DATABASE '+scratch+' WITH (FORCE)',db='postgres',user='platform_admin')
if config['phase']=='rehearse':sys.exit(0)
assert config['phase']=='deploy'
# Apply only the selected database. Atomic additive migration, including bounded repair.
migration=(source/'neon/migrations/009_inquiry_workflow.sql').read_text()
sql('BEGIN;SET LOCAL lock_timeout=\'5s\';'+migration+'COMMIT;',db=selected)
print(json.dumps({'stage':'selected-native-schema-ready'}),flush=True)
# Switch the durable source pointer; preserve the prior source for diagnosis.
pointer=root/'candidate-source'
if not pointer.is_symlink():pointer.rename(root/'releases'/('source-before-inquiry-'+uuid.uuid4().hex[:8]))
next_pointer=root/'candidate-source.next';next_pointer.symlink_to(source,target_is_directory=True);os.replace(next_pointer,pointer)
write_env('compose.env',{'PLATFORM_RELEASE':sha[:12]})
override=root/'inquiry-rollout.private.json'
assert not override.exists()
fd=os.open(override,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:json.dump({'services':{'api_guard':{'extends':{'service':'api'},'environment':{'INQUIRY_WORKFLOW_ENABLED':'0'},'networks':{'database':{},'egress':{'aliases':['api']}}}}},f)
def healthy(name):
 deadline=time.monotonic()+75
 while time.monotonic()<deadline:
  container=run(full+['ps','-q',name])
  if container and run(['docker','inspect',container,'--format','{{.State.Health.Status}}'])=='healthy':return
  time.sleep(1)
 raise RuntimeError('API readiness deadline exceeded')
full=compose+['-f',str(override)]
run(full+['up','-d','--no-deps','api_guard']);healthy('api_guard')
print(json.dumps({'stage':'guarded-api-ready'}),flush=True)
# Existing requests drain on SIGTERM while the healthy guarded API shares api DNS.
run(compose+['stop','-t','45','api']);run(compose+['rm','-f','api'])
write_env('api.env',{'INQUIRY_WORKFLOW_ENABLED':'1'})
run(compose+['up','-d','--no-deps','api']);healthy('api')
print(json.dumps({'stage':'enabled-api-ready'}),flush=True)
run(full+['stop','-t','45','api_guard']);run(full+['rm','-f','api_guard']);override.unlink()
sql('BEGIN;'+migration+'COMMIT;',db=selected)
assert sql("SELECT count(*) FROM quick_inquiries q WHERE status='submitted' AND NOT EXISTS(SELECT 1 FROM work_items w WHERE w.inquiry_id=q.id)",db=selected)=='0'
print(json.dumps({'release':sha,'api':'healthy','inquiriesBackfilled':True,'neonContacted':False,'customerMessagesSent':False,'rollback':'inquiry-aware-api-only'}),flush=True)
'''


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release',required=True)
    parser.add_argument('--phase',choices=['rehearse','deploy'],default='rehearse')
    parser.add_argument('--host',default='jd@jdh-docker-00')
    args=parser.parse_args()
    if not re.fullmatch('[a-f0-9]{40}',args.release):parser.error('A complete reviewed commit SHA is required.')
    root=Path(__file__).resolve().parents[2]
    archive=subprocess.run(['git','archive',args.release,'api','lib','neon','scripts','deploy','public/assets/js','package.json','package-lock.json'],cwd=root,check=True,stdout=subprocess.PIPE).stdout
    payload=json.dumps({'release':args.release,'phase':args.phase,'archive':base64.b64encode(archive).decode()})
    # Exceptions/child stderr may contain private provider detail: report a stage failure only.
    remote='exec('+repr(REMOTE)+')'
    command=['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',args.host,'python3 -c '+"'"+remote.replace("'","'\"'\"'")+"'"]
    result=subprocess.run(command,input=payload.encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    print(result.stdout.decode(),end='')
    if result.returncode:raise SystemExit('Release stopped safely; inspect private host logs/state before retrying. No automatic pre-inquiry rollback is permitted.')


if __name__=='__main__':main()
