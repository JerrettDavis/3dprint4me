const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');
const time=value=>Number.isFinite(value)?new Date(value).toISOString():'unknown';
const numberFormat=new Intl.NumberFormat('en-US',{maximumFractionDigits:2});
const number=value=>Number.isFinite(value)?numberFormat.format(value):'unknown';
const chicagoFormat=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
function chicagoDay(now) {
  const parts=Object.fromEntries(chicagoFormat.formatToParts(now).map(x=>[x.type,x.value]));
  return {day:`${parts.year}-${parts.month}-${parts.day}`,due:Number(parts.hour)>=8};
}
export function capacityEmailSummary(view) {
  const metrics=view.capacity?.metrics??[];
  if(!metrics.length)return 'Capacity readings: unavailable.';
  return 'Capacity & limits (private)\n'+metrics.slice(0,40).map(m=>
    `• ${m.service??''} / ${m.label} (${m.scope??'scope unavailable'}): ${m.partial?'at least ':''}${number(m.used)} used / ${m.unlimited?'unlimited':number(m.limit)} ${m.unit}; ${m.partial?'up to ':''}${number(m.remaining)} remaining; ${m.status}.\n  Source: ${m.source??'unknown'}; measured ${time(m.observedAt)}; reset/window end ${time(m.periodEnd)}.\n  Limit: ${m.limitSource??m.source??'unknown'}${m.limitSource==='configured'?' budget':''}; verified ${time(m.limitVerifiedAt)}; quota evidence ${m.quotaState??'unknown'}.${m.partial?' Usage coverage through '+time(m.coverageEnd)+' (partial).':''}${m.rateWindowMs?' Rate window '+number(m.rateWindowMs)+' ms.':''}`).join('\n');
}
const footer=now=>'\n\nChecked '+time(now)+'.\nPublic status: https://status.3dprint4.me\nPrivate evidence: https://3dprint4me-operations.vercel.app\n\nInvoices remain draft-only. This message does not dispatch an invoice.';
export async function deliverStatusAlert({state,view,env,now=Date.now(),persist,fetchImpl=fetch}) {
  const configured=Boolean(env.ALERT_RESEND_KEY&&env.ALERT_FROM&&env.ALERT_TO);
  const alerts={...(state.alerts??{}),configured};state={...state,alerts};
  const local=chicagoDay(now),daily=env.CAPACITY_DIGEST_ENABLED==='1';
  alerts.digestConfigured=daily;
  const due=daily&&local.due&&alerts.lastDigestDay!==local.day;
  if(due){
    if(alerts.digestDueDay&&alerts.digestDueDay!==local.day&&alerts.lastDigestDay!==alerts.digestDueDay)alerts.lastMissedDigestDay=alerts.digestDueDay;
    alerts.digestDueDay=local.day;alerts.digestStatus=configured?'due':'unconfigured';
  }else alerts.digestStatus=daily?(alerts.lastDigestDay===local.day?'delivered':'scheduled'):'disabled';
  if(!configured)return state;
  const issues=[...(view.blockers??[]).filter(x=>!['alerts','alert-delivery'].includes(x.id)).map(x=>({id:x.id,severity:x.severity??'important',text:x.title+' — '+x.next})),
    ...(view.components??[]).filter(x=>x.status==='unavailable').map(x=>({id:'service-'+x.id,severity:'critical',text:x.name+' unavailable.'}))].sort((a,b)=>a.id.localeCompare(b.id));
  const fingerprint=await digest(issues.map(x=>x.id+':'+x.severity).join('\n'));
  const incidentDue=fingerprint!==alerts.lastDeliveredFingerprint&&(issues.length>0||Boolean(alerts.lastDeliveredFingerprint));
  const day=new Date(now).toISOString().slice(0,10);
  if(alerts.day!==day){alerts.day=day;alerts.attemptsToday=0;}
  // An attempted payload may already be accepted: never replace it while uncertain.
  if(alerts.pending&&now-alerts.pending.createdAt>=23*3600000){
    alerts.lastFailureAt=now;alerts.ambiguousExpired=true;if(due||alerts.pending.kind==='digest')alerts.digestStatus='blocked';return state;
  }
  if(alerts.pending&&(typeof alerts.pending.from!=='string'||!Array.isArray(alerts.pending.to)||alerts.pending.to.length!==1||typeof alerts.pending.to[0]!=='string')) {
    alerts.envelopeMissing=true;alerts.lastFailureAt=now;if(due)alerts.digestStatus='blocked';return state;
  }
  if(!alerts.pending&&!incidentDue&&!due)return state;
  if(alerts.lastAttemptAt&&now-alerts.lastAttemptAt<15*60000||alerts.attemptsToday>=8){if(due)alerts.digestStatus='delayed';return state;}
  if(!alerts.pending) {
    const kind=incidentDue?'incident':'digest';
    alerts.pending={id:'3dprint4me-status-'+crypto.randomUUID(),kind,createdAt:now,from:env.ALERT_FROM,to:[env.ALERT_TO],fingerprint:kind==='digest'?'digest:'+local.day:fingerprint,
      ...(kind==='digest'?{day:local.day}:{}),
      subject:kind==='digest'?'3dprint4.me daily status & capacity':issues.length?'3dprint4.me infrastructure needs attention':'3dprint4.me infrastructure recovered',
      text:(kind==='digest'?'Daily status · '+local.day+' · 08:00 America/Chicago\n'+(view.components??[]).map(x=>'• '+x.name+': '+x.status).join('\n')+'\n\n':'')+
        (issues.length?issues.map(x=>'• '+x.text).join('\n'):'All monitored incident and blocker conditions have cleared.')+
        '\n\n'+capacityEmailSummary(view)+footer(now)};
  }
  if(due)alerts.digestStatus=alerts.pending.kind==='digest'?'pending':'delayed';
  alerts.lastAttemptAt=now;alerts.attemptsToday=(alerts.attemptsToday??0)+1;
  await persist(state);
  try {
    const response=await fetchImpl('https://api.resend.com/emails',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+env.ALERT_RESEND_KEY,'Content-Type':'application/json','Idempotency-Key':alerts.pending.id},
      body:JSON.stringify({from:alerts.pending.from,to:alerts.pending.to,subject:alerts.pending.subject,text:alerts.pending.text})});
    if(!response.ok)throw new Error('Delivery rejected.');
    await response.body?.cancel();
    alerts.lastSuccessAt=now;
    if(alerts.pending.kind==='digest'){alerts.lastDigestDay=alerts.pending.day;alerts.digestStatus=alerts.pending.day===local.day?'delivered':due?'delayed':'scheduled';}
    else alerts.lastDeliveredFingerprint=alerts.pending.fingerprint;
    alerts.pending=null;alerts.ambiguousExpired=false;alerts.envelopeMissing=false;
  }catch{alerts.lastFailureAt=now;}
  await persist(state);return state;
}
