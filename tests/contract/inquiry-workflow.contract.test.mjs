import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeDatabase } from '../../lib/database.js';
import { createInquiryStore } from '../../lib/inquiry-store.js';
import { createNeonWorkRepository } from '../../lib/work-management/adapters/neon-work-repository.js';
import { canTransition, parseWorkQuery } from '../../lib/work-management/domain.js';

import {inquiryDatabase,inquiryMigration,seedInquiry,seedRequest} from '../support/inquiry-database.mjs';

test('inquiry schema backfills submitted work once without replaying notifications',async()=>{
  const db=await inquiryDatabase();
  try {
    await seedInquiry(db);await seedInquiry(db,'INQ-draft','draft');
    await db.exec(await inquiryMigration());
    const work=(await db.query('SELECT * FROM work_items')).rows;
    assert.equal(work.length,1);assert.equal(work[0].kind,'inquiry');assert.equal(work[0].inquiry_id,'INQ-example');
    assert.equal(work[0].request_id,null);assert.equal(work[0].status,'submitted');
    assert.equal(new Date(work[0].created_at).toISOString(),'2026-10-21T15:37:12.000Z');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM work_events')).rows[0].n,1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM notification_outbox')).rows[0].n,0);
    await db.exec(await inquiryMigration());
    assert.equal((await db.query('SELECT count(*)::int AS n FROM work_items')).rows[0].n,1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM work_events')).rows[0].n,1);
  }finally{await db.close();}
});

test('typed work constraints preserve one source and immutable inquiry/project identity',async()=>{
  const db=await inquiryDatabase();
  try {
    await db.exec(await inquiryMigration());await seedInquiry(db);
    const requestId=await seedRequest(db),other=await seedRequest(db,'3DP-20261021-OTHER1234567890');
    await assert.rejects(db.exec("INSERT INTO work_items(kind) VALUES('request')"),/constraint/);
    await assert.rejects(db.query("INSERT INTO work_items(kind,inquiry_id,request_id) VALUES('inquiry',$1,$2)",['INQ-example',requestId]),/constraint/);
    const {rows:[item]}=await db.query("INSERT INTO work_items(kind,inquiry_id) VALUES('inquiry',$1) RETURNING id",['INQ-example']);
    await assert.rejects(db.query("INSERT INTO work_items(kind,inquiry_id) VALUES('inquiry',$1)",['INQ-example']),/unique/);
    await assert.rejects(db.query("UPDATE work_items SET status='scheduled' WHERE id=$1",[item.id]),/constraint/);
    await assert.rejects(db.query("UPDATE work_items SET kind='request',request_id=$2 WHERE id=$1",[item.id,requestId]),/canonical/);
    await db.query('UPDATE quick_inquiries SET project_request_id=$2 WHERE id=$1',['INQ-example',requestId]);
    await db.query("UPDATE work_items SET kind='request',request_id=$2,project_draft=true WHERE id=$1",[item.id,requestId]);
    await assert.rejects(db.query('UPDATE work_items SET request_id=$2 WHERE id=$1',[item.id,other]),/immutable/);
    await assert.rejects(db.query('UPDATE quick_inquiries SET project_request_id=$2 WHERE id=$1',['INQ-example',other]),/immutable/);
    await assert.rejects(db.query("UPDATE work_items SET kind='inquiry',request_id=NULL WHERE id=$1",[item.id]),/immutable/);
  }finally{await db.close();}
});

test('handoffs store bounded digests, retain private RLS and deny browser access',async()=>{
  const db=await inquiryDatabase();
  try {
    await db.exec(await inquiryMigration());await seedInquiry(db);
    const {rows:columns}=await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='inquiry_handoffs'");
    assert.ok(columns.some(x=>x.column_name==='token_hash'));assert.ok(!columns.some(x=>x.column_name==='token'));
    await assert.rejects(db.query("INSERT INTO inquiry_handoffs(token_hash,inquiry_id,actor_type,expires_at) VALUES($1,$2,'customer',now()+interval '8 days')",['a'.repeat(64),'INQ-example']),/constraint/);
    await db.query("INSERT INTO inquiry_handoffs(token_hash,inquiry_id,actor_type,expires_at) VALUES($1,$2,'customer',now()+interval '7 days')",['a'.repeat(64),'INQ-example']);
    await assert.rejects(db.query("INSERT INTO inquiry_handoffs(token_hash,inquiry_id,actor_type,expires_at) VALUES($1,$2,'customer',now()+interval '7 days')",['c'.repeat(64),'INQ-example']),/unique/);
    await db.exec('CREATE ROLE inquiry_browser; SET ROLE inquiry_browser;');
    await assert.rejects(db.exec('SELECT * FROM inquiry_handoffs'),/permission denied/);
    await db.exec('RESET ROLE; SET ROLE platform_backend;');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM inquiry_handoffs')).rows[0].n,1);
    await db.exec('RESET ROLE;');
  }finally{await db.close();}
});

test('native inquiry acceptance, replay repair, typed inbox and follow-up are one durable workflow',async()=>{
  const db=await inquiryDatabase();
  try {
    await db.exec(await inquiryMigration());
    const native=createNativeDatabase({pool:{query:(text,values)=>db.query(text,values)}});
    const store=createInquiryStore({query:native.query});
    const row=await store.create({id:'INQ-new',key_hash:'d'.repeat(64),payload_hash:'e'.repeat(64),inquiry:{replyEmail:'private@example.com',message:'A replacement knob',intent:'unknown'},files:[]});
    await store.complete(row);await store.complete(row);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM work_items')).rows[0].n,1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM work_events')).rows[0].n,1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM notification_outbox')).rows[0].n,1);
    const work=createNeonWorkRepository({query:native.query});
    const list=await work.listWork(parseWorkQuery({kind:'inquiry'}));
    assert.equal(list.items.length,1);assert.equal(list.items[0].kind,'inquiry');
    assert.ok(Number.isFinite(Date.parse(list.items[0].submittedAt)));
    assert.equal(list.items[0].projectTitle,'A replacement knob');assert.equal(list.items[0].inquiryId,'INQ-new');
    assert.equal((await work.listWork(parseWorkQuery({service:'print'}))).items.length,0);
    const detail=await work.getWork(list.items[0].id);
    assert.equal(detail.request,null);assert.equal(detail.inquiry.replyEmail,'private@example.com');
    await db.exec("INSERT INTO operators(id,auth_user_id,display_name,role) VALUES('op_example123','owner','Owner','owner')");
    const op={id:'op_example123'};
    const noted=await work.applyWorkCommand(detail.item.id,{type:'add-note',body:'Respond by phone',revision:1},op,'note12345678');
    assert.equal(noted.item.kind,'inquiry');
    const closed=await work.applyWorkCommand(detail.item.id,{type:'set-status',status:'completed',revision:2},op,'close12345678');
    assert.equal(closed.item.status,'completed');
    const repeated=await work.applyWorkCommand(detail.item.id,{type:'set-status',status:'completed',revision:2},op,'close12345678');
    assert.equal(repeated.item.kind,'inquiry');
    await seedInquiry(db,'INQ-old');
    const old=(await db.query("SELECT * FROM quick_inquiries WHERE id='INQ-old'")).rows[0];
    await store.ensureSubmittedWork(old);await store.ensureSubmittedWork(old);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM work_items')).rows[0].n,2);
    const ha=await work.getHomeAssistantSnapshot();
    assert.equal(ha.counts.active,1);assert.equal(ha.items[0].projectTitle,'Inquiry needing response');
    assert.ok(!JSON.stringify(ha).includes('private@example.com'));
    assert.equal(canTransition('submitted','completed',{kind:'inquiry'}),true);
    assert.equal(canTransition('triage','quoted',{kind:'inquiry'}),false);
    assert.equal(canTransition('submitted','completed'),false);
  }finally{await db.close();}
});

test('failed work/outbox creation rolls inquiry acceptance back instead of emailing a missing item',async()=>{
  const db=await inquiryDatabase();
  try {
    await db.exec(await inquiryMigration());
    await db.exec("CREATE FUNCTION reject_test_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test storage failure'; END $$; CREATE TRIGGER test_outbox_failure BEFORE INSERT ON notification_outbox FOR EACH ROW EXECUTE FUNCTION reject_test_outbox();");
    const native=createNativeDatabase({pool:{query:(text,values)=>db.query(text,values)}});
    const store=createInquiryStore({query:native.query});
    const row=await store.create({id:'INQ-failure',key_hash:'d'.repeat(64),payload_hash:'e'.repeat(64),inquiry:{replyEmail:'private@example.com',message:'A replacement knob'},files:[]});
    await assert.rejects(store.complete(row),{status:502});
    assert.equal((await db.query('SELECT status FROM quick_inquiries')).rows[0].status,'draft');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM work_items')).rows[0].n,0);
  }finally{await db.close();}
});

test('inbox pagination does not drop older inquiries when crossing priority groups',async()=>{
  const db=await inquiryDatabase();
  try {
    await db.exec(await inquiryMigration());
    const native=createNativeDatabase({pool:{query:(text,values)=>db.query(text,values)}});
    const store=createInquiryStore({query:native.query}),work=createNeonWorkRepository({query:native.query});
    for(const [i,priority] of ['urgent','normal','low'].entries()) {
      const id='INQ-priority'+i;await seedInquiry(db,id);
      await store.ensureSubmittedWork((await db.query('SELECT * FROM quick_inquiries WHERE id=$1',[id])).rows[0]);
      await db.query('UPDATE work_items SET priority=$2,created_at=$3::timestamptz WHERE inquiry_id=$1',[id,priority,`2026-10-${21-i}T15:00:00Z`]);
    }
    const seen=[];let cursor;
    for(let i=0;i<4;i++) {
      const page=await work.listWork(parseWorkQuery({kind:'inquiry',limit:1,...(cursor?{cursor}:{})}));
      seen.push(...page.items.map(x=>x.priority));cursor=page.nextCursor;if(!cursor)break;
    }
    assert.deepEqual(seen,['urgent','normal','low']);
  }finally{await db.close();}
});
