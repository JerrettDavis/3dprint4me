import {prepareLegalVersion,renderLegalVersion} from '../../lib/partner-outreach/legal-content.js';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { splitStatements } from '../../scripts/migrate-neon.mjs';
import { digest } from '../../lib/partner-outreach/postgres-repository.js';
export const TEST_NOW='2026-10-23T12:00:00.000Z';
export const ACTIVE_ENV={PARTNER_PROGRAM_ENABLED:'1',PARTNER_CLASSIFICATION_APPROVED:'1',PARTNER_ACCOUNTING_APPROVED:'1'};
export async function partnerFixture({reviewed=true,acknowledged=true,issuable=true}={}) {
 const db=new PGlite();
 for(const s of splitStatements(await readFile(new URL('../../neon/migrations/001_service_requests.sql',import.meta.url),'utf8')))await db.query(s);
  for(const s of splitStatements(await readFile(new URL('../../neon/migrations/012_partner_outreach.sql',import.meta.url),'utf8')))await db.query(s);
 for(const s of splitStatements(await readFile(new URL('../../neon/migrations/013_partner_weekly_statements.sql',import.meta.url),'utf8')))await db.query(s);
 const query=target=>async(strings,...values)=>(await target.query(strings.reduce((s,p,i)=>s+(i?'$'+i:'')+p,''),values)).rows;
 const database={query:query(db),withTransaction:fn=>db.transaction(tx=>fn({query:query(tx)}))};
 const programId=randomUUID(),partnerId=randomUUID(),otherPartnerId=randomUUID(),documentId=randomUUID(),versionId=randomUUID(),sessionId=randomUUID(),reviewPackageId=randomUUID();
 await database.query`INSERT INTO partner_programs(id,label,starts_on,enabled,synthetic) VALUES(${programId},'Synthetic','2026-10-01',true,true)`;
 for(const id of [partnerId,otherPartnerId])await database.query`INSERT INTO partner_accounts(id,program_id,display_name,status) VALUES(${id},${programId},'Synthetic','active')`;
 await database.query`INSERT INTO partner_sessions(id,partner_id,token_hash,csrf_hash,credential_version,expires_at,absolute_expires_at,created_at) VALUES(${sessionId},${partnerId},${digest('synthetic-session')},${digest('synthetic-csrf')},1,'2026-10-30T12:00Z','2026-11-22T12:00Z',${TEST_NOW})`;
 if(reviewed){
  await database.query`INSERT INTO partner_legal_documents(id,template_key,title) VALUES(${documentId},'synthetic-test-document','Synthetic unapproved outside isolated tests')`;
  const source=prepareLegalVersion({title:'Synthetic fixture terms',markdown:'SYNTHETIC TEST ONLY',variablesSchema:{},issuable,requiredScopes:['classification','agreement_language','solicitation_policy','accounting']});
  await database.query`INSERT INTO partner_legal_versions(id,document_id,version_no,title,markdown,variables_schema,content_sha256,authored_by,issuable,required_scopes) VALUES(${versionId},${documentId},1,${source.title},${source.markdown},'{}',${source.hash},'synthetic-owner',${issuable},${JSON.stringify(source.requiredScopes)}::jsonb)`;
  await database.query`UPDATE partner_legal_documents SET status='published',active_version_id=${versionId} WHERE id=${documentId}`;
  const reviewers=[{name:'Synthetic fixture',role:'attorney',scopes:['classification','agreement_language','solicitation_policy']},{name:'Synthetic fixture',role:'cpa',scopes:['accounting']}];
  await database.query`INSERT INTO partner_review_packages(id,version_id,manifest,created_by,created_at,expires_at) VALUES(${reviewPackageId},${versionId},${JSON.stringify({programId,versions:[versionId],reviewers})}::jsonb,'synthetic-owner',${TEST_NOW},'2026-10-30T12:00Z')`;
  for(const scope of ['classification','agreement_language','solicitation_policy','accounting'])await database.query`INSERT INTO partner_legal_reviews(id,version_id,package_id,reviewer_role,scope,decision,reviewer_name,evidence_ref,actor_id,reviewed_at) VALUES(${randomUUID()},${versionId},${reviewPackageId},${scope==='accounting'?'cpa':'attorney'},${scope},'approved','Synthetic fixture','SYNTHETIC-NOT-REAL-APPROVAL','synthetic-owner',${TEST_NOW})`;
  await database.query`UPDATE partner_programs SET settings=${JSON.stringify({contractVersionId:versionId,policyVersionId:versionId})}::jsonb WHERE id=${programId}`;
  for(const id of [partnerId,otherPartnerId]){
   const issueId=randomUUID(),snapshot=renderLegalVersion(source,{}),hash=snapshot.hash;
   await database.query`INSERT INTO partner_agreement_issues(id,version_id,partner_id,snapshot_markdown,bindings,snapshot_sha256,issued_at) VALUES(${issueId},${versionId},${id},${snapshot.markdown},'{}',${hash},${TEST_NOW})`;
   if(acknowledged)await database.query`INSERT INTO partner_agreement_acknowledgments(id,issue_id,partner_id,snapshot_sha256,acknowledged_at) VALUES(${randomUUID()},${issueId},${id},${hash},${TEST_NOW})`;
  }
 }
 const otherSessionId=randomUUID();
 await database.query`INSERT INTO partner_sessions(id,partner_id,token_hash,csrf_hash,credential_version,expires_at,absolute_expires_at,created_at) VALUES(${otherSessionId},${otherPartnerId},${digest('other-synthetic-session')},${digest('other-synthetic-csrf')},1,'2026-10-30T12:00Z','2026-11-22T12:00Z',${TEST_NOW})`;
 const otherActor={role:'PARTNER',id:otherPartnerId,sessionId:otherSessionId,credentialVersion:1};
 const owner={role:'OWNER',id:'synthetic-owner'},actor={role:'PARTNER',id:partnerId,sessionId,credentialVersion:1};
 return {db,database,reviewPackageId,programId,partnerId,otherPartnerId,documentId,versionId,sessionId,owner,actor,otherActor,close:()=>db.close()};
}
