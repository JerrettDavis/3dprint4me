const DAY=86400000;
const idPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function validateFunctional(value,now=Date.now()) {
 const fields=['provider','checkedAt','filesOk','estimatesOk','filesVerifiedAt','estimatesVerifiedAt','stage','nextCheckAt','failureCode','cleanupPending','receiptId','receiptSentAt','emailStage','emailNextAt','lastRepairAt','repairService','repairOutcome','repairAttempts'];
 if(!value||Array.isArray(value)||Object.keys(value).sort().join()!==fields.sort().join())throw Error('Invalid functional evidence.');
 const time=(key,future=false,nullable=true)=>{
  const n=value[key];if(n===null&&nullable)return;
  if(!Number.isSafeInteger(n)||n<0||n>now+(future?7*DAY:30000))throw Error('Invalid functional time.');
 };
 if(!['postgres','neon'].includes(value.provider)||!['idle','upload','analyze','slicing','cleanup','complete','failed','backoff'].includes(value.stage)||
  !['none','network','throttled','upload','privacy','readback','analysis','slice','timeout','cleanup','configuration','guarded'].includes(value.failureCode)||
  ![true,false,null].includes(value.filesOk)||![true,false,null].includes(value.estimatesOk)||typeof value.cleanupPending!=='boolean'||
  value.receiptId!==null&&!idPattern.test(value.receiptId)||!['idle','pending','accepted','ambiguous','failed'].includes(value.emailStage)||
  !['none','jobs','slicer'].includes(value.repairService)||!['none','started','verified','guarded','failed','cooldown'].includes(value.repairOutcome)||
  !Number.isInteger(value.repairAttempts)||value.repairAttempts<0||value.repairAttempts>3)throw Error('Invalid functional evidence.');
 for(const k of ['checkedAt','filesVerifiedAt','estimatesVerifiedAt','receiptSentAt','lastRepairAt'])time(k,false,k!=='checkedAt');
 for(const k of ['nextCheckAt','emailNextAt'])time(k,true);
 return value;
}
export function functionalStatus(state,now,provider) {
 const result={files:null,estimates:null,email:null,failed:[]};
 const record=state.platform,f=record?.details?.functional;
 if(!f||f.provider!==provider||now-record.observedAt>12*60000||record.observedAt>now+30000||now-f.checkedAt>DAY)return result;
 const valid=t=>Number.isSafeInteger(t)&&t<=now+30000&&now-t<=DAY;
 if(f.filesOk===false)result.failed.push('files');
 if(f.estimatesOk===false)result.failed.push('estimates');
 if(f.filesOk===true&&valid(f.filesVerifiedAt))result.files={verifiedAt:f.filesVerifiedAt,validUntil:f.filesVerifiedAt+DAY,scope:'Scheduled private upload, anonymous denial and byte readback'};
 if(f.estimatesOk===true&&result.files&&valid(f.estimatesVerifiedAt))result.estimates={verifiedAt:f.estimatesVerifiedAt,validUntil:Math.min(f.filesVerifiedAt,f.estimatesVerifiedAt)+DAY,scope:'Scheduled geometry analysis and completed production slicing'};
 const events=(state.deliveryEvents??[]).filter(e=>e.emailId===f.receiptId);
 if(events.some(e=>['email.failed','email.bounced'].includes(e.type)))result.failed.push('email');
 if(f.emailStage==='accepted'&&valid(f.receiptSentAt)&&!events.some(e=>['email.failed','email.bounced'].includes(e.type))) {
  const delivered=events.find(e=>e.type==='email.delivered'&&valid(e.at)&&e.at>=f.receiptSentAt-30000);
  if(delivered)result.email={verifiedAt:delivered.at,validUntil:Math.min(delivered.at,f.receiptSentAt)+DAY,scope:'Production receipt transport; signed recipient-server delivery event (not inbox read)'};
 }
 return result;
}
export async function verifyDeliveryEvent({body,headers,secret,now=Date.now()}) {
 if(typeof body!=='string'||new TextEncoder().encode(body).length>16384||!/^whsec_[A-Za-z0-9+/]+=*$/.test(secret??''))throw Error('Invalid event.');
 const eventId=headers.get('svix-id'),timestamp=headers.get('svix-timestamp');
 if(!/^[A-Za-z0-9_-]{8,128}$/.test(eventId??'')||!/^\d{10}$/.test(timestamp??'')||Math.abs(now-Number(timestamp)*1000)>300000)throw Error('Invalid event.');
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(atob(secret.slice(6)),c=>c.charCodeAt(0)),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const message=new TextEncoder().encode(eventId+'.'+timestamp+'.'+body);
 let verified=false;
 for(const part of (headers.get('svix-signature')??'').slice(0,2048).split(' ').slice(0,10)) {
  if(!/^v1,[A-Za-z0-9+/]{43}=$/.test(part))continue;
  verified=await crypto.subtle.verify('HMAC',key,Uint8Array.from(atob(part.slice(3)),c=>c.charCodeAt(0)),message)||verified;
 }
 if(!verified)throw Error('Invalid event.');
 const data=JSON.parse(body),at=Date.parse(data.created_at);
 if(!['email.delivered','email.failed','email.bounced','email.delivery_delayed'].includes(data.type)||!idPattern.test(data.data?.email_id??'')||!Number.isSafeInteger(at)||at>now+30000||now-at>DAY)throw Error('Invalid event.');
 return {eventId,emailId:data.data.email_id,type:data.type,at};
}
export function updateDeliveryEvents(records,event,now) {
 const current=(records??[]).filter(x=>now-x.at<=DAY&&x.at<=now+30000);
 if(now-event.at>DAY||event.at>now+30000||current.some(x=>x.eventId===event.eventId))return current;
 return [...current,event].sort((a,b)=>a.at-b.at).slice(-64);
}
