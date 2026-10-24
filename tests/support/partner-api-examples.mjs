// Disposable synthetic application journeys for documentation validation only.
import assert from 'node:assert/strict';
import { randomUUID,generateKeyPairSync } from 'node:crypto';
import { partnerFixture,ACTIVE_ENV,TEST_NOW } from './partner-fixture.mjs';
import { createPartnerApplication } from '../../lib/partner-outreach/application.js';
import { createPartnerAuth } from '../../lib/partner-outreach/auth.js';
import { createReviewDocx } from '../../lib/partner-outreach/docx.js';
import { generateWeeklyStatements } from '../../lib/partner-outreach/statements.js';

const f=await partnerFixture(),examples=[];
const signing=generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'});
const app=createPartnerApplication({database:f.database,env:{...ACTIVE_ENV,PARTNER_REVIEW_SIGNING_PRIVATE_KEY:signing},now:()=>new Date(TEST_NOW),allowSyntheticOwner:true});
async function run(role,action,input,status=200){
 let result,actual=200;
 try{result=await app.execute({actor:role==='OWNER'?f.owner:f.actor,action,input,key:randomUUID()});}catch(error){actual=error.status??500;}
 assert.equal(actual,status,action);
 examples.push({role,action,input,status,...(status===200?{result}:{})});return result;
}
try{
 const program=await run('OWNER','program.create',{label:'Synthetic API example',startsOn:'2026-10-01'});
 await run('OWNER','program.configure',{programId:program.id,expectedRevision:1,enabled:false,weeklyCapCents:20000});
 await run('OWNER','program.week_cap',{programId:program.id,weekStart:'2026-10-19',capCents:20000,expectedRevision:0,reason:'Synthetic authorization example'});
 const account=await run('OWNER','partner.create',{programId:f.programId,displayName:'Synthetic invited partner'});
 const auth=createPartnerAuth({database:f.database,now:()=>new Date(TEST_NOW),canEnroll:async()=>true,verifyOwner:async()=>{}});
 await auth.issueInvite({actor:f.owner,partnerId:account.id});examples.push({role:'OWNER',action:'partner.invite',input:{partnerId:account.id},status:200});
 await auth.revoke({actor:f.owner,partnerId:account.id,status:'suspended'});examples.push({role:'OWNER',action:'partner.revoke',input:{partnerId:account.id,status:'suspended'},status:200});
 const terms={title:'Synthetic API offer',feeCents:5000,maximumBonusCents:300,bonusRules:[{id:'qualified-introduction',trigger:'qualified_lead',amountCents:300,maximumAwards:1,criteria:'Independent consented introduction',qualifiesBy:'2026-12-31'}],tasks:['Permitted introduction'],materials:['Sample sign'],area:'Tulsa',deadline:'2026-12-01'};
 const campaign=await run('OWNER','campaign.create',{programId:f.programId,terms});
 await run('OWNER','campaign.publish',{campaignId:campaign.id,expectedRevision:1});
 const gig=await run('OWNER','gig.offer',{campaignId:campaign.id,partnerId:f.partnerId});
 const accepted=await run('PARTNER','gig.accept',{gigId:gig.id,expectedRevision:1});
 await run('OWNER','material.record',{gigId:gig.id,eventType:'issued',items:[{label:'Sample sign',count:5}]});
 await run('OWNER','material.record',{gigId:gig.id,eventType:'returned',items:[{label:'Sample sign',count:2}]});
 await run('OWNER','material.record',{gigId:gig.id,eventType:'returned',items:[{label:'Sample sign',count:0}]},400);
 // Structural schemas cannot establish the full-history balance: this shape is
 // valid JSON but the actual server rejects the excessive return with 409.
 await run('OWNER','material.record',{gigId:gig.id,eventType:'returned',items:[{label:'Sample sign',count:4}]},409);
 const visit={gigId:gig.id,expectedGigRevision:2,clientId:randomUUID(),businessName:'Synthetic shop',outcome:'interested',placement:'none',sampleCount:0,visitedAt:TEST_NOW,consent:false};
 await run('PARTNER','visit.record',visit);
 await run('PARTNER','visit.record',{...visit,clientId:randomUUID(),businessName:'Other synthetic shop',contact:{name:'Synthetic contact',email:'synthetic@example.invalid',preferredContact:'email'}},422);
 const consented=await run('PARTNER','visit.record',{...visit,clientId:randomUUID(),businessName:'Synthetic consented shop',consent:true,consentPurpose:'Synthetic requested project follow-up',contact:{name:'Synthetic contact',email:'synthetic@example.invalid',preferredContact:'email'}});
 const qualified=await run('OWNER','lead.review',{leadId:consented.leadId,expectedRevision:1,decision:'qualified',reason:'Synthetic permission and independent contact reviewed'});
 await run('OWNER','referral.award',{referralId:accepted.referral.id,ruleId:'qualified-introduction',qualificationId:qualified.qualificationId,criteriaConfirmed:true,antiFraudConfirmed:true});
 await run('PARTNER','gig.submit',{gigId:gig.id,expectedRevision:2});
 await run('OWNER','gig.approve',{gigId:gig.id,expectedRevision:3});
 await run('OWNER','gig.make_payable',{gigId:gig.id,expectedRevision:4});
 const [payable]=await f.database.query`SELECT id FROM partner_payables WHERE gig_id=${gig.id}`;
 await run('OWNER','payment.record',{payableId:payable.id,amountCents:1000,paymentReference:'SYNTHETIC-ONLY',method:'bank_transfer',occurredAt:TEST_NOW,verified:false},400);
 const payment=await run('OWNER','payment.record',{payableId:payable.id,amountCents:1000,paymentReference:'SYNTHETIC-ONLY',method:'bank_transfer',occurredAt:TEST_NOW,verified:true});
 await run('OWNER','payment.reverse',{paymentId:payment.id,paymentReference:'SYNTHETIC-REVERSAL',occurredAt:TEST_NOW,verifiedNotSettled:true,reason:'Synthetic returned payment'});
 await run('PARTNER','profile.update',{expectedRevision:1,notificationOptOut:true,preferredContact:'none',accessibility:null});
 await run('PARTNER','statement.export',{});
 await run('OWNER','statement.export',{partnerId:f.partnerId});
 await run('PARTNER','profile.export',{});
 const accounting=await run('OWNER','finance.export',{programId:f.programId,basis:'cash'});
 await run('OWNER','statement.schedule',{programId:f.programId,expectedRevision:1,enabled:true});
 const activity=await run('PARTNER','activity.start',{});
 for(const [action,revision]of [['pause',1],['resume',2],['stop',3],['delete',4]])await run('PARTNER','activity.'+action,{activityId:activity.id,expectedRevision:revision});
 const saved=await run('OWNER','legal.save',{programId:f.programId,templateKey:'synthetic-api-document',title:'Synthetic review draft',markdown:'DRAFT FOR REVIEW\n\nFor {{customer_name}}.',variablesSchema:{customer_name:{type:'string',required:true,default:'Synthetic Partner'}},issuable:false,expectedRevision:0,changeReason:'Synthetic API example'});
 await run('OWNER','legal.request_review',{programId:f.programId,versionId:saved.versionId,expectedRevision:1});
 const [source]=await f.database.query`SELECT * FROM partner_legal_versions WHERE id=${f.versionId}`;
 const reviewPackage=await run('OWNER','legal.export_package',{programId:f.programId,versionIds:[source.id],reviewers:[{name:'Synthetic API reviewer',role:'attorney',scopes:['agreement_language']}],expiresAt:'2026-10-24T12:00:00.000Z',redactionConfirmed:true});
 const feedback=await run('OWNER','legal.import_feedback',{programId:f.programId,packageId:reviewPackage.id,versionId:source.id,sourceHash:source.content_sha256,reviewerName:'Synthetic API reviewer',reviewerRole:'attorney',reviewerIdentityConfirmed:true,data:Buffer.from(createReviewDocx({markdown:source.markdown,sourceHash:source.content_sha256})).toString('base64')});
 const ownExport=await run('PARTNER','profile.export',{});
 await run('PARTNER','activity.start',{});
 await generateWeeklyStatements({database:f.database,now:()=>new Date('2026-10-26T12:00:00Z')});
 const [weekly]=await f.database.query`SELECT id FROM partner_weekly_statements WHERE partner_id=${f.partnerId} LIMIT 1`;
 const [issue]=await f.database.query`SELECT id FROM partner_agreement_issues WHERE partner_id=${f.partnerId} LIMIT 1`;
 const selections={
  PARTNER:[['gigs',{}],['gig',{id:gig.id}],['earnings',{}],['agreements',{}],['profile',{}],['visits',{}],['leads',{}],['activity',{}],['referrals',{}],['statement',{}],['statements',{}],['statements',{id:weekly.id}],['own-export',{id:ownExport.batchId}]],
  OWNER:[['programs',{}],['partners',{}],['campaigns',{}],['budgets',{}],['audit',{}],['gigs',{}],['gig',{id:gig.id}],['forecasts',{programId:f.programId}],['earnings',{}],['ledger',{}],['legal',{}],['legal-version',{id:saved.versionId,programId:f.programId}],['legal-diff',{id:saved.versionId,compareTo:saved.versionId}],['legal-choices',{programId:f.programId}],['agreement',{id:issue.id}],['agreements',{}],['review-feedback',{id:feedback.id}],['review-package',{id:reviewPackage.id}],['statements',{}],['statement',{}],['exports',{}],['export',{id:accounting.batchId}],['visits',{}],['leads',{}],['referrals',{}]],
 };
 for(const [role,reads]of Object.entries(selections))for(const [resource,input]of reads){
  const result=await app.read(role==='OWNER'?f.owner:f.actor,resource,input);
  examples.push({kind:'read',role,resource,input,result});
 }
 console.log(JSON.stringify(examples));
}finally{await f.close();}
