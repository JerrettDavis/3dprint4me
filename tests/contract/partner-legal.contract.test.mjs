import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPartnerApplication } from '../../lib/partner-outreach/application.js';
import { partnerFixture,ACTIVE_ENV,TEST_NOW } from '../support/partner-fixture.mjs';
test('legal editing, scoped review and issued read acknowledgments preserve every prior hash and snapshot',async()=>{
 const f=await partnerFixture();
 try{
  const app=createPartnerApplication({database:f.database,env:ACTIVE_ENV,allowSyntheticOwner:true,now:()=>new Date(TEST_NOW)});
  const run=(actor,action,input)=>app.execute({actor,action,input,key:randomUUID()});
  const draft={programId:f.programId,templateKey:'independent-marketing-services',title:'Services terms',markdown:'# DRAFT FOR REVIEW\n## [IMS-04] Fee\n${{gig_fee_usd}}',variablesSchema:{gig_fee_usd:{type:'money',required:true,default:5000}},issuable:false,expectedRevision:0,changeReason:'Initial synthetic draft'};
  const a=await run(f.owner,'legal.save',draft);
  await assert.rejects(run(f.owner,'legal.publish',{programId:f.programId,versionId:a.versionId,expectedRevision:1}),{status:409});
  const b=await run(f.owner,'legal.save',{...draft,markdown:draft.markdown+'\nAdditional review point.',expectedRevision:1});assert.notEqual(b.hash,a.hash);
  await assert.rejects(run(f.owner,'legal.save',{...draft,expectedRevision:1}),{status:409});
  const final=await run(f.owner,'legal.save',{...draft,markdown:'# Services terms\n## [IMS-04] Agreed fee\n${{gig_fee_usd}}',issuable:true,expectedRevision:2,changeReason:'Synthetic final version for isolated testing'});
  const packageId=randomUUID(),reviewers=[{name:'Synthetic counsel',role:'attorney',scopes:['classification','agreement_language']},{name:'Synthetic accountant',role:'cpa',scopes:['accounting']}];
  await f.database.query`INSERT INTO partner_review_packages(id,version_id,manifest,created_by,created_at,expires_at) VALUES(${packageId},${final.versionId},${JSON.stringify({versions:[final.versionId],reviewers})}::jsonb,${f.owner.id},${TEST_NOW},'2026-10-24T12:00Z')`;
  const review=scope=>({programId:f.programId,packageId,versionId:final.versionId,versionHash:final.hash,scope,decision:'approved',reviewerName:scope==='accounting'?'Synthetic accountant':'Synthetic counsel',reviewerRole:scope==='accounting'?'cpa':'attorney',evidenceReference:'SYNTHETIC-REVIEW-'+scope,reviewedAt:TEST_NOW,notes:'Synthetic fixture only'});
  await assert.rejects(run(f.owner,'legal.record_review',{...review('agreement_language'),versionHash:b.hash}),{status:409});
  await assert.rejects(run(f.owner,'legal.record_review',{...review('accounting'),reviewerRole:'attorney'}),{status:403});
  for(const scope of ['classification','agreement_language','accounting'])await run(f.owner,'legal.record_review',review(scope));
  await run(f.owner,'legal.publish',{programId:f.programId,versionId:final.versionId,expectedRevision:3});
  await run(f.owner,'program.configure',{programId:f.programId,expectedRevision:1,contractVersionId:final.versionId,enabled:true});
  const issue=await run(f.owner,'legal.issue',{programId:f.programId,versionId:final.versionId,versionHash:final.hash,partnerId:f.partnerId,bindings:{gig_fee_usd:5000}});
  await assert.rejects(run(f.otherActor,'agreement.acknowledge',{issueId:issue.id,snapshotHash:issue.snapshotHash,readAcknowledgment:true}),{status:404});
  await run(f.actor,'agreement.acknowledge',{issueId:issue.id,snapshotHash:issue.snapshotHash,readAcknowledgment:true});
  await assert.rejects(run(f.actor,'agreement.acknowledge',{issueId:issue.id,snapshotHash:'a'.repeat(64),readAcknowledgment:true}),{status:409});
  const newer=await run(f.owner,'legal.save',{...draft,markdown:draft.markdown+'\nNew unreviewed amendment.',expectedRevision:4});
  await assert.rejects(run(f.owner,'legal.issue',{programId:f.programId,versionId:newer.versionId,versionHash:newer.hash,partnerId:f.partnerId,bindings:{gig_fee_usd:5000}}),{status:409});
  const rollback=await run(f.owner,'legal.save',{...draft,markdown:'# Services terms\n## [IMS-04] Agreed fee\n${{gig_fee_usd}}',issuable:true,expectedRevision:5,changeReason:'Restore prior text as a new revision'});
  assert.equal(rollback.hash,final.hash);assert.notEqual(rollback.versionId,final.versionId);
  await assert.rejects(run(f.owner,'legal.publish',{programId:f.programId,versionId:rollback.versionId,expectedRevision:6}),{status:409});
  const listed=(await app.read(f.owner,'legal')).items.find(d=>d.id===a.documentId);assert.equal(listed.latest_version_id,rollback.versionId);
  const historicalComment=await run(f.owner,'legal.add_comment',{programId:f.programId,versionId:a.versionId,clauseAnchor:'IMS-04',body:'Historical clause concern still needs resolution.',reviewerId:'Synthetic counsel'});
  const latestDetails=await app.read(f.owner,'legal-version',{id:rollback.versionId});assert.ok(latestDetails.documentComments.some(c=>c.id===historicalComment.id&&c.version_no===1));
  const old=(await app.read(f.owner,'legal-version',{id:a.versionId})).version;assert.equal(old.content_sha256,a.hash);
  const issued=(await app.read(f.actor,'agreements')).items.find(row=>row.id===issue.id);assert.equal(issued.snapshot_sha256,issue.snapshotHash);assert.match(issued.snapshot_markdown,/50.00/);assert.ok(issued.acknowledged_at);
  const diff=await app.read(f.owner,'legal-diff',{id:a.versionId,compareTo:final.versionId});assert.ok(diff.changed);
  await assert.rejects(app.read(f.actor,'legal-version',{id:final.versionId}),{status:404});
 }finally{await f.close();}
});

test('new work requires an issue-ready reviewed agreement and the partner exact-version read acknowledgment',async()=>{
 const f=await partnerFixture({acknowledged:false});
 try{
  const app=createPartnerApplication({database:f.database,env:ACTIVE_ENV,allowSyntheticOwner:true,now:()=>new Date(TEST_NOW)}),run=(actor,action,input)=>app.execute({actor,action,input,key:randomUUID()});
  const terms={title:'Visits',feeCents:5000,maximumBonusCents:0,tasks:['Permitted introductions'],materials:[],area:'Tulsa',deadline:'2026-12-01'};
  const c=await run(f.owner,'campaign.create',{programId:f.programId,terms});await run(f.owner,'campaign.publish',{campaignId:c.id,expectedRevision:1});
  const gig=await run(f.owner,'gig.offer',{campaignId:c.id,partnerId:f.partnerId});
  await assert.rejects(run(f.actor,'gig.accept',{gigId:gig.id,expectedRevision:1}),{status:409});
  const [issue]=await f.database.query`SELECT id,snapshot_sha256 FROM partner_agreement_issues WHERE partner_id=${f.partnerId}`;
  await run(f.actor,'agreement.acknowledge',{issueId:issue.id,snapshotHash:issue.snapshot_sha256,readAcknowledgment:true});
  const accepted=await run(f.actor,'gig.accept',{gigId:gig.id,expectedRevision:1});assert.equal(accepted.agreementIssueId,issue.id);
  await assert.rejects(f.database.query`UPDATE partner_gigs SET agreement_issue_id=NULL WHERE id=${gig.id}`,/immutable/i);
 }finally{await f.close();}
 const draft=await partnerFixture({issuable:false});
 try{const app=createPartnerApplication({database:draft.database,env:ACTIVE_ENV,allowSyntheticOwner:true,now:()=>new Date(TEST_NOW)});assert.equal((await app.approvals.status(draft.database,draft.programId)).allowed,false);}finally{await draft.close();}
});

test('new clause concerns pause publication until resolved and republished',async()=>{
 const f=await partnerFixture();
 try{
  const app=createPartnerApplication({database:f.database,env:ACTIVE_ENV,allowSyntheticOwner:true,now:()=>new Date(TEST_NOW)}),run=(action,input)=>app.execute({actor:f.owner,action,input,key:randomUUID()});
  const version=await run('legal.save',{programId:f.programId,templateKey:'custom-terms',title:'Terms',markdown:'# Terms\n## [C-01] Scope\nVoluntary work.',variablesSchema:{},issuable:true,expectedRevision:0,changeReason:'Synthetic text'});
  const packageId=randomUUID();await f.database.query`INSERT INTO partner_review_packages(id,version_id,manifest,created_by,created_at,expires_at) VALUES(${packageId},${version.versionId},${JSON.stringify({versions:[version.versionId],reviewers:[{name:'Synthetic counsel',role:'attorney',scopes:['agreement_language']}]})}::jsonb,${f.owner.id},${TEST_NOW},'2026-10-24T12:00Z')`;
  await run('legal.record_review',{programId:f.programId,packageId,versionId:version.versionId,versionHash:version.hash,scope:'agreement_language',decision:'approved',reviewerName:'Synthetic counsel',reviewerRole:'attorney',evidenceReference:'SYNTHETIC-ONLY',reviewedAt:TEST_NOW});
  await run('legal.publish',{programId:f.programId,versionId:version.versionId,expectedRevision:1});
  const comment=await run('legal.add_comment',{programId:f.programId,versionId:version.versionId,clauseAnchor:'C-01',body:'Clarify the reviewed scope before further issuance.',reviewerId:'Synthetic counsel'});
  const issue={programId:f.programId,versionId:version.versionId,versionHash:version.hash,partnerId:f.partnerId,bindings:{}};
  await assert.rejects(run('legal.issue',issue),{status:409});
  await run('legal.resolve_comment',{programId:f.programId,commentId:comment.id,resolution:'Clarification confirmed in recorded reviewer discussion',resolvedByVersionId:version.versionId});
  await run('legal.publish',{programId:f.programId,versionId:version.versionId,expectedRevision:3});
  assert.ok((await run('legal.issue',issue)).snapshotHash);
 }finally{await f.close();}
});


test('legal concern history refuses an incomplete view instead of dropping later resolutions',async()=>{
 const f=await partnerFixture();try{
  const app=createPartnerApplication({database:f.database,env:ACTIVE_ENV,allowSyntheticOwner:true,now:()=>new Date(TEST_NOW)});
  const [version]=await f.database.query`SELECT id FROM partner_legal_versions LIMIT 1`;
  await f.database.query`INSERT INTO partner_legal_comments(id,version_id,clause_anchor,body,reviewer_id) SELECT gen_random_uuid(),${version.id},'preamble','Synthetic concern '||n::text,'Synthetic reviewer' FROM generate_series(1,1001) AS n`;
  await assert.rejects(app.read(f.owner,'legal-version',{id:version.id}),{status:409});
 }finally{await f.close();}
});
