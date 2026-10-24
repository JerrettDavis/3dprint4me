import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createPartnerApplication } from '../../lib/partner-outreach/application.js';
import { createOwnerAuthorizer } from '../../lib/partner-outreach/http.js';
import { storedLegalVersion,renderLegalVersion } from '../../lib/partner-outreach/legal-content.js';
import { digest } from '../../lib/partner-outreach/postgres-repository.js';
import { splitStatements,MIGRATIONS } from '../../scripts/migrate-neon.mjs';
import { createNativeDatabase, nativePoolOptions } from '../../lib/database.js';
import { createPostgresPartnerRepository } from '../../lib/partner-outreach/postgres-repository.js';

const IMAGE='postgres:18@sha256:edb0c08dc33befd0262ab3b5cf1c4f3f8cfd8b09e88c05b45adee29d6761ddb6';
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:90000,stdio:['pipe','pipe','pipe']}).trim();

test('native PostgreSQL 18 enforces permissions, concurrent ceilings, replay and additive restore', {timeout:120000}, async()=>{
 const name='3dprint4me-partner-test-'+randomUUID().slice(0,8);
 let admin, database, started=false;
 try {
  docker('run','--detach','--rm','--name',name,'--label','3dprint4me.purpose=partner-integration','--publish','127.0.0.1::5432','--env','POSTGRES_HOST_AUTH_METHOD=trust',IMAGE);
  started=true;
  const inspect=JSON.parse(docker('inspect',name))[0];
  const port=inspect.NetworkSettings.Ports['5432/tcp'][0].HostPort;
  const url=`postgresql://postgres@127.0.0.1:${port}/postgres`;
  admin=new pg.Pool(nativePoolOptions(url));
  let ready=false;
  for(let i=0;i<80;i++){try {await admin.query('SELECT 1');ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}}
  assert.equal(ready,true,'isolated database becomes ready');
  await admin.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC; CREATE ROLE platform_backend NOLOGIN; CREATE ROLE platform_app LOGIN IN ROLE platform_backend; CREATE ROLE partner_visitor LOGIN; GRANT USAGE ON SCHEMA public TO platform_backend');
  for(const file of MIGRATIONS)for(const statement of splitStatements(await readFile(new URL('../../neon/migrations/'+file,import.meta.url),'utf8')))await admin.query(statement);
  for(const statement of splitStatements(await readFile(new URL('../../neon/migrations/012_partner_outreach.sql',import.meta.url),'utf8')))await admin.query(statement);
  const programId=randomUUID(),campaignId=randomUUID(),partners=[randomUUID(),randomUUID()],gigs=[randomUUID(),randomUUID()];
  await admin.query("INSERT INTO partner_programs(id,label,starts_on,enabled,synthetic) VALUES($1,'Synthetic','2026-10-01',true,true)",[programId]);
  await admin.query("INSERT INTO partner_campaigns(id,program_id,title,terms,status) VALUES($1,$2,'Visits','{}','published')",[campaignId,programId]);
  const terms={title:'Visits',feeCents:15000,maximumBonusCents:0,tasks:['Visits'],materials:[],area:'Tulsa',deadline:'2026-12-01'};
  for(let i=0;i<2;i++){
   await admin.query("INSERT INTO partner_accounts(id,program_id,display_name,status) VALUES($1,$2,'Synthetic','active')",[partners[i],programId]);
   await admin.query("INSERT INTO partner_gigs(id,program_id,partner_id,campaign_id,terms_snapshot,status) VALUES($1,$2,$3,$4,$5,'offered')",[gigs[i],programId,partners[i],campaignId,JSON.stringify(terms)]);
  }
  const pool=new pg.Pool(nativePoolOptions(url.replace('postgres@','platform_app@')));
  database=createNativeDatabase({pool});
  const repo=createPostgresPartnerRepository({database});
  const ownerToken='o'.repeat(43),ownerEnv={OPERATOR_OWNER_SUBJECT:'2610199',PARTNER_PROGRAM_ENABLED:'1',PARTNER_CLASSIFICATION_APPROVED:'1',PARTNER_ACCOUNTING_APPROVED:'1'};
  await admin.query("INSERT INTO operators(id,auth_user_id,display_name,role) VALUES('op_native','github:2610199','Synthetic owner','owner')");
  await admin.query("INSERT INTO operator_identity_bindings(issuer,subject,operator_id) VALUES('https://github.com/','2610199','op_native')");
  await admin.query("INSERT INTO operator_sessions(token_hash,operator_id,issuer,subject,expires_at) VALUES($1,'op_native','https://github.com/','2610199','2026-10-24T12:00Z')",[digest(ownerToken)]);
  const ownerSession=await createOwnerAuthorizer({query:database.query,env:ownerEnv,now:()=>new Date('2026-10-23T12:00Z')})({headers:{cookie:'__Host-3dp-session='+ownerToken}});
  const app=createPartnerApplication({database,env:ownerEnv,now:()=>new Date('2026-10-23T12:00Z')});
  const created=await app.execute({actor:ownerSession.actor,action:'partner.create',input:{programId,displayName:'Synthetic invited'},key:randomUUID()});
  assert.equal(created.status,'invited');
  await admin.query("UPDATE operators SET role='operator' WHERE id='op_native'");
  await assert.rejects(app.execute({actor:ownerSession.actor,action:'partner.create',input:{programId,displayName:'Denied'},key:randomUUID()}),{status:403});
  await admin.query("UPDATE operators SET role='owner' WHERE id='op_native'");
  const accept=(index,key=randomUUID())=>{
   const actor={role:'PARTNER',id:partners[index]};
   return repo.withCommand({actor,operation:'accept',key,payload:{gigId:gigs[index],revision:1}},tx=>repo.reserveGig(tx,{actor,gigId:gigs[index],expectedRevision:1,instant:'2026-10-23T12:00:00Z',authorizationApproved:true}));
  };
  const outcomes=await Promise.allSettled([accept(0),accept(1)]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(outcomes.find(x=>x.status==='rejected').reason.status,409);
  assert.equal((await admin.query('SELECT committed_cents FROM partner_program_weeks')).rows[0].committed_cents,15000);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM partner_budget_reservations')).rows[0].n,1);
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM partner_gigs WHERE status='offered'")).rows[0].n,1);
  const winner=outcomes.findIndex(x=>x.status==='fulfilled'),loser=1-winner;
  // A separate week lets the second offer test simultaneous identical commands.
  await admin.query('UPDATE partner_program_weeks SET cap_cents=40000');
  const replayKey=randomUUID();
  const [one,two]=await Promise.all([accept(loser,replayKey),accept(loser,replayKey)]);
  assert.deepEqual(one,two);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM partner_budget_reservations')).rows[0].n,2);
  assert.equal((await admin.query('SELECT committed_cents FROM partner_program_weeks')).rows[0].committed_cents,30000);
  const raceGig=randomUUID(),raceTerms={...terms,feeCents:5000};
  await admin.query("INSERT INTO partner_gigs(id,program_id,partner_id,campaign_id,terms_snapshot,status) VALUES($1,$2,$3,$4,$5,'offered')",[raceGig,programId,partners[0],campaignId,JSON.stringify(raceTerms)]);
  const raceActor={role:'PARTNER',id:partners[0]};
  const race=await Promise.allSettled([
   app.execute({actor:ownerSession.actor,action:'gig.withdraw',input:{gigId:raceGig,expectedRevision:1},key:randomUUID()}),
   repo.withCommand({actor:raceActor,operation:'accept',key:randomUUID(),payload:{gigId:raceGig,revision:1}},tx=>repo.reserveGig(tx,{actor:raceActor,gigId:raceGig,expectedRevision:1,instant:'2026-10-23T12:00:00Z',authorizationApproved:true}))
  ]);
  assert.equal(race.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(race.find(result=>result.status==='rejected').reason.status,409);
  let expectedCommitted=30000+(race[1].status==='fulfilled'?5000:0);
  let expectedAccepts=2+(race[1].status==='fulfilled'?1:0);
  await assert.rejects(pool.query('DELETE FROM partner_accounts'),e=>e.code==='42501');
  await assert.rejects(pool.query('UPDATE partner_budget_reservations SET amount_cents=0'),e=>e.code==='42501');
  const visitor=new pg.Pool(nativePoolOptions(url.replace('postgres@','partner_visitor@')));
  try{for(const table of ['partner_accounts','partner_legal_versions','partner_payment_events'])await assert.rejects(visitor.query('SELECT * FROM '+table),e=>e.code==='42501');}finally{await visitor.end();}
  const payableId=randomUUID();
  await admin.query('INSERT INTO partner_payables(id,partner_id,gig_id,amount_cents) VALUES($1,$2,$3,15000)',[payableId,partners[winner],gigs[winner]]);
  await assert.rejects(pool.query('SELECT id FROM partner_payables FOR UPDATE'),e=>e.code==='42501');
  const financial=(action,input)=>app.execute({actor:ownerSession.actor,action,input,key:randomUUID()});
  const paymentInput=ref=>({payableId,amountCents:10000,paymentReference:ref,method:'bank_transfer',occurredAt:'2026-10-23T12:00:00Z',verified:true});
  const paymentRace=await Promise.allSettled([financial('payment.record',paymentInput('NATIVE-BANK-A')),financial('payment.record',paymentInput('NATIVE-BANK-B'))]);
  if(!paymentRace.some(x=>x.status==='fulfilled'))console.error('Synthetic payment failures',paymentRace.map(x=>({status:x.reason?.status,message:x.reason?.message})));
  assert.equal(paymentRace.filter(x=>x.status==='fulfilled').length,1);assert.equal(paymentRace.find(x=>x.status==='rejected').reason.status,409);
  const usedReference=paymentRace[0].status==='fulfilled'?'native-bank-a':'native-bank-b';
  await assert.rejects(financial('payment.record',{...paymentInput(usedReference),amountCents:1000}),{status:409});
  const paid=await financial('payment.record',{...paymentInput('NATIVE-BANK-C'),amountCents:5000});
  await financial('payment.reverse',{paymentId:paid.id,paymentReference:'NATIVE-RETURN-C',occurredAt:'2026-10-23T12:00:00Z',verifiedNotSettled:true,reason:'Synthetic returned transfer'});
  const adjustment=ref=>({payableId,amountCents:-4000,reason:'Synthetic external resolution',resolutionReference:ref,partnerAcknowledged:true,verifiedResolution:true});
  const adjustmentRace=await Promise.allSettled([financial('payable.adjust',adjustment('RESOLUTION-A')),financial('payable.adjust',adjustment('RESOLUTION-B'))]);
  assert.equal(adjustmentRace.filter(x=>x.status==='fulfilled').length,1);assert.equal(adjustmentRace.find(x=>x.status==='rejected').reason.status,409);
  const exportRace=await Promise.all([financial('finance.export',{programId,basis:'cash'}),financial('finance.export',{programId,basis:'cash'})]);
  assert.deepEqual(exportRace.map(x=>x.recordCount).sort((a,b)=>a-b),[0,3]);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM partner_export_entries')).rows[0].n,3);
  await assert.rejects(pool.query('DELETE FROM partner_payable_adjustments'),e=>e.code==='42501');
  const financeView=await app.read(ownerSession.actor,'ledger',{programId});
  assert.equal(financeView.totals.paidCents,10000);assert.equal(financeView.totals.outstandingCents,1000);assert.equal(financeView.totals.unfundedObligationCents,0);
  const legal=await financial('legal.save',{programId,templateKey:'independent-marketing-services',title:'Synthetic reviewed terms',markdown:'# Reviewed terms\n## [IMS-01] Scope\nSynthetic isolated test.',variablesSchema:{},issuable:true,requiredScopes:['solicitation_policy'],expectedRevision:0,changeReason:'Native privilege and restore fixture'});
  const reviewPackage=randomUUID(),reviewers=[{name:'Synthetic counsel',role:'attorney',scopes:['classification','agreement_language','solicitation_policy']},{name:'Synthetic accountant',role:'cpa',scopes:['accounting']}];
  await admin.query("INSERT INTO partner_review_packages(id,version_id,manifest,created_by,created_at,expires_at) VALUES($1,$2,$3,'op_native','2026-10-23T12:00Z','2026-10-24T12:00Z')",[reviewPackage,legal.versionId,JSON.stringify({versions:[legal.versionId],reviewers})]);
  for(const scope of ['classification','agreement_language','solicitation_policy','accounting'])await financial('legal.record_review',{programId,packageId:reviewPackage,versionId:legal.versionId,versionHash:legal.hash,scope,decision:'approved',reviewerName:scope==='accounting'?'Synthetic accountant':'Synthetic counsel',reviewerRole:scope==='accounting'?'cpa':'attorney',evidenceReference:'SYNTHETIC-NATIVE-'+scope,reviewedAt:'2026-10-23T12:00:00Z'});
  await financial('legal.publish',{programId,versionId:legal.versionId,expectedRevision:1});
  await financial('program.configure',{programId,expectedRevision:1,contractVersionId:legal.versionId,policyVersionId:legal.versionId,enabled:true});
  const issue=await financial('legal.issue',{programId,versionId:legal.versionId,versionHash:legal.hash,partnerId:partners[winner],bindings:{}});
  const partnerSession=randomUUID();
  await admin.query("INSERT INTO partner_sessions(id,partner_id,token_hash,csrf_hash,credential_version,expires_at,absolute_expires_at,created_at) VALUES($1,$2,$3,$4,1,'2026-10-30T12:00Z','2026-11-22T12:00Z','2026-10-23T12:00Z')",[partnerSession,partners[winner],digest('native-partner-session'),digest('native-partner-csrf')]);
  const actualPartner={role:'PARTNER',id:partners[winner],sessionId:partnerSession,credentialVersion:1};
  await app.execute({actor:actualPartner,action:'agreement.acknowledge',input:{issueId:issue.id,snapshotHash:issue.snapshotHash,readAcknowledgment:true},key:randomUUID()});
  const approvedCampaign=await financial('campaign.create',{programId,terms:{...terms,feeCents:1000}});await financial('campaign.publish',{campaignId:approvedCampaign.id,expectedRevision:1});
  const approvedOffer=await financial('gig.offer',{campaignId:approvedCampaign.id,partnerId:partners[winner]});
  const boundAcceptance=await app.execute({actor:actualPartner,action:'gig.accept',input:{gigId:approvedOffer.id,expectedRevision:1},key:randomUUID()});assert.equal(boundAcceptance.agreementIssueId,issue.id);
  expectedCommitted+=1000;expectedAccepts++;
  await financial('legal.save',{programId,templateKey:'independent-marketing-services',title:'Synthetic reviewed terms',markdown:'# DRAFT amendment\nNew unreviewed text.',variablesSchema:{},issuable:false,expectedRevision:2,changeReason:'Must not mutate old issue'});
  assert.equal((await app.approvals.status(database,programId,new Date('2026-10-23T12:00Z'))).allowed,false);
  const expectedCommands=(await admin.query('SELECT count(*)::int AS n FROM partner_command_keys')).rows[0].n;
  await admin.query('CREATE DATABASE partner_restore');
  // Only this synthetic disposable container is touched. Stream the dump as
  // bytes, never a filesystem export or a production connection.
  const dump=execFileSync('docker',['exec',name,'pg_dump','-U','postgres','-Fc','postgres'],{timeout:30000,maxBuffer:20*1024*1024});
  execFileSync('docker',['exec','-i',name,'pg_restore','-U','postgres','-d','partner_restore','--exit-on-error'],{input:dump,timeout:30000});
  const restoreUrl=new URL(url);restoreUrl.pathname='/partner_restore';
  const restored=new pg.Pool(nativePoolOptions(restoreUrl.toString()));
  try{
   assert.equal((await restored.query('SELECT committed_cents FROM partner_program_weeks')).rows[0].committed_cents,expectedCommitted);
   assert.equal((await restored.query('SELECT count(*)::int AS n FROM partner_command_keys')).rows[0].n,expectedCommands);
   assert.equal((await restored.query("SELECT count(*)::int AS n FROM partner_audit_events WHERE action='gig.accepted'")).rows[0].n,expectedAccepts);
   assert.equal((await restored.query('SELECT sum(amount_cents)::int AS cents FROM partner_payment_events')).rows[0].cents,10000);
   assert.equal((await restored.query('SELECT sum(amount_cents)::int AS cents FROM partner_payable_adjustments')).rows[0].cents,-4000);
   assert.equal((await restored.query('SELECT count(*)::int AS n FROM partner_export_entries')).rows[0].n,3);
   await assert.rejects(restored.query('UPDATE partner_budget_reservations SET amount_cents=0'),/immutable/i);
   await assert.rejects(restored.query('DELETE FROM partner_payable_adjustments'),/immutable/i);
   assert.equal((await restored.query('SELECT snapshot_sha256 FROM partner_agreement_issues WHERE id=$1',[issue.id])).rows[0].snapshot_sha256,issue.snapshotHash);
   assert.equal((await restored.query('SELECT snapshot_sha256 FROM partner_agreement_acknowledgments WHERE issue_id=$1',[issue.id])).rows[0].snapshot_sha256,issue.snapshotHash);
   const restoredVersion=(await restored.query('SELECT * FROM partner_legal_versions WHERE id=$1',[legal.versionId])).rows[0];
   assert.equal(storedLegalVersion(restoredVersion).hash,legal.hash);
   const restoredIssue=(await restored.query('SELECT * FROM partner_agreement_issues WHERE id=$1',[issue.id])).rows[0];
   assert.equal(renderLegalVersion(storedLegalVersion(restoredVersion),restoredIssue.bindings).hash,restoredIssue.snapshot_sha256);
   assert.equal((await restored.query('SELECT count(*)::int AS n FROM partner_legal_reviews WHERE package_id=$1',[reviewPackage])).rows[0].n,4);
  }finally{await restored.end();}
 }finally{
  await database?.close();await admin?.end();
  // Fixed prefix, fresh UUID and ownership label prevent touching other stacks.
  const owned=started?JSON.parse(docker('inspect',name))[0]:null;
  if(owned?.Config.Labels['3dprint4me.purpose']==='partner-integration')docker('stop',name);
 }
});
