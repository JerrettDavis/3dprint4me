// Device drafts are explicitly opt-in, non-authoritative business records. Never
// persist contact fields, permission evidence, auth state or server error text.
const PREFIX='3dp-partner-visit-v1:',UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELDS=['gigId','expectedGigRevision','businessName','approximateArea','outcome','placement','sampleCount','visitedAt'];
function payload(input){
 if(!input||Object.keys(input).some(k=>!FIELDS.includes(k)))throw new Error('Contact, consent and unrelated fields cannot enter a device draft.');
 if(!UUID.test(input.gigId)||!Number.isSafeInteger(input.expectedGigRevision)||input.expectedGigRevision<1)throw new Error('Choose a current accepted gig before saving a draft.');
 if(typeof input.businessName!=='string'||!input.businessName.trim()||input.businessName.length>200||typeof input.approximateArea!=='string'||input.approximateArea.length>200)throw new Error('Enter a business name and bounded area.');
 if(!['interested','accepted_material','declined','unavailable'].includes(input.outcome)||!['none','permission_received','declined','no_soliciting'].includes(input.placement)||!Number.isSafeInteger(input.sampleCount)||input.sampleCount<0||input.sampleCount>1000||typeof input.visitedAt!=='string'||!Number.isFinite(Date.parse(input.visitedAt)))throw new Error('Review the visit fields before saving.');
 return Object.fromEntries(FIELDS.map(k=>[k,input[k]]));
}
export function clearVisitDrafts(storage){
 const keys=[];for(let n=0;n<storage.length;n++){const key=storage.key(n);if(key?.startsWith(PREFIX))keys.push(key);}for(const key of keys)storage.removeItem(key);
}
export function createVisitDraftStore({storage,accountId}={}){
 if(!UUID.test(accountId))throw new Error('Sign in before accessing device drafts.');
 const prefix=PREFIX+accountId+':';let syncing=null;
 const key=id=>prefix+id;
 function read(id){const raw=storage.getItem(key(id));if(raw===null)return null;let entry;try{entry=JSON.parse(raw);}catch{throw new Error('A device draft is unreadable. Keep this device and ask the owner for help.');}
  if(!entry||entry.id!==id||!UUID.test(id)||!UUID.test(entry.commandKey)||!['draft','sending','unknown','needs_review'].includes(entry.state)||Object.keys(entry).some(k=>!['id','commandKey','state','input','errorStatus'].includes(k)))throw new Error('A device draft needs manual review.');
  return {...entry,input:payload(entry.input)};
 }
 function write(entry){try{storage.setItem(key(entry.id),JSON.stringify(entry));}catch{throw new Error('Draft not saved on this device. Keep the form open or copy the business details privately.');}}
 function list(){const entries=[];for(let n=0;n<storage.length;n++){const name=storage.key(n);if(name?.startsWith(prefix)){const entry=read(name.slice(prefix.length));if(entry)entries.push(entry);}}if(entries.length>100)throw new Error('Device draft limit exceeded. Ask the owner for help before continuing.');return entries;}
 function save(input){const clean=payload(input);if(list().length>=100)throw new Error('Device draft limit is 100. Send or remove existing drafts first.');const entry={id:crypto.randomUUID(),commandKey:crypto.randomUUID(),state:'draft',input:clean};write(entry);return entry;}
 function remove(id){if(!UUID.test(id))throw new Error('Invalid device draft.');storage.removeItem(key(id));}
 function clear(){for(const entry of list())remove(entry.id);}
 async function runSync(send){let sent=0;
  for(const candidate of list()){
   // A logout/deletion in another view or tab must not recreate a removed draft.
   const entry=read(candidate.id);if(!entry||entry.state==='needs_review')continue;
   write({...entry,state:'sending'});
   try{await send('visit.record',{...entry.input,clientId:entry.id,consent:false},entry.commandKey);remove(entry.id);sent++;}
   catch(error){const status=Number(error.status)||0;if(read(entry.id))write({...entry,state:[400,409,422].includes(status)?'needs_review':'unknown',errorStatus:status});if(![400,409,422].includes(status))break;}
  }
  return {sent,remaining:list().length};
 }
 function sync(send){return syncing??=(runSync(send).finally(()=>{syncing=null;}));}
 return {save,list,remove,clear,sync};
}
