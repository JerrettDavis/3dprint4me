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
   assert (member.isfile() or member.isdir()) and not member.name.startswith('/') and '..' not in pathlib.PurePosixPath(member.name).parts
  # Host Python3.9 lacks tarfile's data filter. Only validated regular files and
  # directories enter this newly created, owner-private destination.
  tar.extractall(source)
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
 # Rehearse healthy-origin overlap/drain on an isolated DNS network. Both API
 # servers use the actual platform HTTP boundary and the disposable database.
 rehearsal_network='3dprint4me-inquiry-'+uuid.uuid4().hex[:12]
 rehearsal_env=root/(rehearsal_network+'.private.env');containers=[]
 fd=os.open(rehearsal_env,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as f:f.write('DATABASE_URL='+scratch_url+'\n')
 network_created=False;cleanup_errors=[]
 try:
  run(['docker','network','create','--internal',rehearsal_network]);network_created=True
  server_code="import pg from 'pg';import {createPlatformServer} from './lib/platform/api-server.js';const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});const server=createPlatformServer({env:{PLATFORM_PROXY_SECRET:'synthetic-rehearsal'},routes:{},ready:()=>pool.query('SELECT 1')});server.listen(8080,'0.0.0.0');process.on('SIGTERM',()=>server.close(async()=>{await pool.end();process.exit(0)}));"
  check_code="fetch('http://127.0.0.1:8080/internal/ready',{headers:{authorization:'Bearer synthetic-rehearsal'}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
  def start_origin():
   container=run(['docker','run','-d','--network',database_network,'--env-file',str(rehearsal_env),'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges:true','--memory=128m','--pids-limit=64',image,'node','--input-type=module','-e',server_code]);containers.append(container)
   for attempt in range(30):
    try:run(['docker','exec',container,'node','-e',check_code]);break
    except subprocess.CalledProcessError:time.sleep(.2)
   else:raise RuntimeError('Rehearsal origin not ready')
   run(['docker','network','connect','--alias','api',rehearsal_network,container]);return container
  old=start_origin()
  probe_code="let checked=0,failed=0;for(let i=0;i<48;i++){try{const r=await fetch('http://api:8080/internal/ready',{headers:{authorization:'Bearer synthetic-rehearsal'},signal:AbortSignal.timeout(2000)});if(!r.ok)failed++;}catch{failed++;}checked++;await new Promise(r=>setTimeout(r,250));}console.log(JSON.stringify({checked,failed}));"
  probe=run(['docker','run','-d','--network',rehearsal_network,'--read-only','--cap-drop=ALL','--memory=128m','--pids-limit=64',image,'node','--input-type=module','-e',probe_code]);containers.append(probe)
  time.sleep(1);start_origin();time.sleep(1);run(['docker','stop','-t','45',old])
  run(['docker','wait',probe]);metrics=json.loads(run(['docker','logs',probe]))
  assert metrics['checked']==48 and metrics['failed']==0
  print(json.dumps({'isolatedApiOverlap':'passed','requests':metrics['checked'],'failures':metrics['failed'],'database':'disposable-native'}),flush=True)
 finally:
  try:
   for container in containers:
    try:run(['docker','rm','-f',container])
    except Exception:cleanup_errors.append('container')
   if network_created:
    try:run(['docker','network','rm',rehearsal_network])
    except Exception:cleanup_errors.append('network')
  finally:rehearsal_env.unlink()
 if cleanup_errors:raise RuntimeError('Disposable rehearsal cleanup needs attention')
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
old_api=run(compose+['ps','-q','api'])
egress_network=next(n for n in run(['docker','inspect',old_api,'--format','{{range $name, $value := .NetworkSettings.Networks}}{{$name}} {{end}}']).split() if n.endswith('_egress'))
override=root/'inquiry-rollout.private.yml'
assert not override.exists()
fd=os.open(override,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:f.write('services:\n  api:\n    networks: !override [database]\n  api_guard:\n    extends: {file: '+json.dumps(str(pointer/'deploy/platform/compose.yml'))+', service: api}\n    environment: {INQUIRY_WORKFLOW_ENABLED: "0"}\n    networks: !override [database]\n')
def healthy(name):
 deadline=time.monotonic()+75
 while time.monotonic()<deadline:
  container=run(full+['ps','-q',name])
  if container and run(['docker','inspect',container,'--format','{{.State.Health.Status}}'])=='healthy':return
  time.sleep(1)
 raise RuntimeError('API readiness deadline exceeded')
full=compose+['-f',str(override)]
run(full+['config','--quiet'])
def publish(name):
 container=run(full+['ps','-q',name]);assert re.fullmatch('[a-f0-9]{64}',container)
 run(['docker','network','connect','--alias','api',egress_network,container])
run(full+['up','-d','--no-deps','api_guard']);healthy('api_guard')
publish('api_guard')
print(json.dumps({'stage':'guarded-api-ready'}),flush=True)
# Existing requests drain on SIGTERM while the healthy guarded API shares api DNS.
run(compose+['stop','-t','45','api']);run(compose+['rm','-f','api'])
write_env('api.env',{'INQUIRY_WORKFLOW_ENABLED':'1'})
run(full+['up','-d','--no-deps','api']);healthy('api');publish('api')
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
