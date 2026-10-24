import { randomUUID } from 'node:crypto';
import { HttpError } from '../http.js';
import { exact,text,uuid,integer,timestamp,iso } from './validation.js';
import { prepareLegalVersion,storedLegalVersion,renderLegalVersion,compareLegalVersions } from './legal-content.js';
import { versionClearance,REVIEW_SCOPES } from './approvals.js';
export const minimumScopes=key=>key==='independent-marketing-services'?['classification','agreement_language','accounting']:['bicycle-gift-acknowledgment','cpa-cover-letter'].includes(key)?['agreement_language','accounting']:key==='field-marketing-policy'?['agreement_language','solicitation_policy']:['agreement_language'];
export async function getLegalVersion(tx,id,{lockDocument=false}={}){
 const rows=lockDocument?await tx.query`SELECT v.*,d.template_key,d.status AS document_status,d.active_version_id,d.revision AS document_revision FROM partner_legal_versions v JOIN partner_legal_documents d ON d.id=v.document_id WHERE v.id=${uuid(id)} FOR UPDATE OF d`:await tx.query`SELECT v.*,d.template_key,d.status AS document_status,d.active_version_id,d.revision AS document_revision FROM partner_legal_versions v JOIN partner_legal_documents d ON d.id=v.document_id WHERE v.id=${uuid(id)}`;
 if(!rows[0])throw new HttpError(404,'Document version not found.');return rows[0];
}
export function legalCommands({repo,approvals,now}){
 const owner=(fields,run)=>({role:'OWNER',fields,run});
 async function log(tx,programId,actor,action,id,changes={}){await repo.audit(tx,{programId,actor,action,entityKind:'legal_document',entityId:id,changes});}
 return {
  'legal.save':owner(['programId','templateKey','title','markdown','variablesSchema','issuable','requiredScopes','expectedRevision','changeReason'],async(tx,input,actor)=>{
   const program=await repo.lockProgram(tx,uuid(input.programId)),key=text(input.templateKey,80),reason=text(input.changeReason,1000),expected=integer(input.expectedRevision,0,2147483647);
   if(!/^[a-z0-9-]{3,80}$/.test(key))throw new HttpError(400,'Use a stable template key.');
   if(input.requiredScopes!==undefined&&(!Array.isArray(input.requiredScopes)||input.requiredScopes.length>4))throw new HttpError(400,'Invalid required review scopes.');
   const scopes=[...new Set([...minimumScopes(key),...(input.requiredScopes??[])])];
   const content=prepareLegalVersion({title:input.title,markdown:input.markdown,variablesSchema:input.variablesSchema??{},issuable:input.issuable??false,requiredScopes:scopes});
   let [document]=await tx.query`SELECT * FROM partner_legal_documents WHERE template_key=${key} FOR UPDATE`;
   if(!document){
    if(expected!==0)throw new HttpError(409,'The template base revision has changed.');
    const [created]=await tx.query`INSERT INTO partner_legal_documents(id,template_key,title) VALUES(${randomUUID()},${key},${content.title}) ON CONFLICT DO NOTHING RETURNING *`;
    if(!created)throw new HttpError(409,'The template was created in another session.');document=created;
   }else{
    if(document.revision!==expected)throw new HttpError(409,'A newer revision exists. Compare it before saving.');
    await tx.query`UPDATE partner_legal_documents SET title=${content.title},status='draft',revision=revision+1 WHERE id=${document.id}`;
   }
   const [last]=await tx.query`SELECT id,version_no,content_sha256 FROM partner_legal_versions WHERE document_id=${document.id} ORDER BY version_no DESC LIMIT 1`;
   if(last?.content_sha256===content.hash)throw new HttpError(409,'There are no content changes to save.');
   const id=randomUUID(),number=(last?.version_no??0)+1;
   await tx.query`INSERT INTO partner_legal_versions(id,document_id,version_no,title,markdown,variables_schema,content_sha256,issuable,required_scopes,authored_by,base_version_id,change_reason,created_at) VALUES(${id},${document.id},${number},${content.title},${content.markdown},${JSON.stringify(content.variablesSchema)}::jsonb,${content.hash},${content.issuable},${JSON.stringify(content.requiredScopes)}::jsonb,${actor.id},${last?.id??null},${reason},${now().toISOString()})`;
   await log(tx,program.id,actor,'legal.revision_saved',document.id,{versionId:id,hash:content.hash,versionNo:number});
   return {documentId:document.id,versionId:id,revision:expected+1,versionNo:number,hash:content.hash,status:'draft'};
  }),
  'legal.request_review':owner(['programId','versionId','expectedRevision'],async(tx,input,actor)=>{
   const program=await repo.lockProgram(tx,uuid(input.programId)),version=await getLegalVersion(tx,input.versionId,{lockDocument:true});
   if(version.document_revision!==integer(input.expectedRevision,1,2147483647))throw new HttpError(409,'The document has changed.');
   await tx.query`UPDATE partner_legal_documents SET status='in_review',revision=revision+1 WHERE id=${version.document_id}`;
   await log(tx,program.id,actor,'legal.review_requested',version.document_id,{versionId:version.id,hash:version.content_sha256});return {id:version.document_id,revision:version.document_revision+1,status:'in_review'};
  }),
  'legal.record_review':owner(['programId','packageId','versionId','versionHash','scope','decision','reviewerName','reviewerRole','evidenceReference','reviewedAt','expiresAt','notes'],async(tx,input,actor)=>{
   const program=await repo.lockProgram(tx,uuid(input.programId)),version=await getLegalVersion(tx,input.versionId,{lockDocument:true});
   if(input.versionHash!==version.content_sha256)throw new HttpError(409,'Review evidence must match the exact version hash.');
   if(!REVIEW_SCOPES.includes(input.scope)||!['approved','conditional','changes_requested','rejected'].includes(input.decision))throw new HttpError(400,'Choose a review scope and decision.');
   const [packageRow]=await tx.query`SELECT * FROM partner_review_packages WHERE id=${uuid(input.packageId)}`;
   const name=text(input.reviewerName,200),role=input.scope==='accounting'?'cpa':'attorney';
   if(input.reviewerRole!==role||!packageRow||new Date(packageRow.expires_at)<=now()||!(packageRow.manifest.versions??[]).includes(version.id)||!(packageRow.manifest.reviewers??[]).some(r=>r.name===name&&r.role===role&&r.scopes?.includes(input.scope)))throw new HttpError(403,'This review package does not grant that reviewer access to this version and scope.');
   const reviewed=timestamp(input.reviewedAt),expires=input.expiresAt?timestamp(input.expiresAt):null;
   if(new Date(reviewed)>now()||new Date(reviewed)<new Date(packageRow.created_at)||(expires&&new Date(expires)<=new Date(reviewed)))throw new HttpError(400,'Review dates must be consistent with the granted package.');
   const evidence=text(input.evidenceReference,500),notes=text(input.notes,10000,{optional:true}),id=randomUUID();
   await tx.query`INSERT INTO partner_legal_reviews(id,version_id,package_id,reviewer_role,scope,decision,reviewer_name,evidence_ref,notes,actor_id,reviewed_at,expires_at) VALUES(${id},${version.id},${packageRow.id},${role},${input.scope},${input.decision},${name},${evidence},${notes},${actor.id},${reviewed},${expires})`;
   await log(tx,program.id,actor,'legal.review_recorded',version.document_id,{versionId:version.id,reviewId:id,scope:input.scope,decision:input.decision});return {id,versionId:version.id,hash:version.content_sha256,scope:input.scope,decision:input.decision};
  }),
  'legal.add_comment':owner(['programId','versionId','clauseAnchor','body','reviewerId'],async(tx,input,actor)=>{
   const program=await repo.lockProgram(tx,uuid(input.programId)),version=await getLegalVersion(tx,input.versionId,{lockDocument:true}),anchor=text(input.clauseAnchor,80),body=text(input.body,10000),reviewer=text(input.reviewerId,200);
   const anchors=compareLegalVersions(version.markdown,version.markdown).clauses.map(c=>c.anchor);if(!anchors.includes(anchor))throw new HttpError(400,'Choose a clause that exists in this version.');
   const id=randomUUID();await tx.query`INSERT INTO partner_legal_comments(id,version_id,clause_anchor,body,reviewer_id) VALUES(${id},${version.id},${anchor},${body},${reviewer})`;
   await tx.query`UPDATE partner_legal_documents SET status='changes_requested',revision=revision+1 WHERE id=${version.document_id} AND status='published'`;
   await log(tx,program.id,actor,'legal.comment_added',version.document_id,{versionId:version.id,commentId:id});return {id};
  }),
  'legal.resolve_comment':owner(['programId','commentId','resolution','resolvedByVersionId'],async(tx,input,actor)=>{
   const program=await repo.lockProgram(tx,uuid(input.programId)),[comment]=await tx.query`SELECT * FROM partner_legal_comments WHERE id=${uuid(input.commentId)}`;if(!comment||comment.resolves_comment_id)throw new HttpError(404,'Open review comment not found.');
   const version=await getLegalVersion(tx,comment.version_id,{lockDocument:true}),resolved=input.resolvedByVersionId?await getLegalVersion(tx,input.resolvedByVersionId):version;
   if(resolved.document_id!==version.document_id||resolved.version_no<version.version_no)throw new HttpError(400,'The resolution must refer to this document or a newer revision.');
   if((await tx.query`SELECT id FROM partner_legal_comments WHERE resolves_comment_id=${comment.id}`).length)throw new HttpError(409,'This comment already has a resolution.');
   const id=randomUUID(),body='Resolution in version '+resolved.id+': '+text(input.resolution,9000);
   await tx.query`INSERT INTO partner_legal_comments(id,version_id,clause_anchor,body,reviewer_id,resolves_comment_id) VALUES(${id},${version.id},${comment.clause_anchor},${body},${actor.id},${comment.id})`;
   await log(tx,program.id,actor,'legal.comment_resolved',version.document_id,{commentId:comment.id,resolutionId:id});return {id};
  }),
  'legal.publish':owner(['programId','versionId','expectedRevision'],async(tx,input,actor)=>{
   const program=await repo.lockProgram(tx,uuid(input.programId)),version=await getLegalVersion(tx,input.versionId,{lockDocument:true});
   if(version.document_revision!==integer(input.expectedRevision,1,2147483647))throw new HttpError(409,'The document has changed.');
   const [latest]=await tx.query`SELECT id FROM partner_legal_versions WHERE document_id=${version.document_id} ORDER BY version_no DESC LIMIT 1`;
   const clearance=await versionClearance(tx,version.id,version.required_scopes,now());
   if(!version.issuable||latest.id!==version.id||!clearance.approved)throw new HttpError(409,'Only the latest issue-ready text with all required reviews can be published.',{missingGates:clearance.missing});
   const unresolved=await tx.query`SELECT c.id FROM partner_legal_comments c JOIN partner_legal_versions v ON v.id=c.version_id WHERE v.document_id=${version.document_id} AND c.resolves_comment_id IS NULL AND NOT EXISTS(SELECT 1 FROM partner_legal_comments r WHERE r.resolves_comment_id=c.id) LIMIT 1`;
   if(unresolved.length)throw new HttpError(409,'Resolve open clause comments before publishing.');
   storedLegalVersion(version);
   await tx.query`UPDATE partner_legal_documents SET status='published',active_version_id=${version.id},revision=revision+1 WHERE id=${version.document_id}`;
   await log(tx,program.id,actor,'legal.published',version.document_id,{versionId:version.id,hash:version.content_sha256});return {id:version.document_id,versionId:version.id,revision:version.document_revision+1,status:'published',hash:version.content_sha256};
  }),
  'legal.retire':owner(['programId','documentId','expectedRevision','reason'],async(tx,input,actor)=>{
   const program=await repo.lockProgram(tx,uuid(input.programId)),reason=text(input.reason,2000),[row]=await tx.query`UPDATE partner_legal_documents SET status='retired',revision=revision+1 WHERE id=${uuid(input.documentId)} AND revision=${integer(input.expectedRevision,1,2147483647)} RETURNING id,revision`;
   if(!row)throw new HttpError(409,'The document has changed.');await tx.query`INSERT INTO partner_work_events(id,program_id,event_type,actor_kind,actor_id,reason,data) VALUES(${randomUUID()},${program.id},'legal.retired',${actor.role},${actor.id},${reason},${JSON.stringify({documentId:row.id})}::jsonb)`;await log(tx,program.id,actor,'legal.retired',row.id,{reasonRecorded:!!reason});return row;
  }),
  'legal.issue':owner(['programId','versionId','versionHash','partnerId','bindings'],async(tx,input,actor)=>{
   const [account]=await tx.query`SELECT id,program_id,status FROM partner_accounts WHERE id=${uuid(input.partnerId)} FOR UPDATE`;
   if(!account||account.program_id!==uuid(input.programId)||account.status!=='active')throw new HttpError(404,'Active partner not found.');
   await repo.lockProgram(tx,account.program_id);await approvals.requireActive(tx,account.program_id,now());
   const version=await getLegalVersion(tx,input.versionId,{lockDocument:true}),clearance=await versionClearance(tx,version.id,version.required_scopes,now());
   if(version.content_sha256!==input.versionHash||!version.issuable||version.document_status!=='published'||version.active_version_id!==version.id||!clearance.approved)throw new HttpError(409,'This exact version is not approved and published for issuance.',{missingGates:clearance.missing});
   const snapshot=renderLegalVersion(storedLegalVersion(version),input.bindings??{});
   const [existing]=await tx.query`SELECT id FROM partner_agreement_issues WHERE version_id=${version.id} AND partner_id=${account.id} AND snapshot_sha256=${snapshot.hash}`;
   if(existing)return {id:existing.id,versionId:version.id,snapshotHash:snapshot.hash,markdown:snapshot.markdown};
   const id=randomUUID();await tx.query`INSERT INTO partner_agreement_issues(id,version_id,partner_id,snapshot_markdown,bindings,snapshot_sha256,issued_at) VALUES(${id},${version.id},${account.id},${snapshot.markdown},${JSON.stringify(snapshot.bindings)}::jsonb,${snapshot.hash},${now().toISOString()})`;
   await log(tx,account.program_id,actor,'legal.issued',version.document_id,{versionId:version.id,issueId:id,partnerId:account.id,snapshotHash:snapshot.hash});return {id,versionId:version.id,snapshotHash:snapshot.hash,markdown:snapshot.markdown};
  }),
  'agreement.acknowledge':{role:'PARTNER',fields:['issueId','snapshotHash','readAcknowledgment'],run:async(tx,input,actor)=>{
   const [issue]=await tx.query`SELECT i.*,a.program_id FROM partner_agreement_issues i JOIN partner_accounts a ON a.id=i.partner_id WHERE i.id=${uuid(input.issueId)} AND i.partner_id=${actor.id}`;if(!issue)throw new HttpError(404,'Issued document not found.');
   if(input.snapshotHash!==issue.snapshot_sha256)throw new HttpError(409,'Read the exact issued document before acknowledging it.');
   if(input.readAcknowledgment!==true)throw new HttpError(400,'Confirm that you read this document. This is not an electronic signature.');
   const id=randomUUID(),rows=await tx.query`INSERT INTO partner_agreement_acknowledgments(id,issue_id,partner_id,snapshot_sha256,acknowledged_at) VALUES(${id},${issue.id},${actor.id},${issue.snapshot_sha256},${now().toISOString()}) ON CONFLICT DO NOTHING RETURNING id`;
   if(!rows.length){const [prior]=await tx.query`SELECT id FROM partner_agreement_acknowledgments WHERE issue_id=${issue.id}`;return {id:prior.id,issueId:issue.id,snapshotHash:issue.snapshot_sha256,readAcknowledged:true};}
   await log(tx,issue.program_id,actor,'agreement.read_acknowledged',issue.id,{snapshotHash:issue.snapshot_sha256});return {id,issueId:issue.id,snapshotHash:issue.snapshot_sha256,readAcknowledged:true};
  }},
 };
}
export async function readLegal(tx,actor,resource,input,instant=new Date()){
 if(!['legal','legal-version','legal-diff'].includes(resource))return null;
 if(actor.role!=='OWNER')throw new HttpError(404,'Document not found.');
 if(resource==='legal')return {items:await tx.query`SELECT d.*,v.version_no,v.content_sha256,v.issuable FROM partner_legal_documents d LEFT JOIN LATERAL(SELECT version_no,content_sha256,issuable FROM partner_legal_versions WHERE document_id=d.id ORDER BY version_no DESC LIMIT 1)v ON true ORDER BY d.template_key LIMIT 200`};
 const version=await getLegalVersion(tx,input.id);
 if(resource==='legal-diff'){const other=await getLegalVersion(tx,input.compareTo);if(other.document_id!==version.document_id)throw new HttpError(400,'Compare revisions of the same document.');return compareLegalVersions(version.markdown,other.markdown);}
 return {version,history:await tx.query`SELECT id,version_no,title,content_sha256,issuable,authored_by,created_at,base_version_id,change_reason FROM partner_legal_versions WHERE document_id=${version.document_id} ORDER BY version_no DESC LIMIT 200`,reviews:await tx.query`SELECT * FROM partner_legal_reviews WHERE version_id=${version.id} ORDER BY recorded_at,id`,comments:await tx.query`SELECT * FROM partner_legal_comments WHERE version_id=${version.id} ORDER BY created_at,id`,clearance:await versionClearance(tx,version.id,version.required_scopes,instant)};
}
