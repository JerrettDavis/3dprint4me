import { randomUUID,createPrivateKey,createPublicKey,sign,verify } from 'node:crypto';
import { zipSync,strToU8 } from 'fflate';
import { HttpError } from '../http.js';
import { canonicalJson,digest } from './postgres-repository.js';
import { text,uuid,exact,timestamp } from './validation.js';
import { REVIEW_SCOPES } from './approvals.js';
import { getLegalVersion } from './legal.js';
import { storedLegalVersion,compareLegalVersions } from './legal-content.js';
import { createReviewDocx } from './docx.js';
import { csvCell } from './accounting.js';

function signingKey(env){
 try{const key=createPrivateKey(env.PARTNER_REVIEW_SIGNING_PRIVATE_KEY);if(key.asymmetricKeyType!=='ed25519')throw new Error();return key;}
 catch{throw new HttpError(503,'Private review signing is not configured.');}
}
function grants(value){
 if(!Array.isArray(value)||value.length<1||value.length>8)throw new HttpError(400,'Choose up to eight named reviewers.');
 const result=value.map(item=>{
  exact(item,['name','role','scopes']);const name=text(item.name,200);
  if(!['attorney','cpa'].includes(item.role)||!Array.isArray(item.scopes)||!item.scopes.length||item.scopes.length>4||new Set(item.scopes).size!==item.scopes.length||item.scopes.some(s=>!REVIEW_SCOPES.includes(s)||(item.role==='cpa'?s!=='accounting':s==='accounting')))throw new HttpError(400,'Reviewer role and scopes must agree.');
  return {name,role:item.role,scopes:[...item.scopes].sort()};
 });
 if(new Set(result.map(r=>r.role+':'+r.name)).size!==result.length)throw new HttpError(400,'Duplicate reviewer grant.');
 return result;
}
export function reviewPackageCommands({repo,now,env}){
 return {'legal.export_package':{role:'OWNER',fields:['programId','versionIds','reviewers','expiresAt','redactionConfirmed','factualBrief'],run:async(tx,input,actor)=>{
  const program=await repo.lockProgram(tx,uuid(input.programId));
  if(input.redactionConfirmed!==true)throw new HttpError(400,'Confirm private facts, redaction and permission to share before exporting.');
  const reviewers=grants(input.reviewers),expiresAt=timestamp(input.expiresAt),instant=now();
  if(new Date(expiresAt)<=instant||new Date(expiresAt)-instant>30*86400000)throw new HttpError(400,'Review grants must expire within thirty days.');
  if(!Array.isArray(input.versionIds)||!input.versionIds.length||input.versionIds.length>20||new Set(input.versionIds).size!==input.versionIds.length)throw new HttpError(400,'Choose up to twenty distinct source versions.');
  const privateKey=signingKey(env),id=randomUUID(),files={},documents=[],changes=[],worksheet=[['version_id','source_sha256','clause','scope','decision','comments'].map(csvCell).join(',')];
  const add=(name,data)=>{files[name]=typeof data==='string'?strToU8(data):data;};
  // Stable order gives identical file/provenance semantics regardless of selection order.
  for(const versionId of [...input.versionIds].sort()){
   const row=await getLegalVersion(tx,uuid(versionId)),source=storedLegalVersion(row);
   const filename=`${row.template_key}-v${row.version_no}-${row.id}`;
   if(!/^[a-z0-9-]+$/.test(filename))throw new HttpError(503,'Invalid stored document identifier.');
   add(filename+'.md',source.markdown);add(filename+'.docx',createReviewDocx({markdown:source.markdown,sourceHash:source.hash}));
   add(filename+'.variables.json',canonicalJson(source.variablesSchema)+'\n');
   documents.push({versionId:row.id,documentId:row.document_id,templateKey:row.template_key,versionNo:row.version_no,title:source.title,sourceHash:source.hash,issuable:source.issuable,requiredScopes:source.requiredScopes,authoredBy:row.authored_by,createdAt:new Date(row.created_at).toISOString(),baseVersionId:row.base_version_id,changeReason:row.change_reason});
   const [previous]=await tx.query`SELECT * FROM partner_legal_versions WHERE document_id=${row.document_id} AND version_no<${row.version_no} ORDER BY version_no DESC LIMIT 1`;
   if(previous)storedLegalVersion(previous);
   const comparison=compareLegalVersions(previous?.markdown??'',source.markdown);
   changes.push({versionId:row.id,comparedTo:previous?.id??null,...comparison});
   for(const clause of comparison.clauses)for(const scope of source.requiredScopes)worksheet.push([row.id,source.hash,clause.anchor,scope,'',''].map(csvCell).join(','));
  }
  add('README-review.txt','PRIVATE PROFESSIONAL REVIEW COPY\nMarkdown is canonical. DOCX is an editable review copy. No document is executed by this export. Return annotations as feedback; revisions and approvals require separate owner actions.\nVerify the Ed25519 public-key fingerprint through an independently trusted channel before relying on signature.json. A key included in this ZIP alone does not establish identity.\nShare only through an approved encrypted channel. Download expiry does not recall offline copies.\n');
  add('01-context-and-questions.md','# Professional review context\n\nNONBINDING REVIEW REQUEST\n\n'+text(input.factualBrief,10000,{optional:true})+'\n\nPlease review the granted scopes against actual practices. Record conditions, rejected clauses, classification alternatives and re-review triggers. Draft language and software flags do not establish legal approval.\n');
  add('changes-from-prior-round.json',canonicalJson(changes)+'\n');
  add('review-checklist.csv',worksheet.join('\r\n')+'\r\n');
  const publicKey=createPublicKey(privateKey).export({type:'spki',format:'pem'});
  const manifest={schemaVersion:1,packageId:id,programId:program.id,private:true,createdAt:instant.toISOString(),expiresAt,createdBy:actor.id,redactionConfirmed:true,versions:documents.map(d=>d.versionId),reviewers,documents,publicKeyFingerprint:digest(publicKey),files:Object.entries(files).map(([name,bytes])=>({name,bytes:bytes.byteLength,sha256:digest(bytes)}))};
  const canonical=canonicalJson(manifest),signature=sign(null,Buffer.from(canonical),privateKey).toString('base64');
  add('manifest.json',canonical+'\n');add('signature.json',canonicalJson({algorithm:'Ed25519',publicKey,signature})+'\n');
  const bytes=zipSync(Object.fromEntries(Object.entries(files).map(([name,value])=>[name,[value,{mtime:new Date(1980,0,1)}]])),{level:6}),hash=digest(bytes),filename=`review-${id}.zip`;
  if(bytes.byteLength>8*1024*1024)throw new HttpError(400,'Choose fewer or smaller document versions.');
  await tx.query`INSERT INTO partner_review_packages(id,version_id,manifest,created_by,created_at,expires_at) VALUES(${id},${documents[0].versionId},${JSON.stringify(manifest)}::jsonb,${actor.id},${instant.toISOString()},${expiresAt})`;
  await tx.query`INSERT INTO partner_review_artifacts(package_id,bytes,sha256,filename,manifest_signature,public_key) VALUES(${id},${Buffer.from(bytes)},${hash},${filename},${signature},${publicKey})`;
  await repo.audit(tx,{programId:program.id,actor,action:'legal.package_exported',entityKind:'review_package',entityId:id,changes:{sha256:hash,versionCount:documents.length,expiresAt}});
  return {id,sha256:hash,filename,expiresAt,versionCount:documents.length,publicKeyFingerprint:manifest.publicKeyFingerprint,downloadPath:`/api/operator-partners?resource=review-package&id=${id}`};
 }}};
}
export async function readReviewPackage(tx,actor,input,{repo,now}){
 if(actor.role!=='OWNER')throw new HttpError(404,'Review package not found.');
 const [row]=await tx.query`SELECT p.*,a.bytes,a.sha256,a.filename,a.manifest_signature,a.public_key FROM partner_review_packages p JOIN partner_review_artifacts a ON a.package_id=p.id WHERE p.id=${uuid(input.id)}`;
 if(!row)throw new HttpError(404,'Review package not found.');
 if(new Date(row.expires_at)<=now())throw new HttpError(410,'This review package expired. Create a new package and reviewer grant.');
 let valid=false;
 try{valid=digest(row.bytes)===row.sha256&&digest(row.public_key)===row.manifest.publicKeyFingerprint&&verify(null,Buffer.from(canonicalJson(row.manifest)),row.public_key,Buffer.from(row.manifest_signature,'base64'));}catch{}
 if(!valid)throw new HttpError(503,'Review package integrity verification failed.');
 await repo.audit(tx,{programId:row.manifest.programId,actor,action:'legal.package_downloaded',entityKind:'review_package',entityId:row.id,changes:{sha256:row.sha256}});
 return {id:row.id,filename:row.filename,contentType:'application/zip',sha256:row.sha256,data:Buffer.from(row.bytes).toString('base64')};
}
