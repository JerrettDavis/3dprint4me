// Private capacity telemetry. Labels and units never come from collector input.
const definitions = [
  ['blob-transfer','Blob transfer','Vercel Blob','bytes'], ['blob-storage','Blob storage','Vercel Blob','bytes'],
  ['blob-simple','Blob simple operations','Vercel Blob','operations'], ['blob-advanced','Blob advanced operations','Vercel Blob','operations'],
  ['vercel-transfer','Data transfer','Vercel','bytes'], ['vercel-functions','Function execution','Vercel','GB-seconds'],
  ['cf-requests','Worker requests','Cloudflare','requests'], ['cf-do-reads','Durable Object reads','Cloudflare','rows'],
  ['cf-do-writes','Durable Object writes','Cloudflare','rows'], ['cf-do-storage','Durable Object storage','Cloudflare','bytes'],
  ['resend-daily','Daily email','Resend','emails'], ['resend-monthly','Monthly email','Resend','emails'], ['resend-rate','Email request rate','Resend','requests'],
  ['host-disk','Host disk (writable)','Host','bytes','local'], ['host-memory','Host memory','Host','bytes','local'], ['host-cpu','Host CPU','Host','percent','local'],
  ['container-memory','Container memory','Host','bytes','local'], ['container-cpu','Container CPU','Host','percent','local'],
  ['db-size','Database size','Database','bytes','local'], ['db-connections','Database connections','Database','connections','local'],
  ['rate-sessions-global','Global session rate','Application','requests','application'], ['rate-uploads-global','Global upload rate','Application','requests','application'],
  ['rate-sessions-client','Client session rate','Application','requests','application'], ['rate-uploads-client','Client upload rate','Application','requests','application'],
  ['backup-downloaded','Backup downloaded','Backup','bytes','backup'], ['backup-reused','Backup reused','Backup','bytes','backup'],
  ['backup-downloaded-objects','Backup downloaded objects','Backup','objects','backup'], ['backup-reused-objects','Backup reused objects','Backup','objects','backup'],
];
const ages = {provider:7200000,local:720000,application:720000,backup:7200000,manual:86400000};
export const CAPACITY_METRICS = Object.freeze(Object.fromEntries(definitions.map(([id,label,service,unit,source='provider']) => [id,Object.freeze({label,service,unit,source,maxAge:ages[source]})])));
const keys = new Set(['id','used','limit','observedAt','periodStart','periodEnd','source','scope','unlimited','limitSource','limitVerifiedAt','partial','coverageEnd','rateWindowMs','windowKind']);
const scopes = new Set(['account','project','store','host','application']);
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const nullable = value => value === null || number(value);
function validOrigin(record) {
  const source=CAPACITY_METRICS[record.id]?.source;
  if (record.source !== source && !(source === 'provider' && record.source === 'manual')) return false;
  return source === 'provider' ? ['account','project','store'].includes(record.scope) : source === 'local' ? record.scope === 'host' : record.scope === 'application';
}
export function validateCapacity(records, now = Date.now()) {
  if (!Array.isArray(records) || records.length > 40 || !number(now)) throw new Error('Invalid capacity records');
  const seen = new Set();
  return records.map(record => {
    if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).some(key => !keys.has(key)) ||
      !Object.hasOwn(CAPACITY_METRICS,record.id) || seen.has(record.id) || !nullable(record.used) || !nullable(record.limit) ||
      !number(record.observedAt) || record.observedAt > now+30000 || !nullable(record.periodStart) || !nullable(record.periodEnd) ||
      (record.periodStart !== null && record.periodStart > record.observedAt) ||
      (record.periodStart !== null && record.periodEnd !== null && record.periodStart >= record.periodEnd) ||
      !Object.hasOwn(ages,record.source) || !scopes.has(record.scope) || !validOrigin(record) ||
      (record.limitSource !== undefined && !['provider','manual','configured'].includes(record.limitSource)) ||
      (record.limitVerifiedAt !== undefined && record.limitVerifiedAt !== null && (!number(record.limitVerifiedAt) || record.limitVerifiedAt > now+30000)) ||
      (record.limitSource === 'manual' && !number(record.limitVerifiedAt)) ||
      (record.partial !== undefined && typeof record.partial !== 'boolean') ||
      (record.partial === true && !number(record.coverageEnd)) ||
      (record.coverageEnd !== undefined && record.coverageEnd !== null && (!number(record.coverageEnd) || record.coverageEnd > now+30000 || record.coverageEnd > record.observedAt+30000)) ||
      (record.rateWindowMs !== undefined && (record.id !== 'resend-rate' || !number(record.rateWindowMs) || record.rateWindowMs <= 0 || record.rateWindowMs > 86400000)) ||
      (record.windowKind !== undefined && (CAPACITY_METRICS[record.id]?.source !== 'provider' || !['rolling-30-days','rolling-24-hours'].includes(record.windowKind))) ||
      (record.unlimited !== undefined && typeof record.unlimited !== 'boolean') || (record.unlimited === true && record.limit !== null)) throw new Error('Invalid capacity record');
    seen.add(record.id);
    return {...record};
  });
}
function stored(state, now) {
  let readings = [];
  try { readings = validateCapacity(state?.readings ?? [],now); } catch { /* Discard untrusted persisted telemetry. */ }
  const thresholds = {};
  for (const reading of readings) {
    const item = state?.thresholds?.[reading.id];
    if (item && ['normal','warning','critical'].includes(item.severity) && number(item.observedAt) && item.observedAt <= reading.observedAt &&
      ['normal','warning','critical',null].includes(item.candidate) && Number.isInteger(item.count) && item.count >= 0 && item.count <= 2 &&
      item.period === period(reading)) thresholds[reading.id] = {...item};
  }
  const history = Array.isArray(state?.history) ? state.history.filter(row => row && /^\d{4}-\d{2}-\d{2}$/.test(row.day) && Number.isInteger(row.warning) && row.warning >= 0 && row.warning <= 40 && Number.isInteger(row.critical) && row.critical >= 0 && row.critical <= 40).slice(-30).map(({day,warning,critical})=>({day,warning,critical})) : [];
  return {readings,thresholds,history};
}
const period = r => `${r.periodStart ?? ''}:${r.periodEnd ?? ''}`;
function quotaState(r,now) {
  if (!r || (!r.unlimited && r.limit === null)) return 'unknown';
  if ((r.limitSource ?? r.source) === 'manual') {
    if (!number(r.limitVerifiedAt)) return 'unknown';
    if (now-r.limitVerifiedAt > ages.manual) return 'stale';
  }
  return 'current';
}
function percentage(r) { return r.used !== null && r.limit !== null ? (r.limit === 0 ? 100 : Math.min(Number.MAX_VALUE,r.used / r.limit * 100)) : null; }
function severity(r) { const p=percentage(r); return p === null || r.unlimited ? null : p >= 90 ? 'critical' : p >= 70 ? 'warning' : 'normal'; }
export function updateCapacity(state, records, now = Date.now()) {
  const incoming = validateCapacity(records,now);
  const result = stored(state,now);
  const map = new Map(result.readings.map(r=>[r.id,r]));
  for (const r of incoming) {
    const previous = map.get(r.id);
    if (previous && r.observedAt <= previous.observedAt) continue;
    map.set(r.id,r);
    let t = result.thresholds[r.id];
    const target = severity(r);
    if (!t || t.period !== period(r)) t = {severity:'normal',candidate:null,count:0,observedAt:0,period:period(r)};
    if (now-t.observedAt > ages[r.source]) { t.count=0; t.candidate=null; }
    if (target !== null && quotaState(r,now) === 'current' && now-r.observedAt <= ages[r.source] && (r.periodEnd === null || r.periodEnd > now)) {
      const p = percentage(r);
      const recovering = !r.partial && ((t.severity === 'critical' && p < 85) || (t.severity === 'warning' && p < 65));
      const crossing = (target === 'critical' && t.severity !== 'critical') || (target === 'warning' && t.severity === 'normal');
      const local = ['host-cpu','host-memory','host-disk','container-cpu','container-memory'].includes(r.id);
      const desired = recovering ? target : crossing ? target : t.severity;
      if (desired !== t.severity) {
        t.count = t.candidate === desired ? Math.min(2,t.count+1) : 1; t.candidate = desired;
        if ((!recovering && !local) || t.count >= 2) { t.severity=desired; t.count=0; t.candidate=null; }
      } else { t.count=0; t.candidate=null; }
    } else { t.count=0; t.candidate=null; }
    t.observedAt=r.observedAt;
    result.thresholds[r.id]=t;
  }
  result.readings=[...map.values()].slice(0,40);
  const day=new Date(now).toISOString().slice(0,10);
  const values=Object.values(result.thresholds);
  result.history=result.history.filter(row=>row.day!==day).concat({day,warning:values.filter(t=>t.severity==='warning').length,critical:values.filter(t=>t.severity==='critical').length}).slice(-30);
  return result;
}
export function capacitySnapshot(state, now = Date.now()) {
  const clean=stored(state,now);
  const map=new Map(clean.readings.map(r=>[r.id,r]));
  return {metrics:Object.entries(CAPACITY_METRICS).map(([id,definition])=>{
    const r=map.get(id);
    const activeSeverity=clean.thresholds[id]?.severity ?? 'normal';
    const base={id,label:definition.label,service:definition.service,unit:definition.unit,scope:r?.scope ?? null,source:r?.source ?? definition.source,
      used:r?.used ?? null,limit:r?.limit ?? null,observedAt:r?.observedAt ?? null,periodStart:r?.periodStart ?? null,periodEnd:r?.periodEnd ?? null,unlimited:r?.unlimited === true,
      partial:r?.partial === true,coverageEnd:r?.coverageEnd ?? null,rateWindowMs:r?.rateWindowMs ?? null,windowKind:r?.windowKind ?? null};
    const quota=quotaState(r,now);
    const percent=r && quota === 'current' ? percentage(r) : null;
    const status=!r ? 'unknown' : now-r.observedAt > ages[r.source] || (r.periodEnd !== null && r.periodEnd <= now) ? 'stale' : quota !== 'current' ? 'unknown' : r.unlimited ? 'normal' : percent === null || (r.partial && activeSeverity === 'normal') ? 'unknown' : activeSeverity;
    return {...base,limitSource:r?.limitSource ?? r?.source ?? definition.source,limitVerifiedAt:r?.limitVerifiedAt ?? null,quotaState:quota,percent,remaining:r && quota === 'current' && r.used !== null && r.limit !== null ? Math.max(0,r.limit-r.used) : null,status,activeSeverity,thresholdFingerprint:r ? `${id}:${period(r)}:${activeSeverity}` : null};
  }),history:clean.history};
}
