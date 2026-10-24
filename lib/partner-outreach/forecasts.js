import {HttpError} from '../http.js';
import {readPayables} from './ledger.js';
import {exact,uuid,iso} from './validation.js';

const failure=()=>new HttpError(503,'Spend forecasts need owner reconciliation.');
const cents=value=>{if(!Number.isSafeInteger(value)||value<0)throw failure();return value;};
const fields=['authorizedMaximumCents','offeredMaximumCents','pendingFeeCents','contingentBonusCents','obligationCents','paidCents','outstandingCents','overpaidCents'];
const blank=()=>Object.fromEntries(fields.map(key=>[key,0]));
function add(target,key,value){target[key]=cents(target[key]+cents(value));}
function finish(row){row.remainingExposureCents=cents(row.pendingFeeCents+row.contingentBonusCents+row.outstandingCents);row.potentialTotalCents=cents(row.paidCents+row.remainingExposureCents);row.unfundedExposureCents=Math.max(0,row.potentialTotalCents-row.authorizedMaximumCents);return row;}
function unique(rows,key){const map=new Map();for(const row of rows){if(!row[key]||map.has(row[key]))throw failure();map.set(row[key],row);}return map;}

// A deterministic upper bound for recorded commitments, not assumed future work.
export function projectSpend({programs,weeks,gigs,reservations,awards,payables}){
 const projected=new Map(programs.map(p=>[p.id,{programId:p.id,label:p.label,...blank(),weeks:[]} ]));
 if(projected.size!==programs.length)throw failure();
 const weekRows=new Map(),gigRows=unique(gigs,'id'),awardRows=unique(awards,'id');
 for(const w of weeks){const program=projected.get(w.program_id);if(!program||weekRows.has(w.id))throw failure();const week={weekId:w.id,weekStart:String(iso(w.week_start_local)).slice(0,10),capCents:cents(w.cap_cents),...blank()};week.authorizedMaximumCents=cents(w.committed_cents);weekRows.set(w.id,{programId:w.program_id,row:week});program.weeks.push(week);}
 const reserved=new Map(),reservedByWeek=new Map();
 for(const r of reservations){if(reserved.has(r.gig_id))throw failure();reserved.set(r.gig_id,r);reservedByWeek.set(r.program_week_id,cents((reservedByWeek.get(r.program_week_id)??0)+cents(r.amount_cents)));}
 const allocations=new Map();
 for(const g of gigs){
  const program=projected.get(g.program_id);if(!program)throw failure();
  if(g.accepted_fee_cents===null){if(reserved.has(g.id))throw failure();if(g.status==='offered')add(program,'offeredMaximumCents',cents(g.terms_snapshot.feeCents)+cents(g.terms_snapshot.maximumBonusCents??0));continue;}
  const week=weekRows.get(g.program_week_id),r=reserved.get(g.id),maximum=cents(cents(g.accepted_fee_cents)+cents(g.maximum_bonus_cents));
  if(!week||week.programId!==g.program_id||!r||r.program_week_id!==g.program_week_id||r.amount_cents!==maximum)throw failure();
  allocations.set(g.id,{programId:g.program_id,week:week.row});
 }
 if([...reserved.keys()].some(id=>!allocations.has(id)))throw failure();
 for(const [id,w]of weekRows)if((reservedByWeek.get(id)??0)!==w.row.authorizedMaximumCents)throw failure();
 const earned=new Map();for(const award of awards){if(!allocations.has(award.gig_id))throw failure();earned.set(award.gig_id,cents((earned.get(award.gig_id)??0)+cents(award.amount_cents)));}
 const feePayables=new Set(),awardPayables=new Set();
 for(const p of payables){
  const award=p.referralEventId?awardRows.get(p.referralEventId):null,id=p.gigId??award?.gig_id,allocation=allocations.get(id);
  if(!allocation||allocation.programId!==p.programId||!!p.gigId===!!p.referralEventId)throw failure();
  const seen=p.gigId?feePayables:awardPayables,key=p.gigId??p.referralEventId;if(seen.has(key))throw failure();seen.add(key);
  if(cents(cents(p.paidCents)+cents(p.outstandingCents))!==cents(cents(p.amountDueCents)+cents(p.overpaidCents)))throw failure();
  for(const [field,value]of [['obligationCents',p.amountDueCents],['paidCents',p.paidCents],['outstandingCents',p.outstandingCents],['overpaidCents',p.overpaidCents]])add(allocation.week,field,value);
 }
 if(awardPayables.size!==awardRows.size)throw failure();
 for(const [id,allocation]of allocations){const g=gigRows.get(id),bonus=earned.get(id)??0;if(bonus>g.maximum_bonus_cents)throw failure();if(!feePayables.has(id))add(allocation.week,'pendingFeeCents',g.accepted_fee_cents);add(allocation.week,'contingentBonusCents',g.maximum_bonus_cents-bonus);}
 for(const p of projected.values()){p.weeks.sort((a,b)=>a.weekStart.localeCompare(b.weekStart));for(const w of p.weeks){finish(w);for(const key of fields)add(p,key,w[key]);}finish(p);}
 return [...projected.values()];
}

const bounded=rows=>{if(rows.length>10000)throw new HttpError(409,'Choose a smaller program scope for spend forecasts.');return rows;};
export async function readSpendForecasts(tx,actor,input={},asOf=new Date()){
 if(actor.role!=='OWNER')throw new HttpError(404,'Resource not found.');
 exact(input,['programId']);const programId=input.programId?uuid(input.programId):null;
 // Writers lock one program before financial mutations. Ordered shared locks give
 // this multi-query projection coherent evidence without locking partner accounts.
 const programs=bounded(await tx.query`SELECT id,label FROM partner_programs WHERE (${programId}::uuid IS NULL OR id=${programId}::uuid) ORDER BY id LIMIT 10001 FOR SHARE`);
 if(programId&&!programs.length)throw new HttpError(404,'Program not found.');
 const weeks=bounded(await tx.query`SELECT id,program_id,week_start_local,cap_cents,committed_cents FROM partner_program_weeks WHERE (${programId}::uuid IS NULL OR program_id=${programId}::uuid) ORDER BY program_id,week_start_local,id LIMIT 10001`);
 const gigs=bounded(await tx.query`SELECT id,program_id,program_week_id,status,accepted_fee_cents,maximum_bonus_cents,terms_snapshot FROM partner_gigs WHERE (${programId}::uuid IS NULL OR program_id=${programId}::uuid) ORDER BY id LIMIT 10001`);
 const reservations=bounded(await tx.query`SELECT r.gig_id,r.program_week_id,r.amount_cents FROM partner_budget_reservations r JOIN partner_gigs g ON g.id=r.gig_id WHERE (${programId}::uuid IS NULL OR g.program_id=${programId}::uuid) ORDER BY r.gig_id LIMIT 10001`);
 const awards=bounded(await tx.query`SELECT e.id,r.originating_gig_id AS gig_id,e.amount_cents FROM partner_referral_events e JOIN partner_referrals r ON r.id=e.referral_id WHERE (${programId}::uuid IS NULL OR r.program_id=${programId}::uuid) ORDER BY e.id LIMIT 10001`);
 const payables=await readPayables(tx,{actor,programId});
 return {items:projectSpend({programs,weeks,gigs,reservations,awards,payables}),asOf:asOf.toISOString(),method:'recorded_commitment_upper_bound'};
}
