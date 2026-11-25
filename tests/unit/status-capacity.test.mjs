import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCapacity, updateCapacity, capacitySnapshot } from '../../status/lib/capacity.js';

const now = 1800000000000;
const record = (overrides = {}) => ({ id: 'blob-storage', used: 70, limit: 100, observedAt: now, periodStart: null, periodEnd: null, source: 'provider', scope: 'project', ...overrides });
const metric = (state, time = now, id = 'blob-storage') => capacitySnapshot(state, time).metrics.find(m => m.id === id);
test('capacity validates finite nonnegative measurements, registry, keys and bounds', () => {
  for (const change of [{used: -1}, {limit: Infinity}, {observedAt: now + 1}, {source: 'invented'}, {scope: 'invented'}, {id:'invented'}, {extra:true}, {periodStart:now,periodEnd:now-1}]) {
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
