// Exact payload snapshots are persisted before the provider call. Keys are safe for 23h.
// Provider contract: https://resend.com/docs/dashboard/emails/idempotency-keys
export function createCommunicationDelivery({env=process.env,fetchImpl=fetch}={}) {
  return async (envelope,key)=>{
    if(!env.RESEND_API_KEY||!envelope.from||!envelope.reply_to)return {state:'unconfigured'};
    try {
      const response=await fetchImpl('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(envelope),signal:AbortSignal.timeout(10000)});
      return {state:response.ok?'sent':response.status>=500||response.status===409?'uncertain':'failed'};
    }catch{return {state:'uncertain'};}
  };
}
