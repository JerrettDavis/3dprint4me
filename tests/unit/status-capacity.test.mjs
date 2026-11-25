import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCapacity, updateCapacity, capacitySnapshot } from '../../status/lib/capacity.js';

const now = 1800000000000;
const record = (overrides = {}) => ({ id: 'blob-storage', used: 70, limit: 100, observedAt: now, periodStart: null, periodEnd: null, source: 'provider', scope: 'project', ...overrides });
const metric = (state, time = now, id = 'blob-storage') => capacitySnapshot(state, time).metrics.find(m => m.id === id);
test('capacity validates finite nonnegative measurements, registry, keys and bounds', () => {
  for (const change of [{used: -1}, {limit: Infinity}, {observedAt: now + 30001}, {source: 'invented'}, {scope: 'invented'}, {id:'invented'}, {extra:true}, {periodStart:now,periodEnd:now-1}]) {
    assert.throws(() => validateCapacity([record(change)], now));
  }
  assert.throws(() => validateCapacity([record(), record()], now));
  assert.throws(() => validateCapacity(Array.from({length:41}, () => record()), now));
});
test('quota thresholds, unknowns, unlimited and stale observations', () => {
  assert.equal(metric(updateCapacity(null,[record()],now)).status,'warning');
  assert.equal(metric(updateCapacity(null,[record({used:90})],now)).status,'critical');
  assert.equal(metric(updateCapacity(null,[record({used:0,limit:0})],now)).status,'critical');
  assert.equal(metric(updateCapacity(null,[record({used:null})],now)).status,'unknown');
  assert.equal(metric(updateCapacity(null,[record({limit:null,unlimited:true})],now)).unlimited,true);
  const state = updateCapacity(null,[record()],now);
  assert.equal(metric(updateCapacity(state,[],now+1)).observedAt,now);
  assert.equal(metric(state,now+7200001).status,'stale');
});
test('two distinct local samples and two recovery samples with hysteresis', () => {
  const local = record({id:'host-memory',source:'local',scope:'host',used:91});
  let state = updateCapacity(null,[local],now);
  assert.equal(metric(state,now,'host-memory').status,'normal');
  state = updateCapacity(state,[local],now);
  assert.equal(metric(state,now,'host-memory').status,'normal');
  state = updateCapacity(state,[{...local,observedAt:now+1}],now+1);
  assert.equal(metric(state,now+1,'host-memory').status,'critical');
  state = updateCapacity(state,[{...local,used:84,observedAt:now+2}],now+2);
  assert.equal(metric(state,now+2,'host-memory').status,'critical');
  state = updateCapacity(state,[{...local,used:84,observedAt:now+3}],now+3);
  assert.equal(metric(state,now+3,'host-memory').status,'warning');
});
test('period reset clears thresholds; corrupt persisted state is ignored', () => {
  let state = updateCapacity(null,[record({used:95,periodStart:now-100,periodEnd:now+100})],now);
  state = updateCapacity(state,[record({used:1,periodStart:now,periodEnd:now+200,observedAt:now+1})],now+1);
  assert.equal(metric(state,now+1).status,'normal');
  assert.doesNotThrow(() => capacitySnapshot({readings:{secret:'unsafe'},thresholds:[],history:Array(100).fill({})},now));
  assert.ok(capacitySnapshot(state,now).history.length <= 30);
});
test('freshness uses source deadlines and keeps unknown data out of normal state', () => {
  for (const [source,age] of [['provider',7200000],['local',720000],['application',720000],['backup',7200000],['manual',86400000]]) {
    const ids={local:'db-size',application:'rate-sessions-global',backup:'backup-downloaded'};
    const id=ids[source] ?? 'blob-storage';
    const scope=source==='local'?'host':source==='application'||source==='backup'?'application':'project';
    const state=updateCapacity(null,[record({id,source,scope})],now);
    assert.notEqual(metric(state,now+age,id).status,'stale');
    assert.equal(metric(state,now+age+1,id).status,'stale');
  }
  assert.equal(metric(null).status,'unknown');
  assert.equal(metric(updateCapacity(null,[record({limit:null})],now)).status,'unknown');
});
test('source and scope attest metric ownership; numeric bounds and clock allowance are enforced', () => {
  for (const changes of [{source:'local',scope:'host'},{source:'application',scope:'application'},{scope:'host'},{scope:'application'}, {used:Number.MAX_SAFE_INTEGER+1},{limit:Number.MAX_SAFE_INTEGER+1}]) assert.throws(()=>validateCapacity([record(changes)],now));
  assert.doesNotThrow(()=>validateCapacity([record({source:'manual',scope:'account',observedAt:now+30000})],now));
  assert.throws(()=>validateCapacity([record({id:'host-disk',source:'manual',scope:'host'})],now));
  for(const key of ['used','limit','observedAt','periodStart','periodEnd','scope','source']) {
    const r=record(); delete r[key]; assert.throws(()=>validateCapacity([r],now));
  }
});
test('expired windows are stale and old observations cannot replace current readings', () => {
  const state=updateCapacity(null,[record({periodStart:now-1000,periodEnd:now+1000})],now);
  assert.equal(metric(state,now+1000).status,'stale');
  const unchanged=updateCapacity(state,[record({used:99,observedAt:now-1})],now);
  assert.equal(metric(unchanged).used,70);
});
test('manual allowance provenance expires independently of fresh provider usage', () => {
  const verified=now-86400000;
  const input=record({used:95,limitSource:'manual',limitVerifiedAt:verified});
  let state=updateCapacity(null,[input],now);
  assert.equal(metric(state).status,'critical');
  assert.equal(metric(state).limitSource,'manual');
  assert.equal(metric(state).limitVerifiedAt,verified);
  state=updateCapacity(state,[{...input,used:10,observedAt:now+1}],now+1);
  const value=metric(state,now+1);
  assert.equal(value.status,'unknown');
  assert.equal(value.quotaState,'stale');
  assert.equal(value.percent,null);
  assert.equal(value.remaining,null);
  assert.equal(value.used,10);
  assert.equal(value.activeSeverity,'critical');
  state=updateCapacity(state,[{...input,used:10,observedAt:now+2}],now+2);
  assert.equal(metric(state,now+2).activeSeverity,'critical');
});
test('manual limit verification is required and source annotations are bounded', () => {
  for(const change of [{limitSource:'manual'}, {limitSource:'manual',limitVerifiedAt:null}, {limitSource:'manual',limitVerifiedAt:now+30001}, {limitSource:'invented'}]) assert.throws(()=>validateCapacity([record(change)],now));
  assert.doesNotThrow(()=>validateCapacity([record({limitSource:'manual',limitVerifiedAt:now+30000})],now));
  assert.equal(metric(updateCapacity(null,[record()],now)).limitSource,'provider');
  assert.equal(metric(updateCapacity(null,[record({source:'manual'})],now)).quotaState,'unknown');
});
test('recovery must cross hysteresis margin twice and history stays bounded', () => {
  let state=updateCapacity(null,[record({used:95})],now);
  for (const [offset,used,status] of [[1,89,'critical'],[2,84,'critical'],[3,86,'critical'],[4,84,'critical'],[5,84,'warning'],[6,64,'warning'],[7,64,'normal']]) {
    state=updateCapacity(state,[record({used,observedAt:now+offset})],now+offset);
    assert.equal(metric(state,now+offset).status,status);
  }
  for(let day=1;day<40;day++) state=updateCapacity(state,[],now+day*86400000);
  assert.equal(state.history.length,30);
  assert.ok(state.readings.length<=40);
});
