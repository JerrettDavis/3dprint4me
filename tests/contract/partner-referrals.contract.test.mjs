import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPartnerApplication } from '../../lib/partner-outreach/application.js';
import { partnerFixture,ACTIVE_ENV,TEST_NOW } from '../support/partner-fixture.mjs';
test('accepted reserved bonuses survive contact erasure, cap/pause/sunset and cannot double-award identity or payment evidence',async()=>{
 const f=await partnerFixture();
 try{
  let instant=new Date(TEST_NOW);
  const app=createPartnerApplication({database:f.database,env:ACTIVE_ENV,allowSyntheticOwner:true,now:()=>instant});
  const run=(actor,action,input,key=randomUUID())=>app.execute({actor,action,input,key});
  const rules=[{id:'lead',trigger:'qualified_lead',amountCents:500,maximumAwards:2,criteria:'A consenting, unique independent project contact.',qualifiesBy:'2026-12-31'},{id:'sale',trigger:'verified_sale',refundTreatment:'Earned awards have no automatic clawback; resolve disputes separately with evidence.',amountCents:2000,maximumAwards:1,criteria:'Independent full settlement verified after opt-in attribution; refunds reviewed.',qualifiesBy:'2026-12-31'}];
  const terms={title:'Introductions',feeCents:5000,maximumBonusCents:3000,bonusRules:rules,tasks:['Permitted introductions'],materials:[],area:'Tulsa',deadline:'2026-12-01'};
  const campaign=await run(f.owner,'campaign.create',{programId:f.programId,terms});await run(f.owner,'campaign.publish',{campaignId:campaign.id,expectedRevision:1});
  async function accept(){const offer=await run(f.owner,'gig.offer',{campaignId:campaign.id,partnerId:f.partnerId});const accepted=await run(f.actor,'gig.accept',{gigId:offer.id,expectedRevision:1});assert.ok(accepted.referral.code);return {offer,accepted};}
  const first=await accept(),second=await accept();
  async function qualify(gig,business,email,phone){
   const visit=await run(f.actor,'visit.record',{gigId:gig.id,expectedGigRevision:2,clientId:randomUUID(),businessName:business,outcome:'interested',placement:'none',sampleCount:0,visitedAt:TEST_NOW,consent:true,contact:{email,phone,preferredContact:'email'},consentPurpose:'Project follow-up requested at this business'});
   const review=await run(f.owner,'lead.review',{leadId:visit.leadId,expectedRevision:1,decision:'qualified',reason:'Permission and independent project interest confirmed'});assert.ok(review.qualificationId);return {visit,review};
  }
  const q=await qualify(first.offer,'Synthetic Coffee','coffee@example.test','5555550101');
  await run(f.actor,'lead.withdraw',{leadId:q.visit.leadId,expectedRevision:2});await run(f.actor,'lead.delete',{leadId:q.visit.leadId,expectedRevision:3});
  const alias=await qualify(second.offer,'Synthetic Alias','new@example.test','5555550101');
  const requestId='rq_'+randomUUID();
  await f.database.query`INSERT INTO service_requests(id,service,project_title,contact_name,contact_email,status,created_at) VALUES(${requestId},'print','Synthetic order','Synthetic customer','customer@example.test','quoted',${TEST_NOW})`;
  const attribution=await run(f.owner,'referral.attribute',{referralId:first.accepted.referral.id,requestId,consentedAt:TEST_NOW,consentVerified:true,independentCustomerConfirmed:true,evidenceReference:'Synthetic customer opt-in record'});
  assert.equal((await app.read(f.actor,'referrals')).awards.length,0);
  const saleBase={referralId:first.accepted.referral.id,attributionId:attribution.id,amountCents:10000,paymentReference:'bank:synthetic:transaction-1',method:'bank_transfer',settledAt:TEST_NOW,settlementVerified:true,paidInFull:true,refundsReviewed:true,independentCustomerConfirmed:true};
  await assert.rejects(run(f.owner,'referral.verify_sale',{...saleBase,paymentReference:'https://checkout.example/return?paid=1'}),{status:400});
  await assert.rejects(run(f.owner,'referral.verify_sale',{...saleBase,paidInFull:false}),{status:400});
  await assert.rejects(run(f.owner,'referral.award',{referralId:first.accepted.referral.id,ruleId:'sale',saleEvidenceId:randomUUID(),criteriaConfirmed:true,antiFraudConfirmed:true}),{status:404});
  await run(f.actor,'profile.update',{expectedRevision:1,email:'customer@example.test'});
  await assert.rejects(run(f.owner,'referral.verify_sale',saleBase),{status:409});
  await f.database.query`UPDATE service_requests SET contact_email='changed@example.test' WHERE id=${requestId}`;
  await assert.rejects(run(f.owner,'referral.verify_sale',saleBase),{status:409});
  await run(f.actor,'profile.update',{expectedRevision:2,email:'participant@example.test'});
  await f.database.query`UPDATE service_requests SET contact_email='participant@example.test' WHERE id=${requestId}`;
  await assert.rejects(run(f.owner,'referral.verify_sale',saleBase),{status:409});
  await f.database.query`UPDATE service_requests SET contact_email='customer@example.test' WHERE id=${requestId}`;
  const sale=await run(f.owner,'referral.verify_sale',saleBase);
  const saleAward={referralId:first.accepted.referral.id,ruleId:'sale',saleEvidenceId:sale.id,criteriaConfirmed:true,antiFraudConfirmed:true};
  await run(f.actor,'profile.update',{expectedRevision:3,email:'customer@example.test'});
  await assert.rejects(run(f.owner,'referral.award',saleAward),{status:409});
  await f.database.query`UPDATE service_requests SET contact_email='changed@example.test' WHERE id=${requestId}`;
  await assert.rejects(run(f.owner,'referral.award',saleAward),{status:409});
  await run(f.actor,'profile.update',{expectedRevision:4,email:'participant@example.test'});
  await f.database.query`UPDATE service_requests SET contact_email='participant@example.test' WHERE id=${requestId}`;
  await assert.rejects(run(f.owner,'referral.award',saleAward),{status:409});
  await f.database.query`UPDATE service_requests SET contact_email='customer@example.test' WHERE id=${requestId}`;
  await assert.rejects(run(f.owner,'referral.verify_sale',{...saleBase,paymentReference:'BANK:SYNTHETIC:TRANSACTION-1'}),{status:409});
  const replacement=await run(f.owner,'campaign.create',{programId:f.programId,terms:{...terms,maximumBonusCents:2000,bonusRules:rules.map(rule=>rule.id==='sale'?{...rule,amountCents:1000}:rule)}});
  await run(f.owner,'campaign.publish',{campaignId:replacement.id,expectedRevision:1});
  await f.database.query`UPDATE partner_programs SET enabled=false WHERE id=${f.programId}`;await f.database.query`UPDATE partner_program_weeks SET cap_cents=0 WHERE program_id=${f.programId}`;
  instant=new Date('2027-01-02T12:00:00Z');
  const leadInput={referralId:first.accepted.referral.id,ruleId:'lead',qualificationId:q.review.qualificationId,criteriaConfirmed:true,antiFraudConfirmed:true};
  const award=await run(f.owner,'referral.award',leadInput);assert.equal(award.amountCents,500);assert.deepEqual(await run(f.owner,'referral.award',leadInput),award);
  await assert.rejects(run(f.owner,'referral.award',{...leadInput,referralId:second.accepted.referral.id,qualificationId:alias.review.qualificationId}),{status:409});
  const paid=await run(f.owner,'referral.award',{referralId:first.accepted.referral.id,ruleId:'sale',saleEvidenceId:sale.id,criteriaConfirmed:true,antiFraudConfirmed:true});assert.equal(paid.amountCents,2000);
  assert.equal((await f.database.query`SELECT committed_cents FROM partner_program_weeks`)[0].committed_cents,16000);
  assert.equal((await f.database.query`SELECT sum(amount_cents)::int AS cents FROM partner_payables`)[0].cents,2500);
  instant=new Date(TEST_NOW);
  await assert.rejects(run(f.actor,'referral.award',leadInput),{status:403});
  const earnings=await app.read(f.actor,'earnings');assert.equal(earnings.totals.earnedBonusCents,2500);assert.equal(earnings.totals.contingentBonusCents,3500);
  const own=await app.read(f.actor,'referrals');assert.equal(own.awards.length,2);assert.ok(!JSON.stringify(own).includes('bank:'));assert.ok(!JSON.stringify(own).includes('customer@example.test'));
  assert.equal((await app.read(f.otherActor,'referrals')).items.length,0);
  await assert.rejects(f.database.query`UPDATE partner_referrals SET policy_snapshot='{}'::jsonb WHERE id=${first.accepted.referral.id}`);
 }finally{await f.close();}
});
test('participant identities, accepted award counts and qualification deadlines cannot be bypassed by owner assertions',async()=>{
 const f=await partnerFixture();
 try{
  let instant=new Date(TEST_NOW);const app=createPartnerApplication({database:f.database,env:ACTIVE_ENV,allowSyntheticOwner:true,now:()=>instant});
  const run=(actor,action,input)=>app.execute({actor,action,input,key:randomUUID()});
  const terms={title:'Introductions',feeCents:1000,maximumBonusCents:500,bonusRules:[{id:'lead',trigger:'qualified_lead',amountCents:500,maximumAwards:1,criteria:'Unique independent project contact only.',qualifiesBy:'2026-12-01'}],tasks:['Permitted introductions'],materials:[],area:'Tulsa',deadline:'2026-12-01'};
  const c=await run(f.owner,'campaign.create',{programId:f.programId,terms});await run(f.owner,'campaign.publish',{campaignId:c.id,expectedRevision:1});
  const offer=await run(f.owner,'gig.offer',{campaignId:c.id,partnerId:f.partnerId}),accepted=await run(f.actor,'gig.accept',{gigId:offer.id,expectedRevision:1});
  async function visit(email){return run(f.actor,'visit.record',{gigId:offer.id,expectedGigRevision:2,clientId:randomUUID(),businessName:email,outcome:'interested',placement:'none',visitedAt:TEST_NOW,consent:true,contact:{email,preferredContact:'email'},consentPurpose:'Independent project follow-up'});}
  async function review(v){return run(f.owner,'lead.review',{leadId:v.leadId,expectedRevision:1,decision:'qualified',reason:'Permission and interest reviewed'});}
  const award=q=>run(f.owner,'referral.award',{referralId:accepted.referral.id,ruleId:'lead',qualificationId:q.qualificationId,criteriaConfirmed:true,antiFraudConfirmed:true});
  await run(f.actor,'profile.update',{expectedRevision:1,email:'participant@example.test'});
  const self=await review(await visit('participant@example.test'));
  await run(f.actor,'profile.update',{expectedRevision:2,email:''});
  await assert.rejects(award(self),{status:409});
  const first=await review(await visit('first@example.test')),second=await review(await visit('second@example.test')),late=await visit('late@example.test');
  instant=new Date('2026-12-02T12:00Z');const lateReview=await review(late);await assert.rejects(award(lateReview),{status:409});
  assert.equal((await award(first)).amountCents,500);await assert.rejects(award(second),{status:409});
  assert.equal((await f.database.query`SELECT count(*)::int AS n FROM partner_referral_events`)[0].n,1);
 }finally{await f.close();}
});


test('web referral permission binds the selected code and server receipt time without creating a bonus',async()=>{
 const f=await partnerFixture();try{
  let instant=new Date(TEST_NOW);const app=createPartnerApplication({database:f.database,env:ACTIVE_ENV,allowSyntheticOwner:true,now:()=>instant});
  const run=(actor,action,input)=>app.execute({actor,action,input,key:randomUUID()});
  const terms={title:'Web referrals',feeCents:1000,maximumBonusCents:500,bonusRules:[{id:'sale',trigger:'verified_sale',amountCents:500,maximumAwards:1,criteria:'Independent settled sale.',qualifiesBy:'2026-12-31',refundTreatment:'Owner reviews refunds separately.'}],tasks:['Permitted introductions'],materials:[],area:'Tulsa',deadline:'2026-12-01'};
  const campaign=await run(f.owner,'campaign.create',{programId:f.programId,terms});await run(f.owner,'campaign.publish',{campaignId:campaign.id,expectedRevision:1});
  const gig=await run(f.owner,'gig.offer',{campaignId:campaign.id,partnerId:f.partnerId});const accepted=await run(f.actor,'gig.accept',{gigId:gig.id,expectedRevision:1});
  instant=new Date(new Date(TEST_NOW).getTime()+30000);const received=instant.toISOString(),requestId='rq_'+randomUUID();
  const input={referralId:accepted.referral.id,requestId,consentedAt:TEST_NOW,consentVerified:true,independentCustomerConfirmed:true,evidenceReference:'Private web request permission'};
  const payload={source:'3dprint4.me',submittedAt:received,referral:{code:'notTheChosenCode',consent:true,consentVersion:'referral-v1'}};
  await f.database.query`INSERT INTO service_requests(id,service,project_title,contact_name,contact_email,status,payload,created_at) VALUES(${requestId},'consult','Synthetic','Customer','web@example.test','quoted',${JSON.stringify(payload)}::jsonb,${TEST_NOW})`;
  await assert.rejects(run(f.owner,'referral.attribute',input),{status:409});
  const chosen=payload.referral;delete payload.referral;
  await f.database.query`UPDATE service_requests SET payload=${JSON.stringify(payload)}::jsonb WHERE id=${requestId}`;
  await assert.rejects(run(f.owner,'referral.attribute',input),{status:409});
  payload.referral=chosen;
  payload.referral.code=accepted.referral.code;
  await f.database.query`UPDATE service_requests SET payload=${JSON.stringify(payload)}::jsonb WHERE id=${requestId}`;
  await assert.rejects(run(f.owner,'referral.attribute',input),{status:400});
  const result=await run(f.owner,'referral.attribute',{...input,consentedAt:received});assert.equal(result.status,'attributed_not_paid');
  assert.equal((await app.read(f.actor,'referrals')).awards.length,0);
 }finally{await f.close();}
});
