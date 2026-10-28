import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {MIGRATIONS} from '../../scripts/migrate-neon.mjs';
import {createNativeDatabase,nativePoolOptions} from '../../lib/database.js';
import {createCommunicationRepository} from '../../lib/work-communications/repository.js';
import {createCommunicationService} from '../../lib/work-communications/service.js';
import {createNeonPrintRepository} from '../../lib/print-estimation/adapters/neon-print-repository.js';
import {createOperatorModels} from '../../lib/print-estimation/application/operator-models.js';
import {createFilamentUseCases} from '../../lib/print-estimation/application/filament.js';
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:90000,stdio:['pipe','pipe','pipe']}).trim();
test('native PostgreSQL migrations, email claims, private model revisions and replay',{timeout:120000},async()=>{
 const name='3dprint4me-communications-'+randomUUID().slice(0,8);let admin,database,started=false;
 try{
  docker('run','--detach','--rm','--name',name,'--label','3dprint4me.purpose=communications-test','--publish','127.0.0.1::5432','--env','POSTGRES_HOST_AUTH_METHOD=trust','postgres:18@sha256:edb0c08dc33befd0262ab3b5cf1c4f3f8cfd8b09e88c05b45adee29d6761ddb6');started=true;
  const info=JSON.parse(docker('inspect',name))[0],port=info.NetworkSettings.Ports['5432/tcp'][0].HostPort,url=`postgresql://postgres@127.0.0.1:${port}/postgres`;
  admin=new pg.Pool(nativePoolOptions(url));let ready=false;
  for(let i=0;i<80;i++){try{await admin.query('SELECT 1');ready=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,250));}}assert.ok(ready);
  await admin.query('CREATE ROLE platform_backend NOLOGIN; CREATE ROLE platform_app LOGIN IN ROLE platform_backend; CREATE ROLE visitor LOGIN; GRANT USAGE ON SCHEMA public TO platform_backend');
  for(const file of MIGRATIONS)await admin.query(await readFile(new URL('../../neon/migrations/'+file,import.meta.url),'utf8'));
  for(const file of ['014_work_communications.sql','015_operator_model_revisions.sql'])await admin.query(await readFile(new URL('../../neon/migrations/'+file,import.meta.url),'utf8'));
  database=createNativeDatabase({pool:new pg.Pool(nativePoolOptions(url.replace('postgres@','platform_app@')))});
  const request={service:'print',projectTitle:'Synthetic revised model',contact:{email:'synthetic@example.test'}};
  await admin.query("INSERT INTO operators(id,auth_user_id,display_name,role) VALUES('op_native','synthetic','Synthetic','owner')");
  await admin.query("INSERT INTO service_requests(id,service,project_title,contact_name,contact_email,payload) VALUES('req_native','print','Synthetic','Synthetic','synthetic@example.test',$1)",[JSON.stringify(request)]);
  await admin.query("INSERT INTO work_items(id,request_id) VALUES('work_native_12345678','req_native')");
  const work={item:{id:'work_native_12345678',requestId:'req_native'},request},operator={id:'op_native',displayName:'Synthetic',role:'owner'};
  let calls=0;const service=createCommunicationService({repository:createCommunicationRepository({database}),delivery:async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,40));return {state:'sent'};}});
  const command={commandId:'command_native_123',kind:'email',body:'Synthetic dispatch'};
  const rows=await Promise.all(Array.from({length:8},()=>service.create(work,command,operator)));
  assert.equal(new Set(rows.map(row=>row.id)).size,1);assert.equal(calls,1);
  await service.create(work,{commandId:'comment_native_123',kind:'comment',body:'Private'},operator);
  assert.equal((await service.list(work)).messages.length,2);
  const visitor=new pg.Pool(nativePoolOptions(url.replace('postgres@','visitor@')));try{await assert.rejects(visitor.query('SELECT * FROM work_communications'),/permission denied/);}finally{await visitor.end();}
  const repository=createNeonPrintRepository({query:database.query,withTransaction:database.withTransaction}),objects=new Map(),bytes=await readFile(new URL('../fixtures/print-estimation/cube-20mm-binary.stl',import.meta.url));
  const fileStore={authorizeUpload:async path=>({uploadUrl:`https://private.test/${path}`}),inspect:async path=>objects.has(path)?{size:objects.get(path).length}:null,read:async path=>objects.get(path),delete:async path=>objects.delete(path)};
  const models=createOperatorModels({repository,fileStore,materialCosts:createFilamentUseCases({repository})});
  for(let i=0;i<2;i++){
   const grant=await models.authorizeUpload(work,{filename:'cube.stl',size:bytes.length,options:{material:'petg',quantity:i+1}});objects.set(new URL(grant.uploadUrl).pathname.slice(1),bytes);
   await models.finish(work,grant);await models.finish(work,grant);
  }
  const detail=await repository.forRequest('req_native');assert.equal(detail.assets.length,2);assert.equal(detail.estimates.filter(row=>row.purpose==='operator').length,2);
 }finally{
  await database?.close();await admin?.end();
  if(started){const info=JSON.parse(docker('inspect',name))[0];assert.equal(info.Config.Labels['3dprint4me.purpose'],'communications-test');docker('stop',info.Id);}
 }
});
