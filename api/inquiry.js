import { randomBytes, createHmac } from 'node:crypto';
import { head } from '@vercel/blob';
import { HttpError, readJson, requireMethod, sendJson, handleApiError } from '../lib/http.js';
import { normalizeInquiry, validateSubmissionKey } from '../lib/inquiry-validation.js';
import { hasBlob, createSignedUpload } from '../lib/blob.js';
import * as store from '../lib/inquiry-store.js';

export function createInquiryHandler(deps = {}) {
  const db = deps.store || store;
  const configured = deps.configured || (()=>Boolean(process.env.DATABASE_URL));
  const blobConfigured = deps.blobConfigured || hasBlob;
  const inspect = deps.head || head;
  const sign = deps.sign || createSignedUpload;
  async function verified(file) {
    try { const object = await inspect(file.path); return object.pathname === file.path && object.size === file.size; }
    catch { return false; }
  }
  return async function handler(req,res) {
    try {
      requireMethod(req,['POST','PATCH']);
      const body = await readJson(req,32768);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400,'Invalid inquiry.');
      if (Buffer.byteLength(JSON.stringify(body)) > 32768) throw new HttpError(413,'Request body is too large.');
      if (body.website) return sendJson(res,200,{live:false,mode:'ignored',uploads:[]});
      const normalized = req.method === 'POST' ? normalizeInquiry(body) : {key_hash:validateSubmissionKey(body.submissionKey)};
      if (!configured()) return sendJson(res,200,{live:false,mode:'local',uploads:[]});
      // Trust only Vercel's overwritten client IP header; never generic forwarded-for.
      const address = process.env.VERCEL ? String(req.headers?.['x-vercel-forwarded-for'] || 'unknown').split(',')[0].trim() : 'local';
      const rateKey = createHmac('sha256',process.env.DATABASE_URL || 'test').update(address).digest('hex');
      await db.rate(rateKey);
      let row = await db.find(normalized.key_hash);
      if (req.method === 'POST') {
        if (row && row.payload_hash !== normalized.payload_hash) throw new HttpError(409,'This submission key belongs to different inquiry details.');
        if (!row) {
          if (normalized.files.length && !blobConfigured()) throw new HttpError(503,'Private uploads are unavailable.');
          const id = `INQ-${randomBytes(16).toString('hex')}`;
          row = await db.create({...normalized,id,status:'draft',files:normalized.files.map((file,index)=>({...file,path:`inquiries/${id}/${index}-${randomBytes(12).toString('hex')}.${file.name.split('.').pop().toLowerCase()}`}))});
          if (row.payload_hash !== normalized.payload_hash) throw new HttpError(409,'This submission key belongs to different inquiry details.');
        }
        if (row.status !== 'submitted') {
          const uploads=[];
          for (const [index,file] of row.files.entries()) if (!(await verified(file))) uploads.push({index,path:file.path,...await sign(file.path,file.size,file.type),method:'PUT',contentType:file.type});
          return sendJson(res,201,{id:row.id,live:false,mode:'neon',uploads});
        }
      } else {
        if (!row || row.id !== body.id) throw new HttpError(404,'Inquiry not found.');
        if (row.status !== 'submitted') {
          for (const file of row.files) if (!(await verified(file))) throw new HttpError(409,'An attachment is missing or incomplete. Retry the upload.');
          row=await db.complete(row);
        }
      }
      try { await db.notify(row); } catch { /* Accepted inquiry remains durable if notification delivery fails. */ }
      sendJson(res,200,{id:row.id,live:true,mode:'neon',uploads:[]});
    } catch(error) { handleApiError(res,error instanceof HttpError ? error : new HttpError(502,'Inquiry temporarily unavailable.')); }
  };
}
export default createInquiryHandler();
