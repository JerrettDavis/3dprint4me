import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { BUSINESS_TABLES } from '../../lib/platform/activation.js';
import { fenceSource, restoreSourceWrites, releaseRestoredSourceFence } from '../../lib/platform/source-fence.js';

test('source owner DML is fenced transactionally without changing records, and rollback requires no target writes',async()=>{
  const db=new PGlite();
  try {
    await db.exec('CREATE ROLE source_owner LOGIN BYPASSRLS; GRANT pg_write_all_data TO source_owner; ALTER SCHEMA public OWNER TO source_owner; SET ROLE source_owner');
    for(const name of BUSINESS_TABLES)await db.exec(`CREATE TABLE ${name}(id text)`);
    await db.exec("INSERT INTO operators VALUES('owner'); INSERT INTO service_requests VALUES('existing')");
    const client={query:(text,values)=>db.query(text,values)};
    const manifest=await fenceSource(client);assert.equal(manifest.counts.service_requests,1);assert.equal(manifest.counts.operators,1);
    assert.equal((await db.query('SELECT * FROM service_requests')).rows.length,1);
    await assert.rejects(db.exec("INSERT INTO service_requests VALUES('forbidden')"));
    await assert.rejects(releaseRestoredSourceFence(client,{proof:manifest.proof}));
    await assert.rejects(restoreSourceWrites(client,{targetAcceptedWrites:true}));
    await assert.rejects(restoreSourceWrites(client,{targetAcceptedWrites:false,proof:manifest.proof,getTargetSelection:async()=>({databaseName:'platform_live_existing'})}));
    await restoreSourceWrites(client,{targetAcceptedWrites:false,proof:manifest.proof,getTargetSelection:async()=>null});await db.exec("INSERT INTO service_requests VALUES('recovered')");
    assert.equal((await db.query('SELECT * FROM service_requests')).rows.length,2);
  }finally{await db.close();}
});

for(const kind of ['role','public'])test(`source statement fence also blocks the existing ${kind} writer without changing ACLs`,async()=>{
  const db=new PGlite();
  try {
    await db.exec('CREATE ROLE source_owner LOGIN BYPASSRLS; CREATE ROLE existing_writer LOGIN; GRANT pg_write_all_data TO source_owner; ALTER SCHEMA public OWNER TO source_owner; SET ROLE source_owner');
    for(const name of BUSINESS_TABLES)await db.exec(`CREATE TABLE ${name}(id text)`);
    await db.exec('GRANT USAGE ON SCHEMA public TO existing_writer');
    await db.exec(`GRANT INSERT ON service_requests TO ${kind==='role'?'existing_writer':'PUBLIC'}`);
    const client={query:(text,values)=>db.query(text,values)};
    const manifest=await fenceSource(client);
    await db.exec('RESET ROLE; SET ROLE existing_writer');
    await assert.rejects(db.exec("INSERT INTO service_requests VALUES('blocked')"),error=>error.code==='55000');
    await db.exec('RESET ROLE; SET ROLE source_owner');
    await restoreSourceWrites(client,{targetAcceptedWrites:false,proof:manifest.proof,getTargetSelection:async()=>null});
    await db.exec('RESET ROLE; SET ROLE existing_writer');await db.exec("INSERT INTO service_requests VALUES('restored')");
  }finally{await db.close();}
});
test('source fence refuses an unknown SECURITY DEFINER entrypoint before changing the source',async()=>{
  const db=new PGlite();
  try {
    await db.exec('CREATE ROLE source_owner LOGIN BYPASSRLS; ALTER SCHEMA public OWNER TO source_owner; SET ROLE source_owner');
    for(const name of BUSINESS_TABLES)await db.exec(`CREATE TABLE ${name}(id text)`);
    await db.exec("CREATE FUNCTION public.hidden_writer() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ INSERT INTO service_requests VALUES('hidden') $$");
    await assert.rejects(fenceSource({query:(text,values)=>db.query(text,values)}));await db.exec("INSERT INTO service_requests VALUES('still-open')");
  }finally{await db.close();}
});
