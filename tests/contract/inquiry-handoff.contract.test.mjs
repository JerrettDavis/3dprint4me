import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inquiryDatabase,inquiryMigration,seedInquiry } from '../support/inquiry-database.mjs';
import { createNativeDatabase } from '../../lib/database.js';
import { createInquiryStore } from '../../lib/inquiry-store.js';
import { createNeonWorkRepository } from '../../lib/work-management/adapters/neon-work-repository.js';
import { createInquiryWorkflowRepository } from '../../lib/inquiry-workflow/repository.js';
import { createInquiryWorkflowService } from '../../lib/inquiry-workflow/service.js';

const customerKey='a'.repeat(64),operator={id:'op_example123',role:'owner',enabled:true};
const fullRequest=()=>({projectTitle:'Detailed project',service:'design',description:'A fitted replacement part',
  contact:{name:'Customer',email:'customer@example.com'},consent:true,files:[],estimate:{low:10,high:30}});

async function fixture({files=[]}={}) {
  const db=await inquiryDatabase();await db.exec(await inquiryMigration());
  await seedInquiry(db,'INQ-example123');
  await db.query('UPDATE quick_inquiries SET key_hash=$1,files=$2::jsonb WHERE id=$3',
    [createHash('sha256').update(customerKey).digest('hex'),JSON.stringify(files),'INQ-example123']);
  await db.exec("INSERT INTO operators(id,auth_user_id,display_name,role) VALUES('op_example123','owner','Owner','owner')");
  let pending=Promise.resolve();
  const acquire=async()=>{let release;const previous=pending;pending=new Promise(resolve=>{release=resolve;});await previous;return release;};
  const pool={query:async(text,values)=>{const release=await acquire();try{return await db.query(text,values);}finally{release();}},
    connect:async()=>{const release=await acquire();return {query:(text,values)=>db.query(text,values),release};}};
  const database=createNativeDatabase({pool}),intake=createInquiryStore({query:database.query});
  await intake.ensureSubmittedWork((await db.query("SELECT * FROM quick_inquiries WHERE id='INQ-example123'")).rows[0]);
  const work=createNeonWorkRepository({query:database.query});
  const item=(await work.listWork({view:'active',service:null,priority:null,limit:30})).items[0];
  let now=new Date(),serial=0,verifier;const verified=[];
  const repository=createInquiryWorkflowRepository({database});
  const service=createInquiryWorkflowService({repository,now:()=>now,
    newRequestId:()=>`3DP-20261021-${String(++serial).padStart(20,'0')}`,
    verifyFiles:async value=>{verified.push(...value);await verifier?.();},sign:async()=> 'https://private.example/download'});
  return {db,work,item,service,repository,verified,setNow:value=>{now=value;},setVerifier:value=>{verifier=value;},close:()=>db.close()};
}

test('handoff authorizes the exact inquiry capability and stores only its scoped digest',async()=>{
  const f=await fixture();
  try {
    await assert.rejects(f.service.issueForCustomer({id:'INQ-example123',submissionKey:'b'.repeat(64)}),{status:404});
    const invite=await f.service.issueForCustomer({id:'INQ-example123',submissionKey:customerKey});
    assert.match(invite.token,/^[a-f0-9]{64}$/);assert.equal(new URL(invite.url).search,'');
    assert.equal(new URL(invite.url).hash,'#inquiry='+invite.token);
    const stored=(await f.db.query('SELECT * FROM inquiry_handoffs')).rows;
    assert.ok(!JSON.stringify(stored).includes(invite.token));assert.notEqual(stored[0].token_hash,invite.token);
    const prefill=await f.service.read({token:invite.token});
    assert.equal(prefill.inquiry.replyEmail,'inquiry@example.com');assert.equal(prefill.inquiry.name,'');
    assert.ok(!JSON.stringify(prefill).includes('key_hash'));assert.ok(!('notes' in prefill));
    assert.equal(new Date(invite.expiresAt)-new Date(stored[0].created_at),7*86400000);
    await assert.rejects(f.service.issueForOperator({workId:f.item.id,operator:{...operator,enabled:false}}),{status:403});
  }finally{await f.close();}
});

test('operator conversion preserves work/history and prepares an honest incomplete canonical project',async()=>{
  const f=await fixture();
  try {
    await f.work.applyWorkCommand(f.item.id,{type:'add-note',body:'Call the customer',revision:1},operator,'note12345678');
    const command={workId:f.item.id,revision:2,service:'design',title:'Replacement part',operator,idempotencyKey:'convert12345678'};
    const converted=await f.service.prepareProject(command),replay=await f.service.prepareProject(command);
    assert.equal(converted.workId,f.item.id);assert.equal(replay.requestId,converted.requestId);
    const detail=await f.work.getWork(f.item.id);
    assert.equal(detail.item.kind,'request');assert.equal(detail.item.projectDraft,true);assert.equal(detail.notes.length,1);
    assert.notEqual(detail.request.consent,true);assert.equal(detail.request.estimate,null);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM service_requests')).rows[0].n,1);
    assert.equal(detail.events.filter(x=>x.type==='work.converted').length,1);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM notification_outbox')).rows[0].n,1,'conversion sends nothing');
  }finally{await f.close();}
});

test('customer completion reuses the operator draft, retains work identity and consumes the invitation once',async()=>{
  const f=await fixture();
  try {
    const converted=await f.service.prepareProject({workId:f.item.id,revision:1,service:'design',title:'Prepared project',operator,idempotencyKey:'convert12345678'});
    const invite=await f.service.issueForOperator({workId:f.item.id,operator});
    const request=fullRequest(),created=await f.service.createDraft({token:invite.token,request});
    assert.equal(created.id,converted.requestId);
    const completed=await f.service.completeDraft({token:invite.token,id:created.id,request,uploadedFiles:[]});
    assert.equal(completed.workId,f.item.id);assert.equal(completed.replayed,false);
    const replay=await f.service.completeDraft({token:invite.token,id:created.id,request,uploadedFiles:[]});
    assert.equal(replay.replayed,true);
    assert.deepEqual(await f.service.read({token:invite.token}),{completed:true,id:created.id});
    const detail=await f.work.getWork(f.item.id);
    assert.equal(detail.item.projectDraft,false);assert.equal(detail.request.consent,true);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM service_requests')).rows[0].n,1);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM work_items')).rows[0].n,1);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM notification_outbox')).rows[0].n,2);
  }finally{await f.close();}
});

test('expiry and regeneration guard already-issued draft IDs, including omitted or foreign tokens',async()=>{
  const f=await fixture();
  try {
    const first=await f.service.issueForCustomer({id:'INQ-example123',submissionKey:customerKey});
    const draft=await f.service.createDraft({token:first.token,request:fullRequest()});
    await assert.rejects(f.service.assertRequestScope({id:draft.id}),{status:403});
    const second=await f.service.issueForOperator({workId:f.item.id,operator});
    await assert.rejects(f.service.read({token:first.token}),{status:410});
    await assert.rejects(f.service.assertRequestScope({id:draft.id,token:first.token}),{status:410});
    await f.service.assertRequestScope({id:draft.id,token:second.token});
    f.setNow(new Date(Date.now()+8*86400000));
    await assert.rejects(f.service.read({token:second.token}),{status:410});
    await assert.rejects(f.service.assertRequestScope({id:draft.id,token:second.token}),{status:410});
    assert.deepEqual(await f.service.assertRequestScope({id:'3DP-20261021-UNRELATED12345'}),{bound:false});
  }finally{await f.close();}
});

test('inherited files use stored ownership and remain outside the public path-validation bypass',async()=>{
  const file={name:'part.stl',size:123,type:'application/octet-stream',path:'inquiries/INQ-example123/0-part.stl'};
  const f=await fixture({files:[file]});
  try {
    const invite=await f.service.issueForCustomer({id:'INQ-example123',submissionKey:customerKey});
    const prefill=await f.service.read({token:invite.token});
    assert.equal(prefill.files.length,1);assert.ok(!JSON.stringify(prefill).includes(file.path));
    assert.equal((await f.service.download({token:invite.token,index:0})).filename,'part.stl');
    await assert.rejects(f.service.download({token:invite.token,index:1}),{status:404});
    const draft=await f.service.createDraft({token:invite.token,request:fullRequest()});
    await assert.rejects(f.service.completeDraft({token:invite.token,id:draft.id,request:fullRequest(),uploadedFiles:[file]}),{status:400});
    await f.service.completeDraft({token:invite.token,id:draft.id,request:fullRequest(),uploadedFiles:[]});
    assert.equal(f.verified[0].path,file.path);
    const detail=await f.work.getWork(f.item.id);assert.deepEqual(detail.files,[file]);
  }finally{await f.close();}
});

test('concurrent customer preparation and operator conversion choose one canonical project',async()=>{
  const f=await fixture();
  try {
    const invite=await f.service.issueForCustomer({id:'INQ-example123',submissionKey:customerKey});
    const [customer,owner]=await Promise.all([
      f.service.createDraft({token:invite.token,request:fullRequest()}),
      f.service.prepareProject({workId:f.item.id,revision:1,service:'design',title:'Operator project',operator,idempotencyKey:'convert12345678'})
    ]);
    assert.equal(customer.id,owner.requestId);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM service_requests')).rows[0].n,1);
    await f.service.completeDraft({token:invite.token,id:customer.id,request:fullRequest(),uploadedFiles:[]});
    assert.equal((await f.work.getWork(f.item.id)).item.projectDraft,false);
  }finally{await f.close();}
});

test('inquiry invitations cannot import an attachment belonging to a different inquiry',async()=>{
  const f=await fixture({files:[{name:'part.stl',size:123,type:'application/octet-stream',path:'inquiries/INQ-foreign123/part.stl'}]});
  try {
    const invite=await f.service.issueForCustomer({id:'INQ-example123',submissionKey:customerKey});
    const draft=await f.service.createDraft({token:invite.token,request:fullRequest()});
    await assert.rejects(f.service.completeDraft({token:invite.token,id:draft.id,request:fullRequest(),uploadedFiles:[]}),{status:409});
    assert.equal(f.verified.length,0);
  }finally{await f.close();}
});

test('revocation during attachment verification prevents completion without holding network I/O locks',async()=>{
  const f=await fixture({files:[{name:'part.stl',size:123,type:'application/octet-stream',path:'inquiries/INQ-example123/part.stl'}]});
  try {
    const invite=await f.service.issueForCustomer({id:'INQ-example123',submissionKey:customerKey});
    const draft=await f.service.createDraft({token:invite.token,request:fullRequest()});
    f.setVerifier(()=>f.service.issueForOperator({workId:f.item.id,operator}));
    await assert.rejects(f.service.completeDraft({token:invite.token,id:draft.id,request:fullRequest(),uploadedFiles:[]}),{status:410});
    assert.equal((await f.db.query('SELECT status FROM service_requests')).rows[0].status,'draft');
    assert.equal((await f.work.getWork(f.item.id)).item.kind,'inquiry');
  }finally{await f.close();}
});
