import { neon } from '@neondatabase/serverless';
import { HttpError } from './http.js';
import { hasEmailDelivery } from './notifications.js';
import { sendInquiryEmail } from './inquiry-notifications.js';
async function query(strings,...values) {
  try { return await neon(process.env.DATABASE_URL)(strings,...values); }
  catch { throw new HttpError(502,'Inquiry storage is temporarily unavailable.'); }
}
export async function rate(key) {
  const rows=await query`INSERT INTO inquiry_rate_limits (key_hash,bucket,hits)
    VALUES (${key},date_trunc('hour',now()),1)
    ON CONFLICT (key_hash) DO UPDATE SET
      bucket=EXCLUDED.bucket,hits=CASE WHEN inquiry_rate_limits.bucket=EXCLUDED.bucket THEN inquiry_rate_limits.hits+1 ELSE 1 END
    RETURNING hits`;
  if(rows[0].hits>60) throw new HttpError(429,'Too many attempts. Please try again later.');
}
export async function find(key) { return (await query`SELECT * FROM quick_inquiries WHERE key_hash=${key}`)[0] || null; }
export async function create(row) {
  const rows=await query`INSERT INTO quick_inquiries (id,key_hash,payload_hash,inquiry,files)
    VALUES (${row.id},${row.key_hash},${row.payload_hash},${JSON.stringify(row.inquiry)}::jsonb,${JSON.stringify(row.files)}::jsonb)
    ON CONFLICT (key_hash) DO NOTHING RETURNING *`;
  return rows[0] || await find(row.key_hash);
}
export async function complete(row) {
  const rows=await query`UPDATE quick_inquiries SET status='submitted',submitted_at=COALESCE(submitted_at,now())
    WHERE id=${row.id} AND key_hash=${row.key_hash} RETURNING *`;
  if(!rows.length) throw new HttpError(404,'Inquiry not found.');
  return rows[0];
}
export async function notify(row) {
  if(!hasEmailDelivery()) return;
  // Persist the complete provider payload before delivery. Retries must have identical bytes,
  // even if environment settings change or a process dies after the provider accepts it.
  const payload={from:process.env.REQUEST_FROM_EMAIL,to:[process.env.REQUEST_TO_EMAIL],reply_to:row.inquiry.replyEmail,
    subject:`[${row.id}] Quick inquiry`,text:`Quick inquiry ${row.id}\n\n${JSON.stringify(row.inquiry,null,2)}\n\nPrivate attachments (open through authenticated Blob storage):\n${row.files.map(file=>`${file.name}: ${file.path}`).join('\n')}\n\nThis inquiry has no binding estimate or payment.`};
  const claimed=await query`UPDATE quick_inquiries SET notification_status='sending',notification_attempts=notification_attempts+1,
    notification_started_at=COALESCE(notification_started_at,now()),notification_last_at=now(),notification_payload=COALESCE(notification_payload,${JSON.stringify(payload)}::jsonb)
    WHERE id=${row.id} AND status='submitted' AND notification_status <> 'sent' AND notification_attempts < 3
      AND (notification_started_at IS NULL OR notification_started_at > now()-interval '23 hours')
      AND (notification_last_at IS NULL OR notification_last_at < now()-interval '1 minute')
    RETURNING notification_payload`;
  if(!claimed.length) return;
  let state='failed';
  try { await sendInquiryEmail(row.id,claimed[0].notification_payload); state='sent'; }
  catch { /* Persist a safe status; never expose provider payloads or credentials. */ }
  await query`UPDATE quick_inquiries SET notification_status=${state} WHERE id=${row.id} AND notification_status <> 'sent'`;
}
