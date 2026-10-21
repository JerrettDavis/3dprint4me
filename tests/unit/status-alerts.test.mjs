import test from 'node:test';
import assert from 'node:assert/strict';
import { deliverStatusAlert } from '../../status/lib/alerts.js';

test('operational alerts are owner-only, deduplicated and reuse persisted idempotency on retry',async()=>{
  const env={ALERT_RESEND_KEY:'private-key',ALERT_FROM:'workshop@example.com',ALERT_TO:'owner@example.com'},view={blockers:[{id:'backup-missing',title:'Backup missing',next:'Check backup.'}],components:[]};
  let persisted,calls=[];const persist=async state=>{persisted=structuredClone(state);};
  const send=async(url,options)=>{assert.ok(persisted.alerts.pending);calls.push(JSON.parse(options.body));assert.deepEqual(calls.at(-1).to,['owner@example.com']);return new Response('{}',{status:200});};
  let state=await deliverStatusAlert({state:{},view,env,now:1800000000000,persist,fetchImpl:send});
  assert.equal(calls.length,1);assert.equal(state.alerts.pending,null);
  state=await deliverStatusAlert({state,view,env,now:1800000300000,persist,fetchImpl:send});assert.equal(calls.length,1);
  let key;
  state=await deliverStatusAlert({state,view:{...view,blockers:[]},env,now:1800001000000,persist,fetchImpl:async(_url,options)=>{key=options.headers['Idempotency-Key'];throw Error('unknown send outcome');}});
  assert.equal(state.alerts.lastFailureAt,1800001000000);
  state=await deliverStatusAlert({state,view:{...view,blockers:[]},env,now:1800002000000,persist,fetchImpl:async(_url,options)=>{assert.equal(options.headers['Idempotency-Key'],key);return new Response('{}',{status:200});}});
  assert.equal(state.alerts.pending,null);
  assert.ok(!JSON.stringify(state).includes('private-key'));
});
test('missing alert configuration sends nothing and is explicitly unconfigured',async()=>{
  const state=await deliverStatusAlert({state:{},view:{blockers:[],components:[]},env:{},now:1,persist:async()=>{},fetchImpl:async()=>{throw Error('must not send');}});
  assert.equal(state.alerts.configured,false);
});
