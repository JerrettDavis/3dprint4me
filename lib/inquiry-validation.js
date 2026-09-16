import { createHash } from 'node:crypto';
import { HttpError, isValidEmail, cleanUrl } from './http.js';
export const submissionHash = value => createHash('sha256').update(value).digest('hex');
const intents=new Set(['unknown','replace','custom','print','repair','business']);
const entries=new Set(['unknown','navigation','navigation-repair','mobile-navigation','hero','outcome-custom','outcome-repair','outcome-replace','after-work','process','business','maker','final-cta','mobile-sticky','project-detail','another-idea','restored-draft']);
const examples=new Set(['ioniq-console-organizer','esp32-rfid-dashboard','ender-skr2-pi-housing']);
function context(value) {
  if(value == null) return {entryPoint:'unknown',exampleSlug:null};
  if(typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400,'Invalid inquiry context.');
  const entry=field(value.entryPoint,100),example=field(value.exampleSlug,100);
  return {entryPoint:entries.has(entry)?entry:'unknown',exampleSlug:examples.has(example)?example:null};
}
export function validateSubmissionKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(value)) throw new HttpError(400, 'A secure submission key is required.');
  return submissionHash(value);
}
function field(value, max) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new HttpError(400, 'An inquiry field is invalid or too long.');
  return value.trim();
}
export function normalizeInquiry(body) {
  const key_hash = validateSubmissionKey(body.submissionKey);
  if (!body.inquiry || typeof body.inquiry !== 'object' || Array.isArray(body.inquiry)) throw new HttpError(400, 'Inquiry details are required.');
  const input = body.inquiry;
  const intent=field(input.intent,100);
  const inquiry = { intent: intents.has(intent)?intent:'unknown', message: field(input.message, 4000), referenceUrl: cleanUrl(field(input.referenceUrl, 2000)), replyEmail: field(input.replyEmail, 254).toLowerCase(), name: field(input.name, 100), context: context(input.context) };
  if (!isValidEmail(inquiry.replyEmail)) throw new HttpError(400, 'A valid reply email is required.');
  if (inquiry.referenceUrl) { const url = new URL(inquiry.referenceUrl); if (url.username || url.password) throw new HttpError(400, 'Reference URLs cannot include credentials.'); }
  if (!Array.isArray(body.files ?? [] ) || (body.files ?? []).length > 6) throw new HttpError(400, 'Choose up to six files.');
  const types = { jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',pdf:'application/pdf',txt:'text/plain' };
  const files = (body.files ?? []).map(file => {
    const name = field(file?.name, 180);
    const ext = name.split('.').pop().toLowerCase();
    if (!/^(jpe?g|png|webp|pdf|stl|3mf|step|stp|obj|txt)$/.test(ext) || /[/\\]/.test(name) || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 10*1024*1024) throw new HttpError(400, 'A file has an unsupported name, type or size.');
    return { name, size:file.size, type:types[ext] || 'application/octet-stream' };
  });
  if (files.reduce((sum,file)=>sum+file.size,0)>25*1024*1024) throw new HttpError(400, 'Files must total 25 MB or less.');
  if (!inquiry.message && !inquiry.referenceUrl && !files.length) throw new HttpError(400, 'Add a message, reference URL, or file.');
  return {key_hash,inquiry,files,payload_hash:submissionHash(JSON.stringify({inquiry,files}))};
}
