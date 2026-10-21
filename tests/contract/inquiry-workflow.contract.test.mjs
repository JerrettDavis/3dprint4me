import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

export async function inquiryDatabase() {
  const db=new PGlite();
  for(const file of ['001_service_requests.sql','002_quick_inquiries.sql','003_work_queue.sql'])
    await db.exec(await readFile(new URL('../../neon/migrations/'+file,import.meta.url),'utf8'));
  await db.exec('CREATE ROLE platform_backend NOLOGIN;');
  return db;
}
export const inquiryMigration=()=>readFile(new URL('../../neon/migrations/009_inquiry_workflow.sql',import.meta.url),'utf8');
export async function seedInquiry(db,id='INQ-example',status='submitted') {
  await db.query(`INSERT INTO quick_inquiries(id,key_hash,payload_hash,inquiry,status,submitted_at)
    VALUES($1,$2,$3,$4::jsonb,$5,CASE WHEN $5='submitted' THEN '2026-10-21T15:37:12Z'::timestamptz ELSE NULL END)`,
    [id,id.padEnd(64,'a'),'b'.repeat(64),JSON.stringify({name:'',replyEmail:'inquiry@example.com',message:'A replacement part',intent:'unknown'}),status]);
}
export async function seedRequest(db,id='3DP-20261021-1234567890ABCDEF') {
  await db.query(`INSERT INTO service_requests(id,service,project_title,contact_name,contact_email)
    VALUES($1,'design','A project','Customer','customer@example.com')`,[id]);
  return id;
}

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
