import { HttpError } from '../http.js';
import { acceptLocalInquiry } from './local-work.js';
import { notificationClaimAllowed } from '../quick-inquiry/domain.js';

/** Explicit loopback-development adapter; never enables email delivery itself. */
export function createLocalInquiryStore({work}) {
  const find=async key=>(await work.snapshot()).inquiries.find(x=>x.key_hash===key)??null;
  const create=row=>work.inquiryTransaction(state=>{
    const old=state.inquiries.find(x=>x.key_hash===row.key_hash);if(old)return old;
    const record={...structuredClone(row),status:'draft',created_at:new Date().toISOString(),
      submitted_at:null,notification_status:'pending',notification_attempts:0};
    state.inquiries.push(record);return record;
  });
  const complete=row=>work.inquiryTransaction(state=>{
    const record=state.inquiries.find(x=>x.id===row.id&&x.key_hash===row.key_hash);
    if(!record)throw new HttpError(404,'Inquiry not found.');
    acceptLocalInquiry(state,record);return record;
  });
  return {
    find,findOwnedDraft:find,create,createDraft:create,complete,completeDraft:complete,ensureSubmittedWork:complete,
    rate:key=>work.inquiryTransaction(state=>{
      const bucket=Math.floor(Date.now()/3600000);
      for(const [id,value] of Object.entries(state.inquiryRates))if(value.bucket!==bucket)delete state.inquiryRates[id];
      const record=state.inquiryRates[key]??{bucket,hits:0};record.hits++;state.inquiryRates[key]=record;
      if(record.hits>60)throw new HttpError(429,'Too many attempts. Please try again later.');
    }),
    claimNotification:(row,payload)=>work.inquiryTransaction(state=>{
      const record=state.inquiries.find(x=>x.id===row.id);
      if(!record||record.status!=='submitted'||!notificationClaimAllowed({status:record.notification_status,
        attempts:record.notification_attempts,startedAt:record.notification_started_at,lastAt:record.notification_last_at}))return null;
      record.notification_status='sending';record.notification_attempts++;
      record.notification_started_at??=new Date().toISOString();record.notification_last_at=new Date().toISOString();
      record.notification_payload??=structuredClone(payload);return record.notification_payload;
    }),
    finishNotification:(row,status)=>work.inquiryTransaction(state=>{
      const record=state.inquiries.find(x=>x.id===row.id);
      if(record&&record.notification_status!=='sent')record.notification_status=status;
    })
  };
}
