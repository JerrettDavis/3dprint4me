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
