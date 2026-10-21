"""Controlled production handover. Source fence is rolled back only before selection.
Review this concrete script before execution. Private values travel in SSH stdin.
"""
import argparse
import subprocess
remote=r'''import pathlib,json,os,subprocess,uuid,hashlib,sys,time,re
from urllib.parse import urlsplit,unquote,urlencode,urlunsplit,parse_qsl
root=pathlib.Path('/home/jd/3dprint4me-platform')
assert root.resolve()==root and root.stat().st_uid==os.getuid() and not root.stat().st_mode&0o077
def private(name):
 p=root/name;assert p.is_file() and not p.is_symlink() and p.stat().st_uid==os.getuid() and not p.stat().st_mode&0o077
 return p
source=json.loads(private('source.private.json').read_text());credentials=json.loads(private('database.private.json').read_text())
assert all(re.fullmatch('[A-Za-z0-9_-]{32,128}',credentials[key]) for key in ['admin','owner','runtime'])
u=urlsplit(source.get('DATABASE_URL_UNPOOLED') or source['DATABASE_URL'])
assert u.scheme in ['postgresql','postgres'] and u.hostname.endswith('.neon.tech')
hostname=u.hostname.replace('-pooler.','.')
source_url=urlunsplit((u.scheme,u.netloc.replace(u.hostname,hostname),u.path,urlencode({**dict(parse_qsl(u.query)),'sslmode':'verify-full'}),''))
compose=['docker','compose','--env-file',str(root/'compose.env'),'-f',str(root/'candidate-source/deploy/platform/compose.yml')]
pg=subprocess.check_output(compose+['ps','-q','postgres']).decode().strip();api=subprocess.check_output(compose+['ps','-q','api']).decode().strip()
assert re.fullmatch('[a-f0-9]{64}',pg) and re.fullmatch('[a-f0-9]{64}',api)
def run(args,**kwargs):return subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,check=True,timeout=90,**kwargs)
def sql(text,database='platform',user='platform_owner'):
 return run(['docker','exec','-i',pg,'psql','-U',user,'-d',database,'-At','-v','ON_ERROR_STOP=1'],input=text.encode()).stdout.decode().strip()
def node(code,config={}):
 value=run(['docker','exec','-i',api,'node','--input-type=module'],input=('const config='+json.dumps(config)+';\n'+code).encode()).stdout
 return json.loads(value)
def selection():return sql('SELECT count(*) FROM platform_deployment_state WHERE singleton=true')!='0'
def control(action):
 return node("""const r=await fetch('http://127.0.0.1:8080/internal/handover/'+config.action,{method:'POST',headers:{authorization:'Bearer '+process.env.PLATFORM_PROXY_SECRET},signal:AbortSignal.timeout(40000)});if(!r.ok)throw Error('Control operation failed');console.log(JSON.stringify(await r.json()));""",{'action':action})
def write_env(name,changes):
 p=private(name);values={}
 for line in p.read_text().splitlines():
  if '=' in line:
   key,value=line.split('=',1);values[key]=json.loads(value) if value.startswith('"') else value
 values.update(changes)
 temp=root/(name+'.next');fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as f:f.write(''.join(k+'='+json.dumps(v)+'\n' for k,v in values.items()));f.flush();os.fsync(f.fileno())
 os.replace(temp,p)
def write_manifest(value):
 p=private('database-target.private.json')
 with p.open('r+b') as f:f.seek(0);f.write(json.dumps(value).encode());f.truncate();f.flush();os.fsync(f.fileno())
assert not selection(),'Target selection already exists; never refence or return to source'
assert json.loads(private('database-target.private.json').read_text())['phase']=='prepared'
# Schema/roles and worker image must already be available. This script does not
# stop old writers or change Vercel routes: those are explicit preflight gates.
assert run(['docker','image','inspect','3dprint4me-slicer:6a24f9b']).returncode==0
proof=None;paused=False;stage='pause';started=time.monotonic();target='platform_live_'+uuid.uuid4().hex[:16]
try:
 control('pause');paused=True;stage='source-fence'
 write_manifest({'version':1,'phase':'fencing'})
 proof=node("""import pg from 'pg';import {fenceSource} from './lib/platform/source-fence.js';const client=new pg.Client({connectionString:config.source,connectionTimeoutMillis:10000,query_timeout:10000});await client.connect();try{console.log(JSON.stringify(await fenceSource(client)));}finally{await client.end();}""",{'source':source_url})
 fd=os.open(root/'source-fence.private.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as f:json.dump(proof,f)
 stage='fenced-source-export'
 env=os.environ.copy();env.update(PGHOST=hostname,PGPORT=str(u.port or 5432),PGUSER=unquote(u.username),PGPASSWORD=unquote(u.password),PGDATABASE=unquote(u.path[1:]),PGSSLMODE='verify-full',PGSSLROOTCERT='/etc/ssl/certs/ca-certificates.crt',PGCONNECT_TIMEOUT='10')
 args=['docker','run','--rm','--mount','type=bind,src=/etc/ssl/certs/ca-certificates.crt,dst=/etc/ssl/certs/ca-certificates.crt,readonly']
 for key in ['PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSSLMODE','PGSSLROOTCERT','PGCONNECT_TIMEOUT']:args+=['--env',key]
 args+=['postgres:18-bookworm@sha256:afc7e2d441324c0388fa80c3d24f733b4194a4eb7f47dd8ee2b08eb1a24a647c','pg_dump','--format=custom','--no-owner','--no-acl','--schema=public']
 dump=run(args,env=env).stdout;assert dump.startswith(b'PGDMP') and len(dump)<=128*1024*1024
 stage='target-restore'
 sql('CREATE DATABASE '+target+' OWNER platform_owner',database='postgres',user='platform_admin');sql('DROP SCHEMA public',database=target)
 run(['docker','exec','-i',pg,'pg_restore','-U','platform_owner','--dbname='+target,'--no-owner','--no-acl','--exit-on-error'],input=dump)
 target_owner='postgresql://platform_owner:'+credentials['owner']+'@postgres:5432/'+target
 node("""import pg from 'pg';import {releaseRestoredSourceFence} from './lib/platform/source-fence.js';const client=new pg.Client({connectionString:config.target});await client.connect();try{await releaseRestoredSourceFence(client,{proof:config.proof});console.log(JSON.stringify({released:true}));}finally{await client.end();}""",{'target':target_owner,'proof':proof['proof']})
 for name in ['007_invoicing.sql','008_platform.sql']:sql((root/'candidate-source/neon/migrations'/name).read_text(),database=target)
 sql("DO $$ BEGIN IF (SELECT count(*) FROM operators WHERE enabled AND role='owner')<>1 THEN RAISE EXCEPTION 'Exact existing owner required'; END IF; END $$; INSERT INTO operator_identity_bindings(issuer,subject,operator_id) SELECT 'https://github.com/','2610199',id FROM operators WHERE enabled AND role='owner';",database=target)
 target_url='postgresql://platform_app:'+credentials['runtime']+'@postgres:5432/'+target
 manifest={'version':1,'phase':'fenced-and-restored','generation':str(uuid.uuid4()),'databaseUrl':target_url,'sourceDumpSha256':hashlib.sha256(dump).hexdigest(),'expectedCounts':proof['counts']}
 # A bind mount of a single file holds its inode. Preserve that inode; the gate
 # stays paused and activation only reads after the complete fsync below.
 write_manifest(manifest)
 stage='durable-activation';control('activate');assert selection()
 stage='resume';control('resume');paused=False
 common={'DATABASE_URL':target_url,'DATABASE_DRIVER':'postgres'}
 write_env('api.env',{**common,'OPERATOR_AUTH_PROVIDER':'github'})
 write_env('activation.env',{**common,'OPERATOR_AUTH_PROVIDER':'github'})
 write_env('jobs.env',{**common,'PLATFORM_JOBS_ENABLED':'1'})
 write_env('slicer.env',common)
 print(json.dumps({'cutover':'selected-and-resumed','source_fenced':True,'target':target,'source_counts':proof['counts'],'source_dump_sha256':manifest['sourceDumpSha256'],'source_dump_bytes':len(dump),'elapsed_seconds':round(time.monotonic()-started,2),'background_writers_started':False}))
except Exception:
 rollback=False
 try:selected=selection()
 except Exception:
  print(json.dumps({'cutover':'failed','stage':stage,'target_selection_unknown':True,'source_rollback_verified':False}));sys.exit(2)
 if not selected:
  stage='guarded-source-rollback'
  try:
   # A committed fence can outlive a lost command response. Reconstruct only
   # non-secret identity evidence; restoreSourceWrites independently verifies
   # all source ownership, exact function body, ALWAYS triggers and selection.
   node("""import pg from 'pg';import {restoreSourceWrites} from './lib/platform/source-fence.js';import {BUSINESS_TABLES} from './lib/platform/activation.js';import {createControlStore} from './lib/platform/control-store.js';const control=createControlStore(),client=new pg.Client({connectionString:config.source,connectionTimeoutMillis:10000,query_timeout:10000});await client.connect();try{const {rows:[state]}=await client.query("SELECT count(*)::int AS count FROM pg_trigger WHERE tgname='platform_migration_readonly'");if(state.count){const {rows:[identity]}=await client.query('SELECT current_database() AS database,current_user AS role');const proof=config.proof??{method:'always-statement-triggers-v1',...identity,tables:[...BUSINESS_TABLES].sort()};await restoreSourceWrites(client,{targetAcceptedWrites:false,proof,getTargetSelection:control.getSelection});}console.log(JSON.stringify({rolledBack:true}));}finally{await client.end();await control.close();}""",{'source':source_url,'proof':proof['proof'] if proof else None})
  except Exception:
   print(json.dumps({'cutover':'failed','stage':stage,'source_rollback_verified':False,'target_selected':False}));sys.exit(2)
  # Reset the same bind-mounted inode before resuming the original bridge.
  write_manifest({'version':1,'phase':'prepared'})
  rollback=True
 if paused and rollback:control('resume')
 print(json.dumps({'cutover':'failed','stage':stage,'source_rollback_verified':rollback,'target_selected':selected}));sys.exit(1)
'''
if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--apply',action='store_true',help='Perform the reviewed one-time fenced handover')
 args=parser.parse_args()
 if not args.apply:
  print('Preview only: fence Neon, restore private PostgreSQL, verify all counts, durably select target. Review PLATFORM-RECOVERY.md preflight before --apply. Existing target selection forbids execution.')
  raise SystemExit(0)
 result=subprocess.run(['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','jd@jdh-docker-00','python3 -'],input=remote.encode(),stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=240)
 print(result.stdout.decode());raise SystemExit(result.returncode)
