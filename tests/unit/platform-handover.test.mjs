import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandoverGate } from '../../lib/platform/handover.js';

test('handover drains active handlers, queues new requests and resumes each exactly once',async()=>{
  const gate=createHandoverGate();let release;const hold=new Promise(r=>{release=r;});let writes=0;
  const active=gate.run(async()=>{await hold;writes++;});
  const pause=gate.pause();const waiting=gate.run(async()=>{writes++;});
  await Promise.resolve();assert.equal(writes,0);release();await active;await pause;assert.equal(writes,1);
  await gate.activate(async()=>{});gate.resume();await waiting;assert.equal(writes,2);
});
test('handover bounds queued work and rejects switching while handlers are active',async()=>{
  const gate=createHandoverGate({maxQueue:1});await gate.pause();
  const waiting=gate.run(async()=>{});await assert.rejects(()=>gate.run(async()=>{}),error=>error.status===503);
  gate.resume();await waiting;await assert.rejects(()=>gate.activate(async()=>{}));
});
test('a failed activation retains the pause; a timed-out drain safely reopens before any switch',async()=>{
  const gate=createHandoverGate();await gate.pause();await assert.rejects(()=>gate.activate(async()=>{throw Error('failed');}));
  assert.equal(gate.status().paused,true);gate.resume();
  let release;const hold=new Promise(r=>{release=r;});const active=gate.run(()=>hold);
  await assert.rejects(()=>gate.pause({timeoutMs:5}),error=>error.status===503);assert.equal(gate.status().paused,false);release();await active;
});
