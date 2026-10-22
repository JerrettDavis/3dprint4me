import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalPrintRepository } from '../../lib/print-estimation/adapters/local-print-repository.js';
import { createOperatorPrintHandler } from '../../api/operator-print.js';
import { createWorkManagementService } from '../../lib/work-management/service.js';
import { normalizeSpoolmanSnapshot } from '../../lib/spoolman/domain.js';
const origin = 'https://work.example';
const detail = { item: { id: 'work_aaaaaaaa', requestId: '3DP-TEST-12345678' }, request: { service: 'print', specifications: { material: 'pla', color: 'blue', grams: '20' }, contact: { email: 'customer@example.com' } } };
async function call(handler, body, resource = 'filament-settings', suppliedOrigin = origin) {
  const response = { statusCode: 200, setHeader() {}, end(body) { this.body = JSON.parse(body); } };
  await handler({ method: body ? 'POST' : 'GET', url: `/api/operator-print?resource=${resource}`, headers: { origin: suppliedOrigin, 'content-type': 'application/json' }, body }, response);
  return response;
}
test('operator filament resources enforce owner writes, exact fields, preview and work lookup', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'filament-api-'));
  try {
    const repo = createLocalPrintRepository({ path: join(dir, 'print.json') });
    let lookups = 0;
    const store = { getWork: async id => { assert.equal(id, detail.item.id); lookups++; return detail; } };
    const handler = role => createOperatorPrintHandler({ store, printRuntime: { repository: repo }, allowedOrigins: [origin], authorize: async () => ({ id: 'op_test', role }) });
    assert.equal((await call(handler('operator'))).statusCode, 200);
    assert.equal((await call(handler('operator'), { action: 'save-filament-settings', revision: 0, settings: {} })).statusCode, 403);
    assert.equal((await call(handler('owner'), { action: 'save-filament-settings', revision: 0, settings: { mode: 'rgb' } })).statusCode, 200);
    assert.equal((await call(handler('owner'), { action: 'save-filament-settings', revision: 0, settings: {} })).statusCode, 409);
    const preview = await call(handler('operator'), { action: 'preview-filament-matching', workId: detail.item.id, settings: { mode: 'rgb' } });
    assert.equal(preview.statusCode, 200); assert.equal(preview.body.available, true); assert.equal(lookups, 1);
    assert.equal((await call(handler('owner'), { action: 'save-filament-settings', revision: 1, settings: {}, extra: 1 })).statusCode, 400);
    assert.equal((await call(handler('owner'), null, 'filament-settings', 'https://evil.example')).statusCode, 403);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('matching composes without print assets and fails without losing the work detail', async () => {
  const service = createWorkManagementService({ repository: { getWork: async () => detail }, filamentMatching: { forWork: async d => ({ available: true, work: d.item.id }) } });
  assert.equal((await service.detail('work', {})).filamentMatching.available, true);
  const failed = createWorkManagementService({ repository: { getWork: async () => detail }, filamentMatching: { forWork: async () => { throw Error('PRIVATE'); } } });
  const result = await failed.detail('work', {}); assert.equal(result.request.service, 'print'); assert.deepEqual(result.filamentMatching, { available: false });
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});

test('Spoolman refresh and local overrides require owner and reject source-field tampering', async () => {
  const dir=await mkdtemp(join(tmpdir(),'spool-api-'));
  try {
    const repo=createLocalPrintRepository({path:join(dir,'print.json')});
    await repo.claimSpoolmanSync({instanceId:'home',token:'t',attemptedAt:new Date().toISOString(),leaseUntil:new Date(Date.now()+120000).toISOString()});
    const completedAt=new Date().toISOString();
    await repo.applySpoolmanSnapshot({instanceId:'home',token:'t',completedAt,snapshot:normalizeSpoolmanSnapshot({instanceId:'home',currency:'USD',spools:[{id:1,archived:false,initial_weight:1000,remaining_weight:800,filament:{material:'PLA',color_hex:'0000ff'}}]})});
    const [imported]=await repo.listFilament();
    const handler=role=>createOperatorPrintHandler({store:{},printRuntime:{repository:repo},allowedOrigins:[origin],authorize:async()=>({id:'op_test',role})});
    assert.equal((await call(handler('operator'),{action:'refresh-spoolman'})).statusCode,403);
    assert.equal((await call(handler('owner'),{action:'refresh-spoolman'})).body.queued,true);
    assert.equal((await call(handler('owner'),{action:'refresh-spoolman'},'filament','https://evil.example')).statusCode,403);
    assert.equal((await call(handler('owner'),{action:'save-imported-filament',id:'fil_aaaaaaaa',revision:1,local:{onHandGrams:50}})).statusCode,400);
    const listing=await call(handler('operator'),null,'filament');assert.equal(listing.body.sync.configured,true);assert.equal(JSON.stringify(listing.body).includes('"token"'),false);
    const saved=await call(handler('owner'),{action:'save-imported-filament',id:imported.id,revision:imported.revision,local:{notes:'Local',freightFeeCents:0,estimateDefault:true,costOverrideCents:2300}});
    assert.equal(saved.statusCode,200);assert.equal(saved.body.filament.source.lastSuccessAt,completedAt);assert.equal(saved.body.filament.landedUsdPerKg,23);
  } finally {await rm(dir,{recursive:true,force:true});}
});
