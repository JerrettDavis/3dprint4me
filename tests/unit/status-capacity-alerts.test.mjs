import test from 'node:test';
import assert from 'node:assert/strict';
import { deliverStatusAlert, capacityEmailSummary } from '../../status/lib/alerts.js';
import { operationsPage } from '../../status/lib/operations-page.js';
import { privateSnapshot } from '../../status/lib/model.js';
import { updateCapacity } from '../../status/lib/capacity.js';

const env={ALERT_RESEND_KEY:'private-key',ALERT_FROM:'workshop@example.com',ALERT_TO:'owner@example.com',CAPACITY_DIGEST_ENABLED:'1'};
const metric={id:'blob-transfer',label:'Blob transfer',service:'Vercel Blob',scope:'account',unit:'bytes',used:75,limit:100,remaining:25,percent:75,observedAt:Date.parse('2026-11-25T14:00:00Z'),periodEnd:Date.parse('2026-12-01T00:00:00Z'),source:'provider',status:'warning'};
const view={blockers:[],components:[{id:'api',name:'Request API',status:'operational'}],capacity:{metrics:[metric]}};
test('rolling observations identify their window in private pages and emails without inventing a reset',async()=>{
for(const [windowKind,label] of [['rolling-30-days','Rolling 30 days'],['rolling-24-hours','Rolling 24 hours']]) {
const rolling={...view,generatedAt:metric.observedAt,capacity:{metrics:[{...metric,windowKind,periodEnd:null}]}};
assert.match(capacityEmailSummary(rolling),new RegExp(label));
const html=await operationsPage(rolling).text();
assert.match(html,new RegExp(label));
assert.match(html,/Reset \/ window end: Not measured/);
}
});
const run=async(state,now,options={})=>{
  const sent=[];let saved;
  const next=await deliverStatusAlert({state,view,env,now:Date.parse(now),persist:async value=>{saved=structuredClone(value);},fetchImpl:async(url,request)=>{
    assert.equal(url,'https://api.resend.com/emails');assert.ok(saved.alerts.pending);
    sent.push({body:JSON.parse(request.body),key:request.headers['Idempotency-Key']});return new Response('{}');
  },...options});
  return {next,sent};
};
test('daily digest starts at 08 Chicago and sends once per local date across restarts',async()=>{
  let {next,sent}=await run({},'2026-11-25T13:59:00Z');assert.equal(sent.length,0);
  ({next,sent}=await run(next,'2026-11-25T14:00:00Z'));assert.equal(sent.length,1);assert.match(sent[0].body.subject,/daily/i);
  assert.match(sent[0].body.text,/Blob transfer/);assert.match(sent[0].body.text,/remaining/i);assert.match(sent[0].body.text,/2026-12-01/);
  assert.deepEqual(sent[0].body.to,['owner@example.com']);assert.equal(next.alerts.lastDigestDay,'2026-11-25');
  ({next,sent}=await run(structuredClone(next),'2026-11-26T01:00:00Z'));assert.equal(sent.length,0);
  ({next,sent}=await run(next,'2026-11-26T14:00:00Z'));assert.equal(sent.length,1);
});
test('Chicago DST uses local calendar and late collection does not replay old digest dates',async()=>{
  let r=await run({},'2026-03-08T12:59:00Z');assert.equal(r.sent.length,0);
  r=await run(r.next,'2026-03-08T13:00:00Z');assert.equal(r.sent.length,1);
  r=await run(r.next,'2026-03-11T20:00:00Z');assert.equal(r.sent.length,1);assert.equal(r.next.alerts.lastDigestDay,'2026-03-11');
  r=await run({},'2026-11-01T13:59:00Z');assert.equal(r.sent.length,0);
  r=await run(r.next,'2026-11-01T14:00:00Z');assert.equal(r.sent.length,1);
});
test('pending digest retry retains its exact payload/key through changing readings and incidents',async()=>{
  let pending,key;
  const r=await run({},'2026-11-25T14:00:00Z',{persist:async s=>{pending=structuredClone(s);},fetchImpl:async(_u,q)=>{key=q.headers['Idempotency-Key'];throw Error('unknown send outcome');}});
  assert.ok(r.next.alerts.pending);const original=structuredClone(r.next.alerts.pending);
  const retry=await run(r.next,'2026-11-25T14:15:00Z',{env:{...env,ALERT_FROM:'changed@example.com',ALERT_TO:'changed-owner@example.com'},view:{...view,blockers:[{id:'outage',title:'Outage',next:'Check API.'}],capacity:{metrics:[]}}});
  assert.equal(retry.sent.length,1);assert.equal(retry.sent[0].key,key);assert.equal(retry.sent[0].body.text,original.text);
  assert.equal(retry.sent[0].body.from,env.ALERT_FROM);assert.deepEqual(retry.sent[0].body.to,[env.ALERT_TO]);
  assert.equal(retry.next.alerts.lastDigestDay,'2026-11-25');assert.ok(!JSON.stringify(pending).includes('private-key'));
});
test('legacy pending events without their original envelope fail closed instead of guessing current recipients',async()=>{
  const pending={id:'legacy',createdAt:Date.parse('2026-11-25T13:55:00Z'),subject:'Legacy',text:'Unknown original envelope',fingerprint:'legacy'};
  const r=await run({alerts:{pending}},'2026-11-25T14:00:00Z');
  assert.equal(r.sent.length,0);assert.equal(r.next.alerts.envelopeMissing,true);assert.equal(r.next.alerts.pending.id,'legacy');assert.equal(r.next.alerts.digestStatus,'blocked');
});
test('incident priority and delivery caps defer digest visibly without dropping it',async()=>{
  const outage={...view,blockers:[{id:'outage',title:'Outage',next:'Check API.',severity:'critical'}]};
  let r=await run({},'2026-11-25T14:00:00Z',{view:outage});assert.match(r.sent[0].body.subject,/attention/);assert.notEqual(r.next.alerts.lastDigestDay,'2026-11-25');
  r=await run(r.next,'2026-11-25T14:05:00Z',{view:outage});assert.equal(r.sent.length,0);assert.equal(r.next.alerts.digestStatus,'delayed');
  r=await run(r.next,'2026-11-25T14:15:00Z',{view:outage});assert.match(r.sent[0].body.subject,/daily/);
  r=await run({alerts:{day:'2026-11-25',attemptsToday:8}},'2026-11-25T14:00:00Z');assert.equal(r.sent.length,0);assert.equal(r.next.alerts.digestStatus,'delayed');
});
test('ambiguous expired digest remains visible and cannot become a new message',async()=>{
  const pending={id:'fixed',kind:'digest',day:'2026-11-24',createdAt:Date.parse('2026-11-24T14:00:00Z'),subject:'Original',text:'Original',fingerprint:'digest:2026-11-24'};
  const r=await run({alerts:{pending}},'2026-11-25T14:00:00Z');assert.equal(r.sent.length,0);assert.equal(r.next.alerts.ambiguousExpired,true);assert.equal(r.next.alerts.pending.id,'fixed');assert.equal(r.next.alerts.digestStatus,'blocked');
});
test('capacity alerts deduplicate numeric changes, escalate, and never treat stale readings as recovery',async()=>{
  let state={},capacity={},sent=[];
  const at=Date.parse('2026-11-25T14:00:00Z');
  async function poll(offset,used,{fresh=true}={}) {
    const now=at+offset;
    if(fresh)capacity=updateCapacity(capacity,[{id:'blob-transfer',limit:100,observedAt:now,used,periodStart:null,periodEnd:at+86400000,source:'provider',scope:'account'}],now);
    const v=privateSnapshot({capacity},now);v.blockers=v.blockers.filter(x=>x.id.startsWith('capacity-'));
    state=await deliverStatusAlert({state,view:v,env:{...env,CAPACITY_DIGEST_ENABLED:'0'},now,persist:async()=>{},fetchImpl:async(_u,q)=>{sent.push(JSON.parse(q.body));return new Response('{}');}});
  }
  await poll(0,75);assert.equal(sent.length,1);assert.match(sent[0].text,/warning/);
  await poll(20*60000,78);assert.equal(sent.length,1);
  await poll(40*60000,95);assert.equal(sent.length,2);assert.match(sent[1].text,/critical/);
  await poll(4*3600000,95,{fresh:false});assert.equal(sent.length,3);assert.doesNotMatch(sent[2].subject,/recovered/);assert.match(sent[2].text,/stale/);
  await poll(4*3600000+20*60000,50);assert.doesNotMatch(sent.at(-1).subject,/recovered/);
  await poll(4*3600000+40*60000,50);assert.match(sent.at(-1).subject,/recovered/);
});
