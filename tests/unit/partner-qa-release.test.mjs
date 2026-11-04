import test from 'node:test';
import assert from 'node:assert/strict';
import {provisionPartnerQa} from '../../scripts/provision-partner-qa.mjs';
import {runQaJobs} from '../../scripts/partner-qa-jobs.mjs';
test('provisioning refuses same-cluster or non-QA targets before all writes',async()=>{
 for(const [dbname,cluster] of [['live','other'],['3dprint4me_partner_qa','same']]){
 const queries=[],db=(name,id)=>({query:async sql=>{queries.push(sql);return {rows:[{db:name,cluster:id}]};}});
 await assert.rejects(provisionPartnerQa({qaAdmin:db(dbname,cluster),ownerAdmin:db('live','same'),apply:true}),/dedicated cluster/);assert.equal(queries.length,2);
 }
});
test('QA maintenance refuses the live database before generating or purging data',async()=>{
 let writes=0;await assert.rejects(runQaJobs({database:{query:async()=>[{name:'platform_live_real',realm:'qa'}],withTransaction:async()=>{writes++;}}}),/isolated/);assert.equal(writes,0);
});
