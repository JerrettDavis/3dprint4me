export class PartnerOwnerError extends Error {
 constructor(status,message){super(message);this.status=status;}
}
const resources=new Set(['programs','partners','campaigns','gigs','gig','budgets','audit','leads','visits','referrals','ledger','exports','export','legal','legal-version','legal-diff','review-package','review-feedback']);
export function createPartnerOwnerClient({apiBase,fetchImpl=fetch}={}){
 const url=new URL(apiBase);
 if(url.origin!==apiBase||!(apiBase==='https://api.3dprint4.me'||url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw new Error('Unsupported owner API origin.');
 let csrf=null,owner=null,epoch=0;
 function clear(){++epoch;csrf=null;owner=null;}
 async function request(query,{body,expected=epoch}={}){
  let response,data;
  try{response=await fetchImpl(apiBase+'/api/operator-partners'+query,{method:body?'POST':'GET',credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:'application/json',...(body?{'Content-Type':'application/json','X-CSRF-Token':csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});}
  catch{throw new PartnerOwnerError(0,'Unable to reach partner administration. Check your connection and try again.');}
  if(expected!==epoch)throw new PartnerOwnerError(401,'Owner access changed. Return to sign-in.');
  if([401,403].includes(response.status)){clear();throw new PartnerOwnerError(response.status,response.status===403?'Owner access is required.':'Owner sign-in is required.');}
  try{data=await response.json();}catch{throw new PartnerOwnerError(503,'Partner administration is temporarily unavailable.');}
  if(expected!==epoch)throw new PartnerOwnerError(401,'Owner access changed. Return to sign-in.');
  if(!response.ok){throw new PartnerOwnerError(response.status,response.status>=500?'Partner administration is temporarily unavailable.':typeof data.error==='string'?data.error.slice(0,1000):'The request could not be completed.');}
  return data;
 }
 return {
  clear,get signedIn(){return !!owner;},
  async session(){const expected=++epoch;const data=await request('?resource=session',{expected});if(expected!==epoch)throw new PartnerOwnerError(401,'Owner access changed. Return to sign-in.');if(!data.owner?.id||typeof data.csrfToken!=='string'||!data.csrfToken){clear();throw new PartnerOwnerError(503,'Owner session could not be verified.');}owner=data.owner;csrf=data.csrfToken;return data;},
  read(resource,input={}){if(!owner)return Promise.reject(new PartnerOwnerError(401,'Owner sign-in is required.'));if(!resources.has(resource))return Promise.reject(new Error('Unsupported owner resource.'));return request('?'+new URLSearchParams({resource,...input}));},
  command(action,input,key){if(!owner||!csrf)return Promise.reject(new PartnerOwnerError(401,'Owner sign-in is required.'));return request('',{body:{action,input,key}});},
  async logout(){clear();let response;try{response=await fetchImpl(apiBase+'/api/auth/logout',{method:'POST',credentials:'include',cache:'no-store',redirect:'error'});}catch{}if(!response?.ok)throw new PartnerOwnerError(0,'The owner view was cleared, but sign-out could not be confirmed. Return to the inbox and try again.');}
 };
}
