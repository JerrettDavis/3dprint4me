import test from 'node:test';
import assert from 'node:assert/strict';
import {createSelectedQaBinding} from '../../lib/partner-outreach/qa-config.js';
test('QA selection binding fails closed on generation, database or cluster change',async()=>{
 let current={databaseName:'live',generation:'generation-a'},identity={database_name:'live',cluster_identifier:'cluster-a'};
 const selected={query:async()=>[identity]};
 const binding=await createSelectedQaBinding({ownerIdentity:{database_name:'live',cluster_identifier:'cluster-a'},getSelectedDatabase:()=>selected,getSelection:async()=>current});
 await binding.assertCurrent();
 current={...current,generation:'generation-b'};await assert.rejects(binding.assertCurrent(),/selection|identity/i);
 current={databaseName:'live',generation:'generation-a'};identity={database_name:'live',cluster_identifier:'cluster-b'};await assert.rejects(binding.assertCurrent(),/selection|identity/i);
 identity={database_name:'other',cluster_identifier:'cluster-a'};await assert.rejects(binding.assertCurrent(),/selection|identity/i);
});
