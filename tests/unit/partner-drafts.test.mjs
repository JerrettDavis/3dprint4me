import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createVisitDraftStore,clearVisitDrafts} from '../../partner/public/assets/drafts.js';
const storage=()=>{const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k),key:n=>[...values.keys()][n]??null,get length(){return values.size;},values};};
const visit=()=>({gigId:randomUUID(),expectedGigRevision:2,businessName:'Synthetic business',approximateArea:'Tulsa',outcome:'unavailable',placement:'none',sampleCount:0,visitedAt:'2026-10-24T12:00:00Z'});

test('device visit drafts explicitly exclude contact/consent and isolate accounts',()=>{
 const disk=storage(),accountId=randomUUID(),drafts=createVisitDraftStore({storage:disk,accountId});
 const saved=drafts.save(visit());assert.equal(drafts.list().length,1);assert.equal(drafts.list()[0].id,saved.id);
 assert.throws(()=>drafts.save({...visit(),contact:{email:'private@example.test'}}),/contact|field/);
 assert.throws(()=>drafts.save({...visit(),consent:true}),/contact|field/);
 assert.equal(createVisitDraftStore({storage:disk,accountId:randomUUID()}).list().length,0);
 assert.ok(!JSON.stringify([...disk.values]).includes('private@example.test'));
 drafts.clear();assert.equal(drafts.list().length,0);
});

test('100 visit drafts survive restart and replay an ambiguous committed request without duplicating it',async()=>{
 const disk=storage(),accountId=randomUUID();let drafts=createVisitDraftStore({storage:disk,accountId});
 for(let n=0;n<100;n++)drafts.save({...visit(),businessName:'Synthetic business '+n});
 assert.throws(()=>drafts.save(visit()),/limit/);
 drafts=createVisitDraftStore({storage:disk,accountId});
 const receipts=new Map(),attempts=[];let lost=true;
 const send=async(action,input,key)=>{assert.equal(action,'visit.record');assert.equal(input.consent,false);assert.ok(!Object.hasOwn(input,'contact'));attempts.push(key);receipts.set(key,{id:input.clientId});if(receipts.size===51&&lost){lost=false;throw Object.assign(new Error('lost response'),{status:0});}return receipts.get(key);};
 const first=await drafts.sync(send);assert.equal(first.remaining,50);assert.equal(receipts.size,51);
 drafts=createVisitDraftStore({storage:disk,accountId});
 const second=await drafts.sync(send);assert.equal(second.remaining,0);assert.equal(receipts.size,100);assert.equal(attempts.length,101);assert.equal(attempts[50],attempts[51]);
});

test('conflicts retain device records for review; storage failure never claims a saved draft',async()=>{
 const disk=storage(),drafts=createVisitDraftStore({storage:disk,accountId:randomUUID()});
 const entry=drafts.save(visit());await drafts.sync(async()=>{throw Object.assign(new Error('changed'),{status:409});});
 assert.equal(drafts.list()[0].state,'needs_review');assert.equal(drafts.list()[0].id,entry.id);
 let called=false;await drafts.sync(async()=>{called=true;});assert.equal(called,false);
 drafts.remove(entry.id);assert.equal(drafts.list().length,0);
 const broken=createVisitDraftStore({storage:{getItem:()=>null,setItem:()=>{throw Error('blocked');}},accountId:randomUUID()});
 assert.throws(()=>broken.save(visit()),/not saved/);
});


test('explicit minimal offline preparation survives restart, is account-scoped and clears on sign-out',()=>{
 const disk=storage(),accountId=randomUUID(),store=createVisitDraftStore({storage:disk,accountId}),gig={gigId:randomUUID(),expectedGigRevision:2};
 assert.deepEqual(store.prepared(),[]);store.prepare(gig);
 assert.deepEqual(createVisitDraftStore({storage:disk,accountId}).prepared(),[gig]);
 assert.deepEqual(createVisitDraftStore({storage:disk,accountId:randomUUID()}).prepared(),[]);
 assert.throws(()=>store.prepare({...gig,title:'Private title'}),/field|preparation/);
 assert.throws(()=>store.prepare({...gig,expectedGigRevision:0}),/revision|preparation/);
 assert.equal(store.list().length,0);
 clearVisitDrafts(disk);assert.deepEqual(store.prepared(),[]);
});
