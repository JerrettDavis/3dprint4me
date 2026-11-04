import {AsyncLocalStorage} from 'node:async_hooks';
import {HttpError} from '../http.js';

// This capability exists only while the production authorization transaction
// holds the actual owner/session/binding locks. It is never accepted over HTTP.
export function createQaOwnerAuthorization({ownerAuthDatabase,env}={}){
 const context=new AsyncLocalStorage();
 const same=(a,b)=>a?.role==='OWNER'&&a.id===b?.id&&a.ownerSessionHash===b?.ownerSessionHash;
 async function guard(_tx,actor){if(!context.getStore()?.active||!same(actor,context.getStore().actor))throw new HttpError(403,'Owner QA authorization is required.');}
 async function run(actor,operation){
  if(actor?.role!=='OWNER')return operation();
  if(!/^[a-f0-9]{64}$/.test(actor.ownerSessionHash??'')||!/^\d{1,20}$/.test(env.OPERATOR_OWNER_SUBJECT??''))throw new HttpError(401,'Owner sign-in is required.');
  return ownerAuthDatabase.withTransaction(async tx=>{
   const [owner]=await tx.query`SELECT operator_id FROM public.partner_qa_authorize_owner(${actor.ownerSessionHash},${env.OPERATOR_OWNER_SUBJECT},${actor.id})`;
   if(owner?.operator_id!==actor.id)throw new HttpError(403,'Owner access is required.');
   const capability={actor:Object.freeze({...actor}),active:true};
   try{return await context.run(capability,operation);}finally{capability.active=false;}
  });
 }
 return {run,guard};
}
