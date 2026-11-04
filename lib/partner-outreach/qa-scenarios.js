import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {HttpError} from '../http.js';
import {prepareLegalVersion} from './legal-content.js';
import {createPostgresPartnerRepository} from './postgres-repository.js';
import {REVIEW_SCOPES} from './approvals.js';
import {uuid} from './validation.js';
const NOTICE='QA SAMPLE — NO LEGAL EFFECT — NOT FOR REAL SIGNING OR WORK';
// This factory is imported only by the fixed QA runtime. No production command
// registry includes these actions. Samples never modify canonical draft assets.
export function qaScenarioCommands({database,now}){
 const repo=createPostgresPartnerRepository({database});
 return {
 'qa.provision':{role:'OWNER',fields:['scenarioKey'],run:async(tx,input,actor)=>{
  if(input.scenarioKey!=='complete-journey')throw new HttpError(400,'Choose the complete-journey QA scenario.');
  const id=randomUUID(),partnerId=randomUUID(),docId=randomUUID(),versionId=randomUUID(),packageId=randomUUID();
  const manifest=JSON.parse(await readFile(new URL('../../contracts/partner/manifest.json',import.meta.url),'utf8'));
  const canonical=await readFile(new URL('../../contracts/partner/independent-marketing-services.md',import.meta.url),'utf8');
  const headings=canonical.split('\n').filter(x=>x.startsWith('## ['));
  const markdown='# QA workflow sample\n\n**'+NOTICE+'**\n\nThis is a synthetic workflow specimen, distinct from the canonical reviewer packet and actual professional clearance. Every obligation, permission, review and settlement in this workspace is simulated.\n\n'+
   'Fictional entity: {{company_dba}}; participant: {{partner_full_name}}; window {{program_start_date}} through {{program_end_date}}.\n\n'+
   headings.map(h=>h+'\n'+NOTICE+'. Exercise the corresponding representative form clause using synthetic facts only. See the nonissuable canonical source for actual professional review topics.\n').join('\n');
  const source=prepareLegalVersion({title:'QA SAMPLE — simulated workflow terms',markdown,variablesSchema:manifest.variables,issuable:true,requiredScopes:REVIEW_SCOPES});
  const stamp=now().toISOString(),settings={contractVersionId:versionId,policyVersionId:versionId,qaScenarioKey:input.scenarioKey,qaRunId:id,simulated:true};
  await tx.query`INSERT INTO partner_programs(id,label,starts_on,enabled,synthetic,settings) VALUES(${id},${'QA SAMPLE — '+id.slice(0,8)},'2026-10-01',true,true,${JSON.stringify(settings)}::jsonb)`;
  await tx.query`INSERT INTO partner_legal_documents(id,template_key,title) VALUES(${docId},${'qa-workflow-'+id},${source.title})`;
  await tx.query`INSERT INTO partner_legal_versions(id,document_id,version_no,title,markdown,variables_schema,content_sha256,issuable,required_scopes,authored_by,change_reason,created_at) VALUES(${versionId},${docId},1,${source.title},${source.markdown},${JSON.stringify(source.variablesSchema)}::jsonb,${source.hash},true,${JSON.stringify(REVIEW_SCOPES)}::jsonb,${actor.id},'QA simulation only; no actual approval.',${stamp})`;
  const reviewers=[{name:'SIMULATED QA attorney',role:'attorney',scopes:REVIEW_SCOPES.filter(x=>x!=='accounting')},{name:'SIMULATED QA CPA',role:'cpa',scopes:['accounting']}];
  await tx.query`INSERT INTO partner_review_packages(id,version_id,manifest,created_by,created_at,expires_at) VALUES(${packageId},${versionId},${JSON.stringify({programId:id,versions:[versionId],reviewers,simulated:true})}::jsonb,${actor.id},${stamp},${new Date(now().getTime()+7*86400000).toISOString()})`;
  for(const scope of REVIEW_SCOPES)await tx.query`INSERT INTO partner_legal_reviews(id,version_id,package_id,reviewer_role,scope,decision,reviewer_name,evidence_ref,actor_id,reviewed_at) VALUES(${randomUUID()},${versionId},${packageId},${scope==='accounting'?'cpa':'attorney'},${scope},'approved',${scope==='accounting'?'SIMULATED QA CPA':'SIMULATED QA attorney'},${'QA-SIMULATION-'+id},${actor.id},${stamp})`;
  await tx.query`UPDATE partner_legal_documents SET status='published',active_version_id=${versionId} WHERE id=${docId}`;
  await tx.query`INSERT INTO partner_accounts(id,program_id,display_name) VALUES(${partnerId},${id},'QA Synthetic Participant A')`;
  await repo.audit(tx,{programId:id,actor,action:'qa.scenario_provisioned',entityKind:'program',entityId:id,changes:{simulated:true,scenarioKey:input.scenarioKey}});
  return {programId:id,partnerId,versionId,runId:id,simulated:true,notice:NOTICE};
 }},
 'qa.reset':{role:'OWNER',fields:['programId'],run:async(tx,input,actor)=>{
  const [p]=await tx.query`SELECT * FROM partner_programs WHERE id=${uuid(input.programId)} FOR UPDATE`;
  if(!p?.synthetic||p.settings.qaScenarioKey!=='complete-journey')throw new HttpError(404,'QA scenario not found.');
  await tx.query`SELECT id FROM partner_accounts WHERE program_id=${p.id} ORDER BY id FOR UPDATE`;
  await tx.query`UPDATE partner_programs SET enabled=false,revision=revision+1 WHERE id=${p.id}`;
  await tx.query`UPDATE partner_accounts SET status='revoked',credential_version=credential_version+1,revision=revision+1 WHERE program_id=${p.id}`;
  await tx.query`UPDATE partner_sessions SET revoked_at=${now().toISOString()} WHERE partner_id IN (SELECT id FROM partner_accounts WHERE program_id=${p.id}) AND revoked_at IS NULL`;
  await tx.query`UPDATE partner_invites SET revoked_at=${now().toISOString()} WHERE partner_id IN (SELECT id FROM partner_accounts WHERE program_id=${p.id}) AND revoked_at IS NULL`;
  await repo.audit(tx,{programId:p.id,actor,action:'qa.scenario_reset',entityKind:'program',entityId:p.id,changes:{historyPreserved:true}});
  return {programId:p.id,historyPreserved:true,simulated:true};
 }}
 };
}

