import { randomUUID } from 'node:crypto';
import { HttpError } from '../http.js';
import { uuid,text } from './validation.js';
import { canonicalJson,digest } from './postgres-repository.js';
import { getLegalVersion } from './legal.js';
import { storedLegalVersion } from './legal-content.js';
import { FEEDBACK_MAX_BYTES,inspectFeedbackDocx } from './feedback-docx.js';

export function reviewFeedbackCommands({repo,now}){
 return {'legal.import_feedback':{role:'OWNER',fields:['programId','packageId','versionId','sourceHash','reviewerName','reviewerRole','reviewerIdentityConfirmed','data'],run:async(tx,input,actor)=>{
  const program=await repo.lockProgram(tx,uuid(input.programId)),version=await getLegalVersion(tx,uuid(input.versionId));
  storedLegalVersion(version);
  if(input.sourceHash!==version.content_sha256)throw new HttpError(409,'Feedback must identify the exact reviewed source hash.');
  if(input.reviewerIdentityConfirmed!==true)throw new HttpError(400,'Confirm the returning reviewer identity through the agreed channel. File author labels do not verify identity.');
  const name=text(input.reviewerName,200),role=input.reviewerRole;
  const [pkg]=await tx.query`SELECT * FROM partner_review_packages WHERE id=${uuid(input.packageId)}`;
  const grant=pkg?.manifest.reviewers?.find(r=>r.name===name&&r.role===role);
  const source=pkg?.manifest.documents?.find(d=>d.versionId===version.id&&d.sourceHash===version.content_sha256);
  if(!pkg||new Date(pkg.expires_at)<=now()||pkg.manifest.programId!==program.id||!source||!grant||!['attorney','cpa'].includes(role))throw new HttpError(403,'This reviewer package does not grant feedback access to that source.');
  if(typeof input.data!=='string'||input.data.length>Math.ceil(FEEDBACK_MAX_BYTES/3)*4||!/^([A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.data))throw new HttpError(400,'Use a DOCX attachment up to 512 KiB.');
  const bytes=Buffer.from(input.data,'base64');if(bytes.toString('base64')!==input.data||!bytes.length||bytes.length>FEEDBACK_MAX_BYTES)throw new HttpError(400,'Use a DOCX attachment up to 512 KiB.');
  const parsed=await inspectFeedbackDocx(bytes),id=randomUUID(),sha256=digest(bytes);
  const evidence={schemaVersion:1,packageId:pkg.id,programId:program.id,versionId:version.id,sourceHash:version.content_sha256,reviewerName:name,reviewerRole:role,grantedScopes:grant.scopes,identityConfirmedBy:actor.id,receivedAt:now().toISOString(),sha256,parsed};
  await tx.query`INSERT INTO partner_review_attachments(id,package_id,version_id,bytes,sha256,evidence,evidence_sha256,created_by,created_at) VALUES(${id},${pkg.id},${version.id},${bytes},${sha256},${JSON.stringify(evidence)}::jsonb,${digest(canonicalJson(evidence))},${actor.id},${now().toISOString()})`;
  await repo.audit(tx,{programId:program.id,actor,action:'legal.feedback_imported',entityKind:'review_attachment',entityId:id,changes:{packageId:pkg.id,versionId:version.id,sha256,commentCount:parsed.comments.length,changeCount:parsed.changes.length}});
  // Neither source revisions, clause comments, review decisions nor published
  // status are altered. The owner must make each subsequent editorial decision.
  return {id,packageId:pkg.id,versionId:version.id,sha256,manualReviewRequired:true,commentCount:parsed.comments.length,changeCount:parsed.changes.length};
 }}};
}
export async function readReviewFeedback(tx,actor,input,{repo}){
 if(actor.role!=='OWNER')throw new HttpError(404,'Review feedback not found.');
 const [row]=await tx.query`SELECT * FROM partner_review_attachments WHERE id=${uuid(input.id)}`;
 if(!row)throw new HttpError(404,'Review feedback not found.');
 if(digest(row.bytes)!==row.sha256||row.evidence.sha256!==row.sha256||digest(canonicalJson(row.evidence))!==row.evidence_sha256)throw new HttpError(503,'Review feedback integrity verification failed.');
 await repo.audit(tx,{programId:row.evidence.programId,actor,action:'legal.feedback_downloaded',entityKind:'review_attachment',entityId:row.id,changes:{sha256:row.sha256}});
 return {id:row.id,filename:`feedback-${row.id}.docx`,contentType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',sha256:row.sha256,evidence:row.evidence,data:Buffer.from(row.bytes).toString('base64')};
}
