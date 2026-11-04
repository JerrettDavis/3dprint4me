import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPartnerQaRuntime,assertQaIsolation,assertQaSyntheticInput} from '../../lib/partner-outreach/qa-runtime.js';
import {createQaOwnerAuthorization} from '../../lib/partner-outreach/qa-owner-auth.js';
import {partnerFixture,TEST_NOW} from '../support/partner-fixture.mjs';
const env={OPERATOR_OWNER_SUBJECT:'2610199',PARTNER_REVIEW_SIGNING_PRIVATE_KEY:'qa-private-placeholder'};
const actor={role:'OWNER',id:'owner-real',ownerSessionHash:'a'.repeat(64)};
function authStore({denied=false}={}){
 const log=[];let locked=false;
 return {log,get locked(){return locked;},query:async()=>[],withTransaction:async run=>{log.push('auth.begin');locked=true;try{return await run({query:async(strings,...values)=>{assert.match(strings.join('?'),/partner_qa_authorize_owner/);if(denied)return [];assert.equal(values[0],actor.ownerSessionHash);return [{operator_id:actor.id}];}});}finally{locked=false;log.push('auth.end');}}};
}
test('QA owner guard accepts only the real locked session and releases on failure',async()=>{
 const db=authStore(),boundary=createQaOwnerAuthorization({ownerAuthDatabase:db,env});
 await assert.rejects(boundary.guard({},actor),{status:403});
 await assert.rejects(boundary.run({...actor,ownerSessionHash:undefined},()=>assert.fail()),{status:401});
 await boundary.run(actor,async()=>{assert.equal(db.locked,true);await boundary.guard({},actor);await assert.rejects(boundary.guard({},{...actor,id:'other'}),{status:403});});
 let releaseDetached;const detachedGate=new Promise(r=>releaseDetached=r);let detached;await boundary.run(actor,async()=>{detached=detachedGate.then(()=>boundary.guard({},actor));});releaseDetached();await assert.rejects(detached,{status:403});
 assert.equal(db.locked,false);
 await assert.rejects(boundary.run(actor,()=>{throw Error('failure');}),/failure/);assert.equal(db.locked,false);
 const revoked=createQaOwnerAuthorization({ownerAuthDatabase:authStore({denied:true}),env});await assert.rejects(revoked.run(actor,()=>assert.fail()),{status:403});
});
test('QA runtime keeps business writes in QA and canonical drafts blocked without synthetic owner bypass',async()=>{
 const f=await partnerFixture({reviewed:false}),ownerAuthDatabase=authStore();
 try{
 const rt=createPartnerQaRuntime({qaDatabase:f.database,ownerAuthDatabase,env,now:()=>new Date(TEST_NOW)});
 assert.equal(rt.realm,'qa');assert.equal(rt.ownerAuthDatabase,ownerAuthDatabase);
 const result=await rt.app.execute({actor,action:'program.create',input:{label:'QA synthetic',startsOn:'2026-10-01'},key:randomUUID()});assert.ok(result.id);
 const rows=await rt.app.read(actor,'programs');assert.ok(rows.items.some(x=>x.id===result.id));
 await assert.rejects(rt.app.execute({actor:{role:'OWNER',id:'synthetic-owner'},action:'program.create',input:{label:'bad',startsOn:'2026-10-01'},key:randomUUID()}),{status:401});
 const seed=await rt.app.execute({actor,action:'legal.seed_templates',input:{programId:result.id},key:randomUUID()});assert.equal(seed.created,15);
 const drafts=await f.database.query`SELECT issuable FROM partner_legal_versions`;assert.ok(drafts.every(x=>x.issuable===false));
 }finally{await f.close();}
});
test('QA preflight rejects overlap, missing sentinel, privileged role and real provider config',async()=>{
 const database=(name,realm='qa',privileged=false)=>({query:async strings=>strings.join('').includes('partner_qa_database_identity')?[{database_name:name,cluster_identifier:'qa-cluster'}]:strings.join('').includes('partner_qa_identity')?[{realm,cluster_identifier:'qa-cluster'}]:strings.join('').includes('partner_qa_auth_identity')?[{database_name:'live',cluster_identifier:'live-cluster'}]:strings.join('').includes('backend_member')?[{backend_member:false,business_read:false,auth_write:false}]:[{database_name:name,role_name:name==='live'?'partner_qa_auth':'platform_app',privileged}]});
 await assert.rejects(assertQaIsolation({qaDatabase:database('live'),ownerAuthDatabase:database('live'),env:{}}),/isolation/i);
 await assert.rejects(assertQaIsolation({qaDatabase:database('qa','live'),ownerAuthDatabase:database('live'),env:{}}),/isolation/i);
 await assert.rejects(assertQaIsolation({qaDatabase:database('qa','qa',true),ownerAuthDatabase:database('live'),env:{}}),/isolation/i);
 await assert.rejects(assertQaIsolation({qaDatabase:database('qa'),ownerAuthDatabase:database('live'),env:{STRIPE_SECRET_KEY:'not-a-real-secret'}}),/provider/i);
 await assertQaIsolation({qaDatabase:database('qa'),ownerAuthDatabase:database('live'),env:{}});
});

test('QA rejects real contact channels and unmarked settlement or professional evidence',()=>{
 for(const [action,input] of [['visit.record',{contact:{email:'person@real.example'}}],['lead.correct',{contact:{phone:'+12125551234'}}],['payment.record',{paymentReference:'ACTUAL-BANK-123'}],['legal.record_review',{reviewerName:'Actual attorney'}]])assert.throws(()=>assertQaSyntheticInput(action,input),/synthetic|SIMULATED/);
 assertQaSyntheticInput('visit.record',{contact:{email:'fictional@example.invalid',phone:'+12025550100'}});
 assertQaSyntheticInput('payment.record',{paymentReference:'QA-SIMULATED-001'});
});
test('runtime isolation rejects a QA database on the live PostgreSQL cluster',async()=>{
 const auth={query:async strings=>strings.join('').includes('backend_member')?[{backend_member:false,business_read:false,auth_write:false}]:strings.join('').includes('partner_qa_auth_identity')?[{database_name:'live',cluster_identifier:'same-cluster'}]:[{database_name:'live',role_name:'partner_qa_auth',privileged:false}]};
 const qa={query:async strings=>strings.join('').includes('partner_qa_database_identity')?[{database_name:'qa',cluster_identifier:'same-cluster'}]:strings.join('').includes('partner_qa_identity')?[{realm:'qa',cluster_identifier:'same-cluster'}]:[{database_name:'qa',role_name:'platform_app',privileged:false}]};
 await assert.rejects(assertQaIsolation({qaDatabase:qa,ownerAuthDatabase:auth,env:{}}),/cluster|isolation/i);
});
