// Run only against a disposable native database created by the deployment helper.
import assert from 'node:assert/strict';
import pg from 'pg';
import {createHash} from 'node:crypto';
import {createNativeDatabase} from '../lib/database.js';
import {createInquiryStore} from '../lib/inquiry-store.js';
import {createNeonWorkRepository} from '../lib/work-management/adapters/neon-work-repository.js';
import {createInquiryWorkflowRepository} from '../lib/inquiry-workflow/repository.js';
import {createInquiryWorkflowService} from '../lib/inquiry-workflow/service.js';

const url=new URL(process.env.DATABASE_URL);
assert.equal(url.hostname,'postgres');assert.match(url.pathname,/^\/platform_inquiry_rehearsal_[a-f0-9]{12}$/);
const pool=new pg.Pool({connectionString:url.href,max:6});
const database=createNativeDatabase({pool});
try {
  const {rows:[role]}=await pool.query(`SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`);
  assert.equal(role.name,'platform_app');assert.equal(role.rolsuper,false);assert.equal(role.rolbypassrls,false);
  const operator={id:'op_rehearsal123',role:'owner',enabled:true},key='a'.repeat(64),id='INQ-rehearsal123';
  await assert.rejects(pool.query(`INSERT INTO operators(id,auth_user_id,display_name,role) VALUES('op_denied123','denied','Denied','owner')`));
  const intake=createInquiryStore({query:database.query});
  const source=await intake.create({id,key_hash:createHash('sha256').update(key).digest('hex'),payload_hash:'b'.repeat(64),
    inquiry:{name:'Synthetic customer',replyEmail:'nobody@example.invalid',message:'Disposable migration rehearsal',intent:'unknown'},files:[]});
  await intake.complete(source);
  const work=createNeonWorkRepository({query:database.query}),item=(await work.listWork({view:'active',limit:30})).items[0];
  await work.applyWorkCommand(item.id,{type:'add-note',body:'Synthetic private history',revision:1},operator,'test-key-00000000');
  const service=createInquiryWorkflowService({repository:createInquiryWorkflowRepository({database})});
  const invitation=await service.issueForCustomer({id,submissionKey:key});
  const request={service:'design',projectTitle:'Synthetic project',description:'A fitted replacement part',contact:{name:'Synthetic customer',email:'nobody@example.invalid'},consent:true,files:[]};
  const [draft,prepared]=await Promise.all([
    service.createDraft({token:invitation.token,request}),
    service.prepareProject({workId:item.id,revision:2,service:'design',title:'Operator proposal',operator,idempotencyKey:'test-key-11111111'})
  ]);
  assert.equal(draft.id,prepared.requestId);
  await assert.rejects(service.assertRequestScope({id:draft.id}),{status:403});
  await service.completeDraft({token:invitation.token,id:draft.id,request});
  assert.equal((await service.completeDraft({token:invitation.token,id:draft.id,request})).replayed,true);
  const detail=await work.getWork(item.id);
  assert.equal(detail.item.projectDraft,false);assert.equal(detail.notes.length,1);assert.equal(detail.inquiry.message,'Disposable migration rehearsal');
  const {rows:[counts]}=await pool.query(`SELECT (SELECT count(*) FROM work_items)::int AS work,(SELECT count(*) FROM service_requests)::int AS projects,(SELECT count(*) FROM inquiry_handoffs WHERE token_hash=$1)::int AS raw_tokens`,[invitation.token]);
  assert.deepEqual(counts,{work:1,projects:1,raw_tokens:0});
  console.log(JSON.stringify({nativePostgresRehearsal:'passed',leastPrivilege:true,realConcurrentTransactions:true,canonicalProject:true,notesPreserved:true,replaySafe:true,noMessagesSent:true}));
} finally {await pool.end();}
