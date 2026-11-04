import test from 'node:test';
import assert from 'node:assert/strict';
import {createPartnerClient} from '../../partner/public/assets/client.js';
import {createPartnerOwnerClient} from '../../operator/assets/partner-owner-client.js';
test('QA clients keep every authentication and business request in fixed QA namespaces',async()=>{
 const calls=[],fetch=async(url,options)=>{calls.push(url);return {ok:true,status:200,json:async()=>({partner:{id:'synthetic'},owner:{id:'real-owner'},csrfToken:'synthetic-csrf',items:[]})};};
 const partner=createPartnerClient({realm:'qa',fetch});await partner.session();await partner.read('gigs');await partner.command('gig.accept',{},'key');await partner.logout();assert.ok(calls.every(x=>x.includes('/api/partner-qa/v1/')));
 calls.length=0;const owner=createPartnerOwnerClient({realm:'qa',apiBase:'https://api.3dprint4.me',fetchImpl:fetch});await owner.session();await owner.read('programs');await owner.command('qa.provision',{scenarioKey:'complete-journey'},'key');assert.ok(calls.every(x=>x.includes('/api/operator-partner-qa')));
 assert.throws(()=>createPartnerClient({realm:'arbitrary'}),/realm/);assert.throws(()=>createPartnerOwnerClient({apiBase:'https://api.3dprint4.me',realm:'arbitrary'}),/realm/);
});
