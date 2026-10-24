import { HttpError } from '../http.js';
import { canAuthorize } from './policy.js';
import { isUuid } from './postgres-repository.js';
import { iso } from './validation.js';
export const REVIEW_SCOPES=Object.freeze(['classification','agreement_language','solicitation_policy','accounting']);
function clearanceRows(rows,scopes,instant){
 const latest=new Map();for(const row of rows)if(!latest.has(row.scope))latest.set(row.scope,row);
 const missing=scopes.filter(scope=>{const r=latest.get(scope);return !r||r.decision!=='approved'||new Date(r.reviewed_at)>instant||(r.expires_at&&new Date(r.expires_at)<=instant);});
 return {approved:missing.length===0,missing,records:Object.fromEntries([...latest].map(([scope,r])=>[scope,r.id]))};
}
export async function versionClearance(tx,versionId,scopes=REVIEW_SCOPES,instant=new Date(),programId=null) {
 if(!isUuid(versionId)||!isUuid(programId))return {approved:false,missing:[...scopes],records:{},contextRequired:!isUuid(programId)};
 const rows=await tx.query`SELECT DISTINCT ON(r.scope) r.* FROM partner_legal_reviews r JOIN partner_review_packages p ON p.id=r.package_id WHERE r.version_id=${versionId} AND p.manifest->>'programId'=${programId} AND (p.manifest->'versions') @> ${JSON.stringify([versionId])}::jsonb ORDER BY r.scope,r.recorded_at DESC,r.id DESC`;
 return clearanceRows(rows,scopes,instant);
}
export async function versionProgramClearances(tx,versionId,scopes,instant){
 const rows=await tx.query`SELECT DISTINCT ON(p.manifest->>'programId',r.scope) r.*,p.manifest->>'programId' AS program_id FROM partner_legal_reviews r JOIN partner_review_packages p ON p.id=r.package_id WHERE r.version_id=${versionId} AND (p.manifest->'versions') @> ${JSON.stringify([versionId])}::jsonb ORDER BY p.manifest->>'programId',r.scope,r.recorded_at DESC,r.id DESC`;
 return Object.fromEntries([...new Set(rows.map(r=>r.program_id).filter(isUuid))].map(id=>[id,clearanceRows(rows.filter(r=>r.program_id===id),scopes,instant)]));
}
export function createPartnerApprovals({env=process.env,now=()=>new Date()}={}) {
 async function status(tx,programId,instant=now()) {
  const [program]=await tx.query`SELECT * FROM partner_programs WHERE id=${programId}`;
  if(!program)throw new HttpError(404,'Program not found.');
  const contractId=program.settings.contractVersionId,policyId=program.settings.policyVersionId;
  const versions=isUuid(contractId)&&isUuid(policyId)?await tx.query`SELECT v.id,v.content_sha256,v.issuable,v.required_scopes,d.status,d.active_version_id FROM partner_legal_versions v JOIN partner_legal_documents d ON d.id=v.document_id WHERE v.id IN (${contractId},${policyId}) ORDER BY d.id FOR SHARE OF d`:[];
  const contract=versions.find(v=>v.id===contractId),operating=versions.find(v=>v.id===policyId);
  const legal=await versionClearance(tx,contractId,[...new Set(['classification','agreement_language','accounting',...(contract?.required_scopes??[])])],instant,programId);
  const policy=await versionClearance(tx,policyId,[...new Set(['solicitation_policy',...(operating?.required_scopes??[])])],instant,programId);
  const missing=[...legal.missing,...policy.missing];
  if(!contract||!contract.issuable||contract.status!=='published'||contract.active_version_id!==contractId)missing.push('published_agreement');
  if(!operating||!operating.issuable||operating.status!=='published'||operating.active_version_id!==policyId)missing.push('published_policy');
  if(env.PARTNER_PROGRAM_ENABLED!=='1')missing.push('program_environment');
  if(env.PARTNER_CLASSIFICATION_APPROVED!=='1')missing.push('classification_environment');
  if(env.PARTNER_ACCOUNTING_APPROVED!=='1')missing.push('accounting_environment');
  if(!program.enabled)missing.push('owner_activation');
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(instant).map(p=>[p.type,p.value]));
  const local=`${parts.year}-${parts.month}-${parts.day}`;
  if(local<String(iso(program.starts_on)).slice(0,10)||local>String(iso(program.ends_on)).slice(0,10))missing.push('program_dates');
  const allowed=missing.length===0&&canAuthorize({enabled:true,classificationApproved:true,accountingApproved:true,classificationEvidenceId:legal.records?.classification,accountingEvidenceId:legal.records?.accounting,approvedDocumentHash:contract?.content_sha256,reviewedDocumentHash:contract?.content_sha256},instant);
  return {allowed,missing:[...new Set(missing)],program};
 }
 async function requireActive(tx,id,instant=now()){await tx.query`SELECT id FROM partner_programs WHERE id=${id} FOR UPDATE`;const current=await status(tx,id,instant);if(!current.allowed)throw new HttpError(409,'New engagement is unavailable until program reviews and activation are complete.',{missingGates:current.missing});return current.program;}
 return {status,requireActive,canEnroll:async(tx,id,instant)=>{await tx.query`SELECT id FROM partner_programs WHERE id=${id} FOR UPDATE`;return (await status(tx,id,instant)).allowed;}};
}
