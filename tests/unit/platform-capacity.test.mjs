import test from 'node:test';
import assert from 'node:assert/strict';
import { collectLocalCapacity } from '../../lib/platform/capacity.js';
const now=1800000000000;
test('reads only runtime aggregates and exact global current buckets',async()=>{
 const calls=[];const query=async(strings,...values)=>{const sql=strings.join('?');calls.push({sql,values});if(sql.includes('pg_database_size'))return [{used:'1234'}];if(sql.includes('pg_stat_activity'))return [{used:3,limit:'100'}];return [{scope:'session-create',used:4},{scope:'upload-token',used:5}];};
 const result=await collectLocalCapacity({query,env:{},now});
 assert.equal(result.find(x=>x.id==='db-size').used,1234);
 assert.equal(result.find(x=>x.id==='db-connections').limit,100);
 assert.equal(result.find(x=>x.id==='rate-sessions-global').used,4);
 assert.equal(result.find(x=>x.id==='rate-sessions-client').used,null);
 assert.equal(result.find(x=>x.id==='rate-uploads-client').limit,30);
 assert.equal(calls.length,3);const bucket=calls[2];assert.match(bucket.sql,/subject\s*=\s*\?/);assert.match(bucket.sql,/window_start\s*=\s*\?/);assert.match(bucket.sql,/SUM\(hits\)/);assert.ok(bucket.values.includes('global'));assert.ok(!/SELECT\s+\*/i.test(bucket.sql));assert.equal(JSON.stringify(result).includes('subject'),false);
});
test('optional failures remain unknown and configured limits survive',async()=>{const result=await collectLocalCapacity({query:async()=>{throw Error('secret');},env:{PRINT_ESTIMATE_SESSIONS_GLOBAL:'17'},now});assert.equal(result.length,6);assert.ok(result.every(x=>x.used===null));assert.equal(result.find(x=>x.id==='rate-sessions-global').limit,17);assert.ok(!JSON.stringify(result).includes('secret'));});
test('malformed database numeric values never enter metrics',async()=>{const result=await collectLocalCapacity({query:async()=>[{used:'Infinity',limit:-2}],env:{},now});assert.ok(result.filter(x=>x.id.startsWith('db-')).every(x=>x.used===null));assert.equal(result.find(x=>x.id==='db-connections').limit,null);});

