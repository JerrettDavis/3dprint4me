const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');

export async function deliverStatusAlert({state,view,env,now=Date.now(),persist,fetchImpl=fetch}) {
  const configured=Boolean(env.ALERT_RESEND_KEY&&env.ALERT_FROM&&env.ALERT_TO);
  let alerts={...(state.alerts??{}),configured};state={...state,alerts};
  if(!configured)return state;
  const issues=[...view.blockers.filter(x=>!['alerts','alert-delivery'].includes(x.id)).map(x=>({id:x.id,text:x.title+' — '+x.next})),
    ...view.components.filter(x=>x.status==='unavailable').map(x=>({id:'service-'+x.id,text:x.name+' is unavailable.'}))].sort((a,b)=>a.id.localeCompare(b.id));
  const fingerprint=await digest(issues.map(x=>x.id).join('\n'));
  const day=new Date(now).toISOString().slice(0,10);
  if(alerts.day!==day){alerts.day=day;alerts.attemptsToday=0;}
  if(!alerts.pending&&fingerprint===alerts.lastDeliveredFingerprint)return state;
  if(!alerts.pending&&!issues.length&&!alerts.lastDeliveredFingerprint)return state;
  if(alerts.lastAttemptAt&&now-alerts.lastAttemptAt<15*60000||alerts.attemptsToday>=8)return state;
  if(!alerts.pending)alerts.pending={id:'3dprint4me-status-'+crypto.randomUUID(),createdAt:now,fingerprint,
    subject:issues.length?'3dprint4.me infrastructure needs attention':'3dprint4.me infrastructure recovered',
    text:(issues.length?issues.map(x=>'• '+x.text).join('\n'):'All monitored incident and blocker conditions have cleared.')+
      '\n\nChecked '+new Date(now).toISOString()+'.\nPublic status: https://status.3dprint4.me\nPrivate evidence: https://3dprint4me-operations.vercel.app\n\nInvoices remain draft-only. This message does not dispatch an invoice.'};
  // Resend retains idempotency keys for24h. An uncertain older event requires
  // intervention instead of risking a duplicate with a new key.
  if(now-alerts.pending.createdAt>=23*3600000){alerts.lastFailureAt=now;alerts.ambiguousExpired=true;return state;}
  alerts.lastAttemptAt=now;alerts.attemptsToday=(alerts.attemptsToday??0)+1;
  await persist(state); // Claim the exact event/payload before any external send.
  try{
    const response=await fetchImpl('https://api.resend.com/emails',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+env.ALERT_RESEND_KEY,'Content-Type':'application/json','Idempotency-Key':alerts.pending.id},
      body:JSON.stringify({from:env.ALERT_FROM,to:[env.ALERT_TO],subject:alerts.pending.subject,text:alerts.pending.text})});
    if(!response.ok)throw new Error('Delivery rejected.');
    await response.body?.cancel();
    alerts.lastSuccessAt=now;alerts.lastDeliveredFingerprint=alerts.pending.fingerprint;alerts.pending=null;alerts.ambiguousExpired=false;
  }catch{alerts.lastFailureAt=now;}
  await persist(state);return state;
}
