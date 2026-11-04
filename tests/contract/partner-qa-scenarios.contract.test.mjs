import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPartnerQaRuntime} from '../../lib/partner-outreach/qa-runtime.js';
import {partnerFixture,TEST_NOW} from '../support/partner-fixture.mjs';
test('QA provisioning is synthetic, retry safe, review-distinct and reset preserves history',async()=>{
 const f=await partnerFixture({reviewed:false}),actor={role:'OWNER',id:'real-owner',ownerSessionHash:'a'.repeat(64)};
 const ownerAuthDatabase={withTransaction:fn=>fn({query:async()=>[{operator_id:actor.id}]})};
 try{
 const rt=createPartnerQaRuntime({qaDatabase:f.database,ownerAuthDatabase,env:{OPERATOR_OWNER_SUBJECT:'2610199',PARTNER_PROGRAM_ENABLED:'1',PARTNER_CLASSIFICATION_APPROVED:'1',PARTNER_ACCOUNTING_APPROVED:'1'},now:()=>new Date(TEST_NOW)});
 const input={scenarioKey:'complete-journey'},key=randomUUID(),run=(action,input,key=randomUUID())=>rt.app.execute({actor,action,input,key});
 const a=await run('qa.provision',input,key),b=await run('qa.provision',input,key);assert.deepEqual(a,b);assert.ok(a.programId);assert.equal(a.simulated,true);
 const [program]=await f.database.query`SELECT * FROM partner_programs WHERE id=${a.programId}`;assert.equal(program.synthetic,true);assert.equal(program.settings.qaScenarioKey,'complete-journey');
 const [v]=await f.database.query`SELECT * FROM partner_legal_versions WHERE id=${a.versionId}`;assert.match(v.markdown,/QA SAMPLE — NO LEGAL EFFECT/);assert.equal(v.issuable,true);
 const rows=await f.database.query`SELECT reviewer_name,evidence_ref FROM partner_legal_reviews`;assert.ok(rows.every(x=>x.reviewer_name.includes('SIMULATED')&&x.evidence_ref.includes('QA-SIMULATION')));
 await assert.rejects(run('qa.provision',{scenarioKey:'anything-else'}),{status:400});
 await assert.rejects(run('qa.reset',{programId:f.programId}),{status:404});
 const reset=await run('qa.reset',{programId:a.programId});assert.equal(reset.historyPreserved,true);
 const [after]=await f.database.query`SELECT * FROM partner_programs WHERE id=${a.programId}`;assert.equal(after.enabled,false);
 const [live]=await f.database.query`SELECT * FROM partner_programs WHERE id=${f.programId}`;assert.equal(live.enabled,true);
 }finally{await f.close();}
});
