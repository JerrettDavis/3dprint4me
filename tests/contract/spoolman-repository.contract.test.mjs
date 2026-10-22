import test from 'node:test';
import assert from 'node:assert/strict';
import { createMigratedDatabase } from '../support/pglite-neon.mjs';
import { createNeonPrintRepository } from '../../lib/print-estimation/adapters/neon-print-repository.js';
import { normalizeSpoolmanSnapshot } from '../../lib/spoolman/domain.js';
import { readFile } from 'node:fs/promises';
import { splitStatements } from '../../scripts/migrate-neon.mjs';

test('PostgreSQL atomic import enforces leases, stable IDs, nullable data, revisions and source locks', async () => {
  const db = await createMigratedDatabase();
  try {
    const migration = await readFile(new URL('../../neon/migrations/011_spoolman_inventory.sql', import.meta.url),'utf8');
    for (const statement of splitStatements(migration)) await db.db.query(statement);
    const transaction = operation => db.db.transaction(tx => operation({query: async(strings,...values) => (await tx.query(strings.reduce((text,part,i)=>text+(i?`$${i}`:'')+part,''),values)).rows}));
    const repo = createNeonPrintRepository({query:db.query,withTransaction:transaction});
    const start = '2026-10-22T12:00:00Z', leaseUntil = '2026-10-22T12:02:00Z';
    const snapshot = normalizeSpoolmanSnapshot({instanceId:'home',currency:'USD',spools:[{id:1,archived:false,remaining_weight:850.2,filament:{material:'PLA',color_hex:'0000ff'}}]});
    assert.equal(await repo.claimSpoolmanSync({instanceId:'home',token:'first',attemptedAt:start,leaseUntil}),true);
    assert.equal(await repo.claimSpoolmanSync({instanceId:'home',token:'second',attemptedAt:start,leaseUntil}),false);
    await assert.rejects(repo.claimSpoolmanSync({instanceId:'other',token:'mismatch',attemptedAt:start,leaseUntil}),{status:409});
    await assert.rejects(repo.applySpoolmanSnapshot({instanceId:'home',token:'wrong',snapshot,completedAt:start}),{status:409});
    await repo.applySpoolmanSnapshot({instanceId:'home',token:'first',snapshot,completedAt:start});
    const [first] = await repo.listFilament(); assert.equal(first.purchaseCostCents,null); assert.equal(first.spoolNominalGrams,null); assert.equal(first.onHandGrams,850);
    await repo.saveImportedFilament({id:first.id,revision:1,local:{notes:'local',estimateDefault:true,freightFeeCents:0,costOverrideCents:2000}});
    await assert.rejects(repo.saveFilament({...first,onHandGrams:10}),{status:409});
    await repo.claimSpoolmanSync({instanceId:'home',token:'again',attemptedAt:start,leaseUntil});
    await repo.applySpoolmanSnapshot({instanceId:'home',token:'again',snapshot,completedAt:start});
    const [again] = await repo.listFilament(); assert.equal(again.id,first.id); assert.equal(again.revision,2); assert.equal(again.notes,'local'); assert.equal(again.costOverrideCents,2000);
    await repo.claimSpoolmanSync({instanceId:'home',token:'color',attemptedAt:start,leaseUntil});
    const changed=normalizeSpoolmanSnapshot({instanceId:'home',currency:'USD',spools:[{id:1,archived:false,remaining_weight:850.2,filament:{material:'PLA',color_hex:'ff0000'}}]});
    await repo.applySpoolmanSnapshot({instanceId:'home',token:'color',snapshot:changed,completedAt:start});
    assert.equal((await repo.listFilament())[0].colorHex,'#ff0000');
    await repo.claimSpoolmanSync({instanceId:'home',token:'empty',attemptedAt:start,leaseUntil});
    await repo.applySpoolmanSnapshot({instanceId:'home',token:'empty',snapshot:{...snapshot,items:[]},completedAt:start});
    assert.equal((await repo.listFilament())[0].active,false);
    assert.equal((await repo.getSpoolmanStatus()).count,0);
    for (const statement of splitStatements(migration)) await db.db.query(statement);
  } finally { await db.close(); }
});

test('new sync state is backend-only and a broken snapshot rolls back the whole inventory',async()=>{
  const db=await createMigratedDatabase();
  try {
    const migration=await readFile(new URL('../../neon/migrations/011_spoolman_inventory.sql',import.meta.url),'utf8');
    await db.db.query('CREATE ROLE platform_backend NOLOGIN');
    for(const statement of splitStatements(migration))await db.db.query(statement);
    await db.db.query('SET ROLE platform_backend');
    await db.query`INSERT INTO spoolman_sync_state(id,instance_id) VALUES(1,'home')`;
    assert.equal((await db.query`SELECT count(*)::int AS n FROM spoolman_sync_state`)[0].n,1);
    await db.db.query('RESET ROLE');await db.db.query('CREATE ROLE spool_visitor NOLOGIN');await db.db.query('SET ROLE spool_visitor');
    await assert.rejects(db.db.query('SELECT * FROM spoolman_sync_state'),e=>e.code==='42501');
    await db.db.query('RESET ROLE');
    const transaction=operation=>db.db.transaction(tx=>operation({query:async(strings,...values)=>(await tx.query(strings.reduce((text,part,i)=>text+(i?`$${i}`:'')+part,''),values)).rows}));
    const repo=createNeonPrintRepository({query:db.query,withTransaction:transaction});
    const attemptedAt='2026-10-22T12:00:00Z',leaseUntil='2026-10-22T12:02:00Z';
    await repo.claimSpoolmanSync({instanceId:'home',token:'rollback',attemptedAt,leaseUntil});
    const snapshot=normalizeSpoolmanSnapshot({instanceId:'home',currency:'USD',spools:[{id:1,archived:false,remaining_weight:500,filament:{material:'PLA'}}]});
    snapshot.items.push({...snapshot.items[0],source:{...snapshot.items[0].source,spoolId:2},material:'bad!'});
    await assert.rejects(repo.applySpoolmanSnapshot({instanceId:'home',token:'rollback',snapshot,completedAt:attemptedAt}));
    assert.equal((await repo.listFilament()).length,0);assert.equal((await repo.getSpoolmanStatus()).lastSuccessAt,null);
  } finally {await db.close();}
});
