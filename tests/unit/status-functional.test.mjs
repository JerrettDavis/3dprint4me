import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {publicSnapshot,validateHeartbeat,privateSnapshot} from '../../status/lib/model.js';
import {operationsPage} from '../../status/lib/operations-page.js';
import { validateFunctional, functionalStatus, verifyDeliveryEvent, updateDeliveryEvents } from '../../status/lib/functional.js';
const now=1795670000000;
const id='56761188-7520-42d8-8898-ff6fc54ce618';
const reading=()=>({provider:'postgres',checkedAt:now,filesOk:true,estimatesOk:true,filesVerifiedAt:now,estimatesVerifiedAt:now,
 stage:'complete',nextCheckAt:now+21600000,failureCode:'none',cleanupPending:false,receiptId:id,receiptSentAt:now-1000,
 emailStage:'accepted',emailNextAt:now+86400000,lastRepairAt:null,repairService:'none',repairOutcome:'none',repairAttempts:0});
test('functional readings reject secrets, impossible times and invalid status fields',()=>{
 assert.deepEqual(validateFunctional(reading(),now),reading());
 for(const invalid of [{...reading(),token:'secret'},{...reading(),filesVerifiedAt:now+31000},{...reading(),repairAttempts:100},{...reading(),provider:'other'}])assert.throws(()=>validateFunctional(invalid,now));
});
test('functional success is scoped, expires and cannot cross provider or failed stage',()=>{
 const state={platform:{observedAt:now,details:{functional:reading()}},deliveryEvents:[{emailId:id,type:'email.delivered',at:now}]};
 assert.equal(functionalStatus(state,now,'postgres').files.verifiedAt,now);
 assert.equal(functionalStatus(state,now,'postgres').email.verifiedAt,now);
 assert.equal(functionalStatus(state,now,'neon').files,null);
 assert.equal(functionalStatus(state,now+86400001,'postgres').files,null);
 state.platform.details.functional.filesOk=false;assert.equal(functionalStatus(state,now,'postgres').files,null);
 state.deliveryEvents.push({emailId:id,type:'email.bounced',at:now});assert.equal(functionalStatus(state,now,'postgres').email,null);
});
function signed(type='email.delivered',at=now){
 const secret='whsec_'+Buffer.from('01234567890123456789012345678901').toString('base64');
 const body=JSON.stringify({type,created_at:new Date(at).toISOString(),data:{email_id:id,subject:'private customer title',to:['private@example.com']}});
 const eventId='msg_status_test',timestamp=String(Math.floor(now/1000));
 const signature='v1,'+createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(eventId+'.'+timestamp+'.'+body).digest('base64');
 return {body,headers:new Headers({'svix-id':eventId,'svix-timestamp':timestamp,'svix-signature':signature}),secret,now};
}
test('signed delivery boundary checks exact bytes, freshness and safe projection',async()=>{
 const args=signed();const event=await verifyDeliveryEvent(args);
 assert.deepEqual(event,{eventId:'msg_status_test',emailId:id,type:'email.delivered',at:now});
 assert.ok(!JSON.stringify(event).includes('private'));
 await assert.rejects(verifyDeliveryEvent({...args,body:args.body+' '}));
 await assert.rejects(verifyDeliveryEvent({...args,now:now+301000}));
 await assert.rejects(verifyDeliveryEvent(signed('email.opened')));
 await assert.rejects(verifyDeliveryEvent(signed('email.delivered',now+31000)));
});
test('early delivery events correlate later, deduplicate without refreshing and remain bounded',()=>{
 const event={eventId:'msg_123456',emailId:id,type:'email.delivered',at:now-2000};
 const first=updateDeliveryEvents([],event,now);
 assert.deepEqual(updateDeliveryEvents(first,event,now+1000),first);
 const state={platform:{observedAt:now,details:{functional:{...reading(),receiptSentAt:now-3000}}},deliveryEvents:first};
 assert.equal(functionalStatus(state,now,'postgres').email.verifiedAt,now-2000);
 let records=[];for(let n=0;n<100;n++)records=updateDeliveryEvents(records,{...event,eventId:'msg_event_'+n,emailId:String(n)},now);
 assert.ok(records.length<=64);
 assert.deepEqual(updateDeliveryEvents(first,{...event,eventId:'msg_old',at:now-86400001},now),first);
});
test('signed recurring evidence replaces expired manual checks without leaking private correlation or repair state',async()=>{
 const secret='s'.repeat(64),functional=reading(),details={database:true,provider:'postgres',files:null,estimates:null,email:null,jobs:true,functional};
 const body=JSON.stringify({observedAt:now,nonce:'a'.repeat(32),details});
 const signature=createHmac('sha256',secret).update('/heartbeat/platform\n'+body).digest('hex');
 await validateHeartbeat({kind:'platform',secret,body,signature,now});
 const state={platform:{observedAt:now,details},probes:{api:{checkedAt:now,ok:true,provider:'postgres'}},deliveryEvents:[{emailId:id,type:'email.delivered',at:now}]};
 const publicView=publicSnapshot(state,now);
 for(const name of ['files','estimates','email'])assert.equal(publicView.components.find(c=>c.id===name).status,'operational');
 for(const value of ['receiptId',id,'repairAttempts','cleanupPending','private-key'])assert.ok(!JSON.stringify(publicView).includes(value));
 const html=await operationsPage(privateSnapshot(state,now)).text();assert.match(html,/Functional checks/);assert.match(html,/Next model check/);
 details.functional.filesOk=false;
 assert.equal(publicSnapshot(state,now).components.find(c=>c.id==='files').status,'unavailable');
 details.functional.filesOk=true;state.probes.api.provider='neon';
 assert.equal(publicSnapshot(state,now).components.find(c=>c.id==='files').status,'unknown');
});
