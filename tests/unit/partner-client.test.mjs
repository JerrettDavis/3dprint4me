import test from 'node:test';
import assert from 'node:assert/strict';
import {createPartnerClient} from '../../partner/public/assets/client.js';

test('partner client keeps credentials/CSRF in memory and uses only scoped no-store endpoints',async()=>{
 const calls=[];const client=createPartnerClient({apiOrigin:'https://api.3dprint4.me',fetch:async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>url.endsWith('/session')?{csrfToken:'synthetic-csrf',partner:{id:'synthetic'}}:{id:'receipt'}};}});
 await client.session();await client.command('gig.accept',{gigId:'synthetic',expectedRevision:1},'synthetic-key');
 assert.equal(calls[1].url,'https://api.3dprint4.me/api/partner/v1/commands');
 assert.equal(calls[1].options.headers['X-CSRF-Token'],'synthetic-csrf');assert.equal(calls[1].options.credentials,'include');assert.equal(calls[1].options.cache,'no-store');
 assert.deepEqual(JSON.parse(calls[1].options.body),{action:'gig.accept',input:{gigId:'synthetic',expectedRevision:1},key:'synthetic-key'});
 await assert.rejects(client.read('../operator-partners'),/resource/);
});

test('partner client clears expired state, redacts server failures and rejects unsafe origins',async()=>{
 assert.throws(()=>createPartnerClient({apiOrigin:'https://evil.example'}),/origin/);
 let status=200;const client=createPartnerClient({apiOrigin:'http://127.0.0.1:4173',fetch:async()=>({ok:status===200,status,json:async()=>status===200?{csrfToken:'synthetic',partner:{id:'synthetic'}}:{error:'private database credential'}})});
 await client.session();status=503;await assert.rejects(client.read('gigs'),e=>e.status===503&&!e.message.includes('credential'));
 status=401;await assert.rejects(client.read('gigs'),e=>e.status===401);assert.equal(client.signedIn,false);
 await assert.rejects(client.command('gig.accept',{},'key'),e=>e.status===401);
});


test('logout serializes behind in-flight authentication and superseded responses cannot restore sign-in',async()=>{
 let resolveLogin;const calls=[];
 const client=createPartnerClient({fetch:async(url,options)=>{calls.push({url,options});if(url.endsWith('/login'))return new Promise(resolve=>{resolveLogin=()=>resolve({ok:true,status:200,json:async()=>({csrfToken:'stale-csrf',partner:{id:'old'}})});});return {ok:true,status:200,json:async()=>({ok:true})};}});
 const login=client.login('synthetic','synthetic passphrase');
 await new Promise(resolve=>setTimeout(resolve,0));
 const closing=client.logout();assert.equal(client.signedIn,false);
 resolveLogin();await assert.rejects(login,{status:409});await closing;
 assert.equal(client.signedIn,false);assert.ok(calls[1].url.endsWith('/logout'));
 assert.equal(calls[1].options.headers['X-CSRF-Token'],'stale-csrf');
 await assert.rejects(client.command('gig.accept',{},'key'),{status:401});
});
