import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalPrintRepository } from '../../lib/print-estimation/adapters/local-print-repository.js';
import { createSpoolmanSync } from '../../lib/spoolman/application.js';

const spool = { id: 1, archived: false, remaining_weight: 999.9, initial_weight: 1000, filament: { id: 2, material: 'PLA', color_hex: '0000ff', name: 'Blue' } };
test('sync preserves stable IDs, unchanged revisions, local fields and complete success through failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spool-sync-'));
  try {
    let stamp = new Date('2026-10-22T12:00:00Z'), data = [spool], fail = false;
    const repository = createLocalPrintRepository({ path: join(dir, 'inventory.json'), now: () => stamp });
    const sync = createSpoolmanSync({ repository, instanceId: 'home', now: () => stamp, provider: { configured: true, snapshot: async () => { if(fail)throw Error('secret'); return {currency:'USD',spools:data}; } } });
    await sync.run();
    const [first] = await repository.listFilament(); assert.equal(first.onHandGrams, 999); assert.equal(first.purchaseCostCents, null);
    await repository.saveImportedFilament({ id:first.id, revision: first.revision, local:{notes:'Keep',freightFeeCents:10,estimateDefault:true,costOverrideCents:2200} });
    const [edited] = await repository.listFilament();
    stamp = new Date('2026-10-22T12:01:00Z'); await sync.run();
    const [second] = await repository.listFilament(); assert.equal(second.id,first.id); assert.equal(second.revision,edited.revision); assert.equal(second.notes,'Keep'); assert.equal(second.source.lastSuccessAt,stamp.toISOString());
    fail = true; stamp = new Date('2026-10-22T12:02:00Z'); await sync.run();
    const status = await repository.getSpoolmanStatus(); assert.equal(status.lastSuccessAt,'2026-10-22T12:01:00.000Z'); assert.equal(status.failureCode,'spoolman_unavailable');
    assert.equal((await repository.listFilament()).length,1);
    fail = false; data = []; await sync.run(); assert.equal((await repository.listFilament())[0].active,false);
    data = [spool]; await sync.run(); assert.equal((await repository.listFilament())[0].id,first.id); assert.equal((await repository.listFilament())[0].active,true);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('unconfigured sync never fetches or changes inventory', async () => {
  let touched=false;
  const sync=createSpoolmanSync({instanceId:'home',repository:{},provider:{configured:false,snapshot:async()=>{touched=true;}}});
  assert.equal((await sync.run()).configured,false); assert.equal(touched,false);
});
