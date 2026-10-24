import test from 'node:test';
import assert from 'node:assert/strict';
import {createPartnerOwnerClient} from '../../operator/assets/partner-owner-client.js';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status});
test('owner client requires owner session and sends credentialed no-store CSRF-bound commands',async()=>{
 const calls=[];const client=createPartnerOwnerClient({apiBase:'http://127.0.0.1:9999',fetchImpl:async(url,options)=>{calls.push([url,options]);return json(url.includes('resource=session')?{owner:{id:'owner'},csrfToken:'private-memory'}:{id:'result'});}});
 await assert.rejects(client.command('program.configure',{},'key'),{status:401});
 await client.session();await client.command('program.configure',{enabled:false},'key');
 assert.equal(calls[1][0],'http://127.0.0.1:9999/api/operator-partners');assert.equal(calls[1][1].credentials,'include');assert.equal(calls[1][1].cache,'no-store');assert.equal(calls[1][1].redirect,'error');assert.equal(calls[1][1].headers['X-CSRF-Token'],'private-memory');
 assert.deepEqual(JSON.parse(calls[1][1].body),{action:'program.configure',input:{enabled:false},key:'key'});
});
test('owner client refuses arbitrary API origins and does not expose internal failures',async()=>{
 assert.throws(()=>createPartnerOwnerClient({apiBase:'https://attacker.example'}));
 const client=createPartnerOwnerClient({apiBase:'http://127.0.0.1:9999',fetchImpl:async()=>json({error:'secret database detail'},503)});
 await assert.rejects(client.session(),e=>e.status===503&&!e.message.includes('secret'));
});
test('owner logout invalidates immediately and late reads cannot restore owner state',async()=>{
 let resolve;const client=createPartnerOwnerClient({apiBase:'http://127.0.0.1:9999',fetchImpl:()=>new Promise(r=>{resolve=r;})});
 const pending=client.session();client.clear();resolve(json({owner:{id:'owner'},csrfToken:'late-secret'}));
 await assert.rejects(pending);assert.equal(client.signedIn,false);await assert.rejects(client.command('program.create',{},'key'),{status:401});
});

test('an unreadable forbidden response still clears owner state',async()=>{
 let calls=0;const client=createPartnerOwnerClient({apiBase:'http://127.0.0.1:9999',fetchImpl:async()=>++calls===1?json({owner:{id:'owner'},csrfToken:'private'}):new Response('denied',{status:403})});
 await client.session();await assert.rejects(client.read('programs'));assert.equal(client.signedIn,false);
});

test('logout during a delayed JSON body cannot restore an owner session',async()=>{
 let parse;const client=createPartnerOwnerClient({apiBase:'http://127.0.0.1:9999',fetchImpl:async()=>({ok:true,status:200,json:()=>new Promise(resolve=>{parse=resolve;})})});
 const pending=client.session();await new Promise(setImmediate);client.clear();parse({owner:{id:'old-owner'},csrfToken:'stale'});
 await assert.rejects(pending);assert.equal(client.signedIn,false);
});
