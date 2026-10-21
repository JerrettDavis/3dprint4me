import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLocalWorkRepository } from '../../lib/work-management/adapters/local-work-repository.js';
import { parseWorkQuery } from '../../lib/work-management/domain.js';
import { signRequestFile } from '../../lib/operator-files.js';

test('local inquiries share durable inbox, notes, follow-up and neutral Home Assistant projection',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'3dp-inquiry-work-'));
  try {
    const store=createLocalWorkRepository({path:join(dir,'work.json')});
    const inquiry={id:'INQ-example123',key_hash:'a'.repeat(64),inquiry:{replyEmail:'private@example.com',message:'My replacement part'},files:[],submitted_at:'2026-10-21T15:37:12.000Z'};
    const first=await store.completeInquiryWithWork(inquiry),replay=await store.completeInquiryWithWork(inquiry);
    assert.equal(first.workItem.id,replay.workItem.id);
    const reopened=createLocalWorkRepository({path:join(dir,'work.json')});
    const list=await reopened.listWork(parseWorkQuery({kind:'inquiry'}));
    assert.equal(list.items.length,1);assert.equal(list.items[0].kind,'inquiry');
    assert.equal((await reopened.listWork(parseWorkQuery({kind:'request'}))).items.length,0);
    const detail=await reopened.getWork(first.workItem.id);
    assert.equal(detail.request,null);assert.equal(detail.inquiry.replyEmail,'private@example.com');
    const note=await reopened.applyWorkCommand(first.workItem.id,{type:'add-note',body:'Follow up tomorrow',revision:1},{id:'op_local_owner'},'local-note123');
    const closed=await reopened.applyWorkCommand(first.workItem.id,{type:'set-status',status:'completed',revision:note.item.revision},{id:'op_local_owner'},'local-close123');
    assert.equal(closed.item.status,'completed');
    const snapshot=await reopened.snapshot();
    assert.equal(snapshot.events.filter(x=>x.type==='work.created').length,1);assert.equal(snapshot.outbox.length,1);
    assert.equal((await reopened.getWork(first.workItem.id)).notes.length,1);
    assert.equal((await reopened.getHomeAssistantSnapshot()).counts.active,0);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('private inquiry attachments require exact source ownership, including after conversion',async()=>{
  const file={name:'part.stl',path:'inquiries/INQ-example123/0-file.stl'};
  const work={item:{id:'work_example123',kind:'inquiry',inquiryId:'INQ-example123',requestId:null},files:[file]};
  const signed=[];const sign=async(path,ttl)=>{signed.push({path,ttl});return 'https://private.example/download';};
  assert.equal((await signRequestFile({work,index:0,sign})).filename,'part.stl');
  await signRequestFile({work:{...work,item:{...work.item,kind:'request',requestId:'3DP-20261021-EXAMPLE123'}},index:0,sign});
  assert.equal(signed.length,2);assert.equal(signed[0].ttl,60);
  for(const item of [{...work.item,inquiryId:'INQ-other123'}, {kind:'request',requestId:'3DP-20261021-EXAMPLE123'}])
    await assert.rejects(signRequestFile({work:{...work,item},index:0,sign}),{status:404});
  await assert.rejects(signRequestFile({work:{...work,files:[{...file,path:'inquiries/INQ-example123/../other.stl'}]},index:0,sign}),{status:404});
});

test('local inquiry intake persists the draft, checks its capability and completes inbox work atomically',async()=>{
  const {createLocalInquiryStore}=await import('../../lib/inquiry-workflow/local-inquiry-store.js');
  const dir=await mkdtemp(join(tmpdir(),'3dp-inquiry-intake-'));
  try {
    const work=createLocalWorkRepository({path:join(dir,'work.json')}),store=createLocalInquiryStore({work});
    const row=await store.create({id:'INQ-local123',key_hash:'a'.repeat(64),payload_hash:'b'.repeat(64),inquiry:{message:'Local question',replyEmail:'test@example.com'},files:[]});
    assert.equal(row.status,'draft');assert.equal((await work.listWork(parseWorkQuery())).items.length,0);
    await assert.rejects(store.complete({...row,key_hash:'c'.repeat(64)}),{status:404});
    await store.complete(row);await store.ensureSubmittedWork(row);
    assert.equal((await store.find(row.key_hash)).status,'submitted');
    assert.equal((await work.listWork(parseWorkQuery())).items.length,1);
    assert.equal((await work.snapshot()).outbox.length,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});
