const resources=new Set(['gigs','gig','earnings','agreements','profile','visits','leads','activity','referrals','statement','own-export']);
export class PartnerError extends Error {
 constructor(status,message){super(message);this.status=status;}
}
export function createPartnerClient({apiOrigin='https://api.3dprint4.me',fetch=globalThis.fetch}={}){
 const origin=new URL(apiOrigin);
 if(origin.origin!==apiOrigin||!(apiOrigin==='https://api.3dprint4.me'||(origin.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(origin.hostname))))throw new Error('Unsupported partner API origin.');
 let csrf=null,partner=null,epoch=0,authQueue=Promise.resolve();
 const serialize=run=>{const result=authQueue.then(run);authQueue=result.catch(()=>{});return result;};
 function authenticate(path,body){const expected=++epoch;return serialize(()=>request(path,{body,expected}));}
 async function request(path,{body,write=false,expected=epoch}={}){
  const headers={'Accept':'application/json'};
  if(body!==undefined)headers['Content-Type']='application/json';
  if(write){if(!csrf)throw new PartnerError(401,'Sign in before continuing.');headers['X-CSRF-Token']=csrf;}
  let response;
  try{response=await fetch(apiOrigin+'/api/partner/v1/'+path,{method:body!==undefined||write?'POST':'GET',credentials:'include',cache:'no-store',redirect:'error',headers,...(body!==undefined?{body:JSON.stringify(body)}:{})});}
  catch{throw new PartnerError(0,'Unable to reach the partner service. Check your connection and try again.');}
  let data;try{data=await response.json();}catch{throw new PartnerError(503,'The partner service is temporarily unavailable. Try again later.');}
  if(!response.ok){if(response.status===401&&expected===epoch){csrf=null;partner=null;}throw new PartnerError(response.status,response.status>=500?'The partner service is temporarily unavailable. Try again later.':response.status===401?'Your session has ended. Sign in again.':typeof data.error==='string'?data.error.slice(0,1000):'The request could not be completed.');}
  if(['session','login','invite/redeem'].includes(path)){
   // Keep the CSRF value transiently so a queued sign-out can revoke a newly
   // returned cookie. Auth requests are serialized to preserve cookie ordering.
   csrf=data.csrfToken;
   if(expected!==epoch)throw new PartnerError(409,'Sign-in changed. Continue from the current page.');
   partner=data.partner;
  }
  return data;
 }
 return {
  get signedIn(){return !!partner;},
  session:()=>authenticate('session'),
  login:(accountId,password)=>authenticate('login',{accountId,password}),
  redeem:(token,password)=>authenticate('invite/redeem',{token,password}),
  logout(){const expected=++epoch;partner=null;return serialize(async()=>{try{return await request('logout',{write:true,expected});}finally{if(expected===epoch){csrf=null;partner=null;}}});},
  read(resource,input={}){if(!resources.has(resource))return Promise.reject(new Error('Unsupported partner resource.'));const query=new URLSearchParams(input);return request(resource+(query.size?'?'+query:''));},
  command:(action,input,key)=>partner?request('commands',{body:{action,input,key},write:true}):Promise.reject(new PartnerError(401,'Sign in before continuing.')),
 };
}
