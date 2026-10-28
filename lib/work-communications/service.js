import { createHash, randomUUID } from 'node:crypto';
import { HttpError, isValidEmail } from '../http.js';

export const RETRY_WINDOW_MS=23*3600000;
export const CLAIM_MS=30000;
export function presentMessage(row) {
  const {id,kind,body,recipient,subject,state,author,createdAt,lastAttemptAt,firstAttemptAt}=row;
  return {id,kind,body,recipient,subject,state,author,createdAt,lastAttemptAt,firstAttemptAt};
}
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createCommunicationService({repository,delivery,env=process.env,now=()=>new Date()}) {
  async function dispatch(work,id) {
    const row=await repository.find(work.item.id,id);
    if(!row)throw new HttpError(404,'This message was not found on this work item.');
    if(row.kind!=='email'||row.state==='sent')return presentMessage(row);
    const stamp=now().toISOString();
    if(row.firstAttemptAt&&Date.parse(stamp)-Date.parse(row.firstAttemptAt)>=RETRY_WINDOW_MS)throw new HttpError(409,'The safe email retry window has expired. Verify delivery in the shop inbox before composing another message.');
    const claimId=randomUUID();
    const envelope=row.firstAttemptAt?row.envelope:{...row.envelope,from:env.REQUEST_FROM_EMAIL??row.envelope.from,reply_to:env.REQUEST_TO_EMAIL??row.envelope.reply_to};
    const claimed=await repository.claim(work.item.id,id,{stamp,claimId,envelope,staleBefore:new Date(now().getTime()-CLAIM_MS).toISOString()});
    if(!claimed)return presentMessage(await repository.find(work.item.id,id));
    let result;
    try {result=await delivery(claimed.envelope,`work-message/${claimed.id}`);}
    catch {result={state:'uncertain'};}
    const state=['sent','failed','uncertain','unconfigured'].includes(result?.state)?result.state:'uncertain';
    return presentMessage(await repository.finish(work.item.id,id,claimId,state,{resetFirstAttempt:state==='unconfigured'&&!row.firstAttemptAt}));
  }
  return {
    async list(work) {return {messages:(await repository.list(work.item.id)).map(presentMessage)};},
    async create(work,input,operator) {
      if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['commandId','kind','body'].includes(key)))throw new HttpError(400,'A message command is required.');
      if(!/^[A-Za-z0-9_-]{8,100}$/.test(input.commandId??''))throw new HttpError(400,'A valid message command ID is required.');
      if(!['email','comment'].includes(input.kind))throw new HttpError(400,'Choose a private comment or client email.');
      if(typeof input.body!=='string'||!input.body.trim()||input.body.length>8000||/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(input.body))throw new HttpError(400,'Enter a message between 1 and 8000 characters.');
      const body=input.body.trim(),recipient=input.kind==='email'?(work.request?.contact?.email??work.inquiry?.replyEmail):null;
      if(input.kind==='email'&&!isValidEmail(recipient))throw new HttpError(400,'This work needs a valid client email address before sending.');
      const subject=`Project update · ${String(work.request?.projectTitle??'3dprint4.me').replace(/[\r\n]/g,' ').slice(0,160)} · ${work.item.requestId??work.item.id}`;
      const text=`${body}\n\n3dprint4.me\nReference: ${work.item.requestId??work.item.id}\nReply to this email to reach the shop.`;
      const envelope={from:env.REQUEST_FROM_EMAIL??'',reply_to:env.REQUEST_TO_EMAIL??'',to:[recipient],subject,text,html:`<p>${escape(text).replaceAll('\n','<br>')}</p>`};
      const fingerprint=createHash('sha256').update(JSON.stringify([input.kind,body])).digest('hex');
      const row=await repository.create({id:`msg_${randomUUID().replaceAll('-','')}`,workId:work.item.id,operatorId:operator.id,commandId:input.commandId,fingerprint,
        kind:input.kind,body,recipient,subject:input.kind==='email'?subject:null,envelope:input.kind==='email'?envelope:null,state:input.kind==='email'?'pending':'private',author:operator.displayName??'Shop operator',createdAt:now().toISOString()});
      // A replay never initiates another delivery. Explicit retry is its own action.
      return row.inserted&&input.kind==='email'?dispatch(work,row.id):presentMessage(row);
    },
    retry:dispatch
  };
}
