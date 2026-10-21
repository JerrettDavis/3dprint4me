import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLocalWorkRepository } from '../../lib/work-management/adapters/local-work-repository.js';
import { createLocalInquiryStore } from '../../lib/inquiry-workflow/local-inquiry-store.js';
import { createInquiryWorkflowService } from '../../lib/inquiry-workflow/service.js';

const operator={id:'op_local_owner',role:'owner',enabled:true},key='a'.repeat(64);
const request=()=>({service:'design',projectTitle:'Replacement part',description:'A fitted part',
  contact:{name:'Customer',email:'test@example.com'},consent:true,files:[]});
async function fixture() {
  const {createLocalInquiryWorkflowRepository}=await import('../../lib/inquiry-workflow/local-repository.js');
  const dir=await mkdtemp(join(tmpdir(),'3dp-inquiry-flow-'));
  const work=createLocalWorkRepository({path:join(dir,'work.json')}),intake=createLocalInquiryStore({work});
  const row=await intake.create({id:'INQ-example123',key_hash:createHash('sha256').update(key).digest('hex'),payload_hash:'b'.repeat(64),
    inquiry:{replyEmail:'test@example.com',message:'Please help with a part'},files:[]});
  await intake.complete(row);
  const item=(await work.listWork({view:'active',limit:30})).items[0];
  let now=new Date(),serial=0;
  const service=createInquiryWorkflowService({repository:createLocalInquiryWorkflowRepository({work}),now:()=>now,
    newRequestId:()=>`3DP-20261021-${String(++serial).padStart(20,'0')}`});
  return {work,item,service,setNow:value=>{now=value;},close:()=>rm(dir,{recursive:true,force:true})};
}

test('local handoff and operator conversion retain a single project and private notes through completion',async()=>{
  const f=await fixture();
  try {
    await f.work.applyWorkCommand(f.item.id,{type:'add-note',body:'Private follow-up',revision:1},operator,'note12345678');
    const invite=await f.service.issueForCustomer({id:'INQ-example123',submissionKey:key});
    const [draft,converted]=await Promise.all([
      f.service.createDraft({token:invite.token,request:request()}),
      f.service.prepareProject({workId:f.item.id,revision:2,service:'design',title:'Prepared draft',operator,idempotencyKey:'convert12345678'})
    ]);
    assert.equal(draft.id,converted.requestId);
    await f.service.completeDraft({token:invite.token,id:draft.id,request:request(),uploadedFiles:[]});
    assert.equal((await f.service.completeDraft({token:invite.token,id:draft.id,request:request()})).replayed,true);
    const detail=await f.work.getWork(f.item.id),state=await f.work.snapshot();
    assert.equal(detail.item.kind,'request');assert.equal(detail.item.projectDraft,false);assert.equal(detail.notes.length,1);
    assert.equal(state.requests.length,1);assert.equal(state.workItems.length,1);assert.equal(state.outbox.length,2);
    assert.ok(!JSON.stringify(state).includes(invite.token));
    assert.deepEqual(await f.service.read({token:invite.token}),{completed:true,id:draft.id});
  }finally{await f.close();}
});

test('local incomplete conversion and invitation replacement never fabricate consent or bypass scope',async()=>{
  const f=await fixture();
  try {
    const prepared=await f.service.prepareProject({workId:f.item.id,revision:1,service:'repair',title:'Printer diagnosis',operator,idempotencyKey:'convert12345678'});
    const detail=await f.work.getWork(f.item.id);
    assert.equal(detail.request.consent,false);assert.equal(detail.request.estimate,null);
    const first=await f.service.issueForOperator({workId:f.item.id,operator});
    await assert.rejects(f.service.assertRequestScope({id:prepared.requestId}),{status:403});
    const second=await f.service.issueForOperator({workId:f.item.id,operator});
    await assert.rejects(f.service.read({token:first.token}),{status:410});
    await f.service.assertRequestScope({id:prepared.requestId,token:second.token});
    f.setNow(new Date(Date.now()+8*86400000));
    await assert.rejects(f.service.assertRequestScope({id:prepared.requestId,token:second.token}),{status:410});
  }finally{await f.close();}
});
