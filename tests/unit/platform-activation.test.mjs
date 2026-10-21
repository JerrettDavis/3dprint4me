import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabaseActivation, BUSINESS_TABLES } from '../../lib/platform/activation.js';

function fixture(overrides={}) {
  const counts=Object.fromEntries(BUSINESS_TABLES.map(name=>[name,2]));
  const config={version:1,phase:'fenced-and-restored',generation:'4a634eea-7a65-42dc-9b75-fce884ccdf1d',databaseUrl:'postgresql://platform_app:'+'s'.repeat(48)+'@postgres:5432/platform_live_test',sourceDumpSha256:'a'.repeat(64),expectedCounts:counts,...overrides};
  const env={DATABASE_URL:'source-private',DATABASE_DRIVER:'postgres',OPERATOR_AUTH_PROVIDER:'neon',OIDC_ISSUER:'https://auth.example/',OPERATOR_OWNER_SUBJECT:'approved',PLATFORM_CONTROL_DATABASE_URL:'postgresql://platform_app:'+'s'.repeat(48)+'@postgres:5432/platform'};
  let closed=0,ended=0;
  const pool={query:async text=>({rows:[text.includes('current_user')?{user:'platform_app',superuser:false,bypass:false,owns_tables:false,source_fenced:false}:text.includes('operator_identity_bindings')?{count:1}: {counts}]}),end:async()=>{ended++;}};
  let selection=null;
  const options={env,load:async()=>JSON.stringify(config),makePool:()=>pool,closeBusiness:async()=>{closed++;},getSelection:async()=>selection,persistSelection:async next=>{selection=next;}};
  return {config,env,pool,options,selection:()=>selection,closed:()=>closed,ended:()=>ended,activate:createDatabaseActivation(options)};
}
test('activation verifies source-fenced manifest, native role, all source row counts and exact owner before switching',async()=>{
  const f=fixture();await f.activate();assert.equal(f.env.DATABASE_URL,f.config.databaseUrl);assert.equal(f.env.OPERATOR_AUTH_PROVIDER,'authentik');assert.equal(f.closed(),1);assert.equal(f.ended(),1);
});

test('GitHub activation checks fixed issuer and account ID, independently of source auth',async()=>{
  const f=fixture();Object.assign(f.env,{PLATFORM_TARGET_AUTH_PROVIDER:'github',GITHUB_CLIENT_ID:'client',GITHUB_CLIENT_SECRET:'private',OPERATOR_OWNER_SUBJECT:'2610199'});
  delete f.env.OIDC_ISSUER;
  const original=f.pool.query;
  f.pool.query=async(text,params)=>{
    if(text.includes('operator_identity_bindings'))assert.deepEqual(params,['https://github.com/','2610199']);
    return original(text);
  };
  await f.activate();assert.equal(f.env.OPERATOR_AUTH_PROVIDER,'github');
  f.env.OPERATOR_AUTH_PROVIDER='neon';await createDatabaseActivation(f.options).bootstrap();assert.equal(f.env.OPERATOR_AUTH_PROVIDER,'github');
});

test('restart selects the persisted target after new writes changed row counts, without falling back to source',async()=>{
  const f=fixture();await f.activate();assert.equal(f.selection().databaseName,'platform_live_test');
  f.env.DATABASE_URL='source-private';f.env.OPERATOR_AUTH_PROVIDER='neon';
  f.pool.query=async text=>({rows:[text.includes('current_user')?{user:'platform_app',superuser:false,bypass:false,owns_tables:false,source_fenced:false}:{count:1}]});
  const restarted=createDatabaseActivation(f.options);await restarted.bootstrap();
  assert.equal(f.env.DATABASE_URL,f.config.databaseUrl);assert.equal(f.env.OPERATOR_AUTH_PROVIDER,'authentik');
});

test('bootstrap fails closed during an incomplete handover or unavailable persisted target',async()=>{
  const incomplete=fixture({phase:'fencing'});await assert.rejects(incomplete.activate.bootstrap());assert.equal(incomplete.env.DATABASE_URL,'source-private');
  const active=fixture();await active.activate();active.env.DATABASE_URL='source-private';
  active.pool.query=async()=>{throw new Error('private connection failure');};
  await assert.rejects(createDatabaseActivation(active.options).bootstrap(),error=>error.status===503&&!error.message.includes('private connection'));
  assert.equal(active.env.DATABASE_URL,'source-private');
});
test('unsafe, unfenced, incomplete, empty-owner or unrelated targets never switch a running service',async()=>{
  for(const values of [{phase:'prepared'},{databaseUrl:'postgresql://platform_app:secret@evil.example/platform_live_test'},{expectedCounts:{}},{sourceDumpSha256:'invalid'}]){
    const f=fixture(values);await assert.rejects(f.activate());assert.equal(f.env.DATABASE_URL,'source-private');assert.equal(f.closed(),0);
  }
  const f=fixture();f.pool.query=async()=>({rows:[{user:'platform_app',superuser:true,bypass:false,owns_tables:false}]});await assert.rejects(f.activate());assert.equal(f.closed(),0);
});

test('record-count mismatch and missing approved owner block activation',async()=>{
  for(const mode of ['counts','owner']) {
    const f=fixture(),query=f.pool.query;
    f.pool.query=async text=>{
      const result=await query(text);
      if(mode==='counts'&&result.rows[0]?.counts)result.rows[0]={counts:{...result.rows[0].counts,service_requests:0}};
      if(mode==='owner'&&text.includes('operator_identity_bindings'))result.rows[0]={count:0};
      return result;
    };
    await assert.rejects(f.activate());assert.equal(f.env.DATABASE_URL,'source-private');assert.equal(f.closed(),0);
  }
});
