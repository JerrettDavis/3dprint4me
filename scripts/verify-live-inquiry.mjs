import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { head, del } from '@vercel/blob';
import { neon } from '@neondatabase/serverless';

// Run with node --env-file=<private env file> scripts/verify-live-inquiry.mjs <target origin>.
// The target deployment must also have owner email delivery unconfigured.
if (!process.argv[2]) throw new Error('An explicit target origin is required.');
if (!process.env.DATABASE_URL) throw new Error('Database configuration is required.');
if (process.env.RESEND_API_KEY && process.env.REQUEST_FROM_EMAIL && process.env.REQUEST_TO_EMAIL) throw new Error('Disable owner email delivery before running synthetic verification.');
const base = new URL(process.argv[2]);
if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('Invalid target origin.');
const sql = neon(process.env.DATABASE_URL);
const submissionKey = randomBytes(32).toString('hex');
const keyHash = createHash('sha256').update(submissionKey).digest('hex');
const content = 'Synthetic private inquiry upload verification.\n';
const input = { submissionKey, website: '', inquiry: {
  intent: 'unknown', message: 'Synthetic verification; delete after completion.',
  replyEmail: 'verification@example.invalid', name: 'Integration verification', referenceUrl: '',
  context: {entryPoint: 'unknown', exampleSlug: null}
}, files: [{name:'verification.txt',size:Buffer.byteLength(content),type:'text/plain'}] };
async function api(method, body, status) {
  const response = await fetch(new URL('/api/inquiry',base), {method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
  assert.equal(response.status,status,`Unexpected inquiry ${method} status.`);
  return response.json();
}
let completed = false;
let stage = 'creation';
try {
  const [first, second] = await Promise.all([api('POST',input,201),api('POST',input,201)]);
  assert.equal(first.id,second.id,'Concurrent create produced multiple inquiries.');
  assert.equal(first.live,false); assert.equal(first.mode,'neon');
  assert.equal(first.uploads.length,1); assert.equal(second.uploads.length,1);
  const instruction=first.uploads[0];
  assert.equal(instruction.path,second.uploads[0].path);
  assert.ok(/^INQ-[a-f0-9]{32}$/.test(first.id));
  assert.ok(instruction.path.startsWith(`inquiries/${first.id}/`));
  assert.equal(instruction.method,'PUT'); assert.equal(instruction.contentType,'text/plain');
  const uploadUrl=new URL(instruction.uploadUrl);
  assert.equal(uploadUrl.protocol,'https:'); assert.equal(uploadUrl.hostname,'vercel.com'); assert.equal(uploadUrl.pathname,'/api/blob/');
  stage='ownership and incomplete upload rejection';
  await api('PATCH',{id:first.id,submissionKey},409);
  await api('PATCH',{id:first.id,submissionKey:randomBytes(32).toString('hex')},404);
  stage='private upload';
  const uploaded=await fetch(instruction.uploadUrl,{method:'PUT',headers:{'Content-Type':instruction.contentType},body:content,signal:AbortSignal.timeout(60000)});
  assert.ok(uploaded.ok,`Private upload returned ${uploaded.status}.`);
  const object=await head(instruction.path);
  assert.equal(object.size,Buffer.byteLength(content));
  assert.ok(new URL(object.url).hostname.endsWith('.private.blob.vercel-storage.com'));
  const anonymous=await fetch(object.url,{redirect:'manual',signal:AbortSignal.timeout(15000)});
  assert.ok([401,403,404].includes(anonymous.status),'Anonymous private object read was not denied.');
  const uploadedReplay=await api('POST',input,201);
  assert.equal(uploadedReplay.uploads.length,0,'Verified uploads were not skipped on replay.');
  stage='completion and replay';
  const result=await api('PATCH',{id:first.id,submissionKey},200);
  assert.equal(result.live,true); assert.equal(result.id,first.id);
  assert.equal((await api('PATCH',{id:first.id,submissionKey},200)).live,true);
  assert.equal((await api('POST',input,200)).id,first.id);
  const rows=await sql`SELECT id,status,files,notification_attempts FROM quick_inquiries WHERE key_hash=${keyHash}`;
  assert.equal(rows.length,1); assert.equal(rows[0].id,first.id); assert.equal(rows[0].status,'submitted');
  assert.equal(rows[0].files[0].path,instruction.path);
  assert.equal(rows[0].notification_attempts,0,'Synthetic verification must not attempt owner email.');
  completed=true;
} catch {
  // Do not surface assertion payloads, signed URLs, keys, provider errors, or PII.
  console.error(`Live inquiry verification failed during ${stage}.`);
  process.exitCode=1;
} finally {
  try {
    // Recover our own row even if a response was lost after persistence.
    const rows=await sql`SELECT id,files FROM quick_inquiries WHERE key_hash=${keyHash} AND inquiry->>'replyEmail'='verification@example.invalid'`;
    for(const row of rows) {
      assert.ok(/^INQ-[a-f0-9]{32}$/.test(row.id));
      for(const file of row.files) {
        assert.ok(file.path.startsWith(`inquiries/${row.id}/`),'Refusing cleanup outside synthetic inquiry namespace.');
        await del(file.path);
      }
      await sql`DELETE FROM quick_inquiries WHERE id=${row.id} AND key_hash=${keyHash} AND inquiry->>'replyEmail'='verification@example.invalid'`;
    }
    const remaining=await sql`SELECT id FROM quick_inquiries WHERE key_hash=${keyHash}`;
    assert.equal(remaining.length,0);
    console.log('Synthetic inquiry records and private files cleaned up.');
  } catch {
    console.error('Synthetic inquiry cleanup failed; inspect the verification record in the private database.');
    process.exitCode=1;
  }
}
if(completed && !process.exitCode) console.log('Verified concurrent idempotency, ownership, incomplete uploads, private Blob access, durable completion, replay, and cleanup.');
