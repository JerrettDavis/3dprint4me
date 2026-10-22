import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperatorController } from '../../operator/assets/operator.js';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const payload = id => ({ item: { id, revision: 1 }, request: {} });
test('switching work rejects actions from old detail and discards out-of-order responses', async () => {
  const b = deferred(), c = deferred(), displays = [], mutations = [];
  const view = { state() {}, detail(d) { displays.push(d.item.id); }, announce() {} };
  const api = { getWork: async id => id === 'A' ? payload(id) : id === 'B' ? b.promise : c.promise, filamentCommand: async (id, command) => { mutations.push([id, command]); } };
  const controller = createOperatorController({ api, view });
  await controller.select('A');
  const loadingB = controller.select('B');
  const staleAction = controller.filamentAction('filamentCommand', { type: 'save-requirements', revision: 0, requirements: [] }, 'A');
  // Resolve the in-flight read so the pre-fix controller cannot hang the regression test.
  b.resolve(payload('B'));
  await assert.rejects(staleAction, /selected work|loading/i);
  await loadingB;
  assert.equal(mutations.length, 0);
  const old = deferred(); api.getWork = id => id === 'A' ? old.promise : c.promise;
  const loadingA = controller.select('A'), loadingC = controller.select('C');
  c.resolve(payload('C')); await loadingC;
  old.resolve(payload('A')); await loadingA;
  assert.equal(displays.at(-1), 'C');
  assert.equal(controller.snapshot().detail.item.id, 'C');
});
