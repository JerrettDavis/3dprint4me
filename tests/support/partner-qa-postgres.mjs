import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {MIGRATIONS,splitStatements} from '../../scripts/migrate-neon.mjs';
import {nativePoolOptions,createNativeDatabase} from '../../lib/database.js';
const IMAGE='postgres:18@sha256:edb0c08dc33befd0262ab3b5cf1c4f3f8cfd8b09e88c05b45adee29d6761ddb6';
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:90000,stdio:['pipe','pipe','pipe']}).trim();
export async function qaPostgresFixture(){
 const containers=[],pools=[];
 const close=async()=>{await Promise.all(pools.map(p=>p.end()));for(const name of containers)docker('stop',name);};
 async function cluster(dbname){
  const name='3dprint4me-partner-qa-test-'+randomUUID().slice(0,8);docker('run','--detach','--rm','--name',name,'--label','3dprint4me.purpose=partner-qa-test','--publish','127.0.0.1::5432','--env','POSTGRES_HOST_AUTH_METHOD=trust','--env','POSTGRES_DB='+dbname,IMAGE);containers.push(name);
  const port=JSON.parse(docker('inspect',name))[0].NetworkSettings.Ports['5432/tcp'][0].HostPort,url=`postgresql://postgres@127.0.0.1:${port}/${dbname}`;
  const admin=new pg.Pool(nativePoolOptions(url));pools.push(admin);
  let ready=false;for(let n=0;n<80;n++){try{await admin.query('SELECT 1');ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}}if(!ready)throw Error('QA fixture unavailable');
  await admin.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC; CREATE ROLE platform_backend NOLOGIN; CREATE ROLE platform_app LOGIN IN ROLE platform_backend; GRANT USAGE ON SCHEMA public TO platform_backend');
  for(const file of MIGRATIONS)for(const sql of splitStatements(await readFile(new URL('../../neon/migrations/'+file,import.meta.url),'utf8')))await admin.query(sql);
  const connect=role=>{const pool=new pg.Pool(nativePoolOptions(url.replace('postgres@',role+'@')));pools.push(pool);return {pool,database:createNativeDatabase({pool})};};
  return {admin,url,connect};
 }
 try{
 const live=await cluster('partner_live_test'),qa=await cluster('partner_qa_test');
 await live.admin.query('CREATE ROLE partner_qa_auth LOGIN');
 await live.admin.query(await readFile(new URL('../../deploy/platform/partner-qa-auth.sql',import.meta.url),'utf8'));
 await qa.admin.query("CREATE TABLE public.partner_qa_identity(singleton boolean PRIMARY KEY CHECK(singleton),realm text NOT NULL CHECK(realm='qa')); INSERT INTO public.partner_qa_identity VALUES(true,'qa'); REVOKE ALL ON public.partner_qa_identity FROM PUBLIC; GRANT SELECT ON public.partner_qa_identity TO platform_backend");
 const auth=live.connect('partner_qa_auth'),business=qa.connect('platform_app');
 return {live,qa,auth,business,close};
 }catch(error){await close();throw error;}
}
