// Documentation only; SQL-backed row models intentionally allow additional fields.
import { uuid } from './partner-api-input-schemas.mjs';
const string={type:'string'},boolean={type:'boolean'},integer={type:'integer'},cents={type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER};
const time={type:'string',format:'date-time'},date={type:'string',format:'date'},hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const ref=name=>({$ref:'#/components/schemas/'+name});
const nullable=schema=>({anyOf:[schema,{type:'null'}]});
const array=(items,maxItems)=>({type:'array',items,...(maxItems===undefined?{}:{maxItems})});
const object=(properties,optional=[],open=false)=>({type:'object',properties,required:Object.keys(properties).filter(k=>!optional.includes(k)),additionalProperties:open});
const row=properties=>object(properties,[],true);
const arbitrary={type:'object',additionalProperties:true};
const items=(schema,max)=>object({items:array(schema,max)});
const query=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const metadata={id:uuid,programId:uuid,partnerId:uuid,weekStart:date,generatedAt:time,asOf:time,recordCount:cents,sha256:hash};

export function readResponseSchemas(){
 const totals=Object.fromEntries(['obligationCents','paidCents','outstandingCents','overpaidCents','authorizedMaximumCents','unfundedObligationCents','offeredCents','committedCents','submittedCents','approvedCents','disputedCents','contingentBonusCents','earnedBonusCents'].map(k=>[k,cents]));
 const exposure=Object.fromEntries(['authorizedMaximumCents','offeredMaximumCents','pendingFeeCents','contingentBonusCents','obligationCents','paidCents','outstandingCents','overpaidCents','remainingExposureCents','potentialTotalCents','unfundedExposureCents'].map(k=>[k,cents]));
 const material=row({id:uuid,event_type:{type:'string',enum:['issued','returned']},items:array(object({label:string,count:{type:'integer',minimum:1,maximum:10000}}),50),created_at:time});
 const negotiation=row({id:uuid,proposed_fee_cents:cents,message:string,actor_id:string,created_at:time});
 const financial={items:array(ref('Payable'),10000),totals:object(totals),paymentEvents:array(row({id:uuid,partner_id:uuid,payable_id:uuid,event_type:{type:'string',enum:['settled','reversed']},amount_cents:integer,reverses_event_id:nullable(uuid),payment_reference:string,payment_method:string,occurred_at:time}),10000),manualPaymentsOnly:{type:'boolean',const:true}};
 const adjustment=object({id:uuid,payableId:uuid,amountCents:integer,reason:string,resolutionReference:string,partnerAcknowledged:boolean,verifiedResolution:boolean,occurredAt:time});
 const visit=row({id:uuid,gig_id:uuid,business_name:string,outcome:string,details:object({area:string,placement:string,sampleCount:cents}),visited_at:time,revision:cents});
 const lead=object({id:uuid,partnerId:uuid,visitId:uuid,contact:arbitrary,purpose:string,consentText:string,consentAt:time,withdrawnAt:nullable(time),deletedAt:nullable(time),status:string,revision:cents,followUpAllowed:boolean});
 const activity=object({id:uuid,startedAt:time,endedAt:nullable(time),pausedAt:nullable(time),runningSince:nullable(time),elapsedSeconds:cents,revision:cents,optional:{type:'boolean',const:true}});
 const referral={items:array(object({id:uuid,partnerId:uuid,gigId:uuid,code:string,policyHash:hash,bonusRules:array(arbitrary,10)}),10000),awards:array(object({id:uuid,referralId:uuid,ruleId:string,kind:string,amountCents:cents,earnedAt:time}),10000)};
 const exportCsv={batchId:uuid,filename:string,csv:string,sha256:hash};
 const program=row({id:uuid,label:string,starts_on:date,ends_on:date,enabled:boolean,default_weekly_cap_cents:cents,settings:arbitrary,revision:cents,created_at:time,clearance:object({allowed:boolean,missing:array(string)})});
 const legalVersion=row({id:uuid,document_id:uuid,version_no:cents,title:string,markdown:string,variables_schema:ref('TemplateVariables'),content_sha256:hash,issuable:boolean,required_scopes:array(string),authored_by:string,created_at:time,base_version_id:nullable(uuid),change_reason:string,template_key:string,document_status:string,active_version_id:nullable(uuid),document_revision:cents});
 const clearance=row({approved:boolean,missing:array(string),records:arbitrary});
 const statementHistory=object({items:array(object(metadata),100),nextCursor:nullable(uuid)});
 return {
  OfferSnapshot:{...object({title:string,feeCents:cents,maximumBonusCents:cents,bonusRules:array(object({id:string,trigger:{type:'string',enum:['qualified_lead','verified_sale']},amountCents:cents,maximumAwards:cents,criteria:string,qualifiesBy:date,refundTreatment:string},['refundTreatment']),10),tasks:array(string,50),materials:array(string,50),area:string,deadline:date}),description:'Normalized runtime output. Distinct from canonical OfferTerms input: runtime offer text permits DEL U+007F. Monetary/policy consistency is checked before storage.'},
  PartnerStatusResponse:object({message:string,invitationRequired:{type:'boolean',const:true}}),
  PartnerSessionResponse:object({partner:object({id:uuid,displayName:string,status:string}),csrfToken:string}),
  OwnerSessionResponse:object({owner:object({id:string}),csrfToken:string}),
  LogoutResponse:object({ok:{type:'boolean',const:true}}),
  Gig:object({id:uuid,partnerId:uuid,campaignId:nullable(uuid),terms:ref('OfferSnapshot'),status:string,revision:cents,feeCents:cents,maximumBonusCents:cents,acceptedAt:nullable(time),submittedAt:nullable(time),authorizationWeek:nullable(date)}),
  GigListResponse:items(ref('Gig'),500),
  PartnerGigDetailResponse:object({item:ref('Gig'),events:array(row({id:uuid,event_type:string,actor_kind:string,reason:string,data:arbitrary,created_at:time}),200),materials:array(material,200),materialsHasMore:boolean,negotiations:array(negotiation,100)}),
  Payable:object({id:uuid,partnerId:uuid,gigId:nullable(uuid),referralEventId:nullable(uuid),baseCents:cents,adjustmentCents:integer,amountDueCents:cents,paidCents:cents,outstandingCents:cents,overpaidCents:cents,status:{type:'string',enum:['settled','paid','part_paid','payable']},occurredAt:time,programId:uuid}),
  EarningsResponse:object(financial),
  OwnerEarningsResponse:object({...financial,adjustments:array(adjustment,10000)}),
  PartnerAgreementsResponse:items(row({id:uuid,version_id:uuid,snapshot_markdown:string,snapshot_sha256:hash,issued_at:time,acknowledged_at:nullable(time)}),200),
  OwnerAgreementsResponse:items(object({id:uuid,programId:uuid,partnerId:uuid,partnerName:string,versionId:uuid,title:string,versionNo:cents,snapshotHash:hash,issuedAt:time,acknowledgedAt:nullable(time)}),200),
  ProfileResponse:object({item:row({id:uuid,program_id:uuid,display_name:string,status:string,profile:arbitrary,revision:cents}),program:object({newWorkAvailable:boolean,endsOn:date})}),
  VisitsResponse:items(visit,1000),LeadsResponse:items(lead,1000),ActivityResponse:items(activity,1000),
  ReferralsResponse:object(referral),
  OwnerReferralsResponse:object({...referral,attributions:array(object({id:uuid,referralId:uuid,requestId:string,consentedAt:time,evidenceReference:string,createdAt:time}),10000),sales:array(object({id:uuid,attributionId:uuid,requestId:string,amountCents:cents,method:string,paymentReference:string,settledAt:time}),10000),qualifications:array(object({id:uuid,leadId:uuid,partnerId:uuid,gigId:uuid,qualifiedAt:time,followUpAllowed:boolean}),10000),requests:array(object({id:string,title:string,status:string,code:string,consentedAt:time}),10000)}),
  StatementHistoryResponse:statementHistory,
  OwnerStatementHistoryResponse:object({...statementHistory.properties,schedules:array(object({programId:uuid,label:string,revision:cents,enabled:boolean,firstDueWeek:nullable(date)}),1000)}),
  WeeklyStatementDownload:object({...metadata,filename:string,csv:string}),
  StatementExportResponse:object({...exportCsv,partnerId:uuid,generatedAt:time}),
  OwnExportResponse:{anyOf:[ref('OwnDataDownload'),ref('StatementExportResponse')]},
  OwnDataDownload:object({batchId:uuid,filename:string,generatedAt:time,sha256:hash,data:object({profile:arbitrary,gigs:array(arbitrary,10000),visits:array(arbitrary,10000),leads:array(arbitrary,10000),activities:array(arbitrary,10000),agreements:array(arbitrary,10000),earnings:ref('EarningsResponse'),referrals:ref('ReferralsResponse'),consentEvents:array(arbitrary,10000),materials:array(arbitrary,10000),workEvents:array(arbitrary,10000),negotiations:array(arbitrary,10000),acknowledgments:array(arbitrary,10000)})}),
  AccountingDownload:object({...exportCsv,basis:{type:'string',enum:['cash','accrual']},recordCount:cents,providerMode:{type:'string',const:'manual_csv'},providerImportVerified:{type:'boolean',const:false}}),
  AccountingHistoryResponse:items(object({id:uuid,programId:uuid,basis:string,from:nullable(date),through:nullable(date),generatedAt:time,recordCount:cents}),10000),
  ProgramsResponse:items(program,100),
  PartnersResponse:items(row({id:uuid,program_id:uuid,display_name:string,status:string,profile:arbitrary,revision:cents,created_at:time}),500),
  CampaignsResponse:items(row({id:uuid,program_id:uuid,title:string,terms:ref('OfferSnapshot'),status:string,revision:cents,created_at:time}),500),
  BudgetsResponse:items(row({id:uuid,program_id:uuid,week_start_local:{anyOf:[date,time],description:'Unnormalized SQL DATE from the configured driver; serialized as date or midnight timestamp. Calendar-week semantics remain Central local dates.'},cap_cents:cents,committed_cents:cents,revision:cents}),500),
  AuditResponse:items(row({id:uuid,program_id:nullable(uuid),actor_kind:string,actor_id:string,action:string,entity_kind:string,entity_id:string,minimal_diff:arbitrary,created_at:time}),200),
  ForecastsResponse:object({items:array(object({programId:uuid,label:string,...exposure,weeks:array(object({weekId:uuid,weekStart:date,capCents:cents,...exposure}),10000)}),10000),asOf:time,method:{type:'string',const:'recorded_commitment_upper_bound'}}),
  LegalListResponse:items(row({id:uuid,template_key:string,title:string,status:string,active_version_id:nullable(uuid),revision:cents,latest_version_id:nullable(uuid),version_no:nullable(cents),content_sha256:nullable(hash),issuable:nullable(boolean)}),200),
  LegalChoicesResponse:object({programId:uuid,items:array(object({id:uuid,title:string,hash,versionNo:cents,templateKey:string,requiredScopes:array(string),variables:array(arbitrary,80),issueEligible:boolean,contractEligible:boolean,policyEligible:boolean}),200)}),
  AgreementResponse:object({id:uuid,programId:uuid,partnerId:uuid,partnerName:string,versionId:uuid,title:string,versionNo:cents,sourceHash:hash,sourceMarkdown:string,snapshotHash:hash,snapshotMarkdown:string,bindings:ref('TemplateBindings'),issuedAt:time,acknowledgedAt:nullable(time)}),
  LegalDiffResponse:object({changed:boolean,startLine:cents,beforeLines:array(string),afterLines:array(string),clauses:array(object({anchor:string,changed:boolean,before:string,after:string}))}),
  LegalVersionResponse:object({version:legalVersion,documentComments:array(arbitrary,1000),packages:array(arbitrary,200),feedback:array(arbitrary,200),history:array(arbitrary,200),reviews:array(arbitrary,200),comments:array(arbitrary),clearance,clearanceByProgram:{type:'object',additionalProperties:clearance}}),
  ReviewPackageDownload:object({id:uuid,filename:string,contentType:{type:'string',const:'application/zip'},sha256:hash,manifest:arbitrary,publicKey:string,signature:{type:'string',contentEncoding:'base64'},expiresAt:time,data:{type:'string',contentEncoding:'base64'}}),
  ReviewFeedbackDownload:object({id:uuid,filename:string,contentType:{type:'string',const:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'},sha256:hash,evidence:arbitrary,data:{type:'string',contentEncoding:'base64'}}),
 };
}

export function readContracts(){
 const schemas=readResponseSchemas();
 const ownerSchema=schema=>{
  if(schema.$ref)return ownerSchema(schemas[schema.$ref.split('/').at(-1)]);
  if(schema.anyOf)return {anyOf:schema.anyOf.map(ownerSchema)};
  return {...schema,properties:{...schema.properties,csrfToken:string},required:[...new Set([...schema.required,'csrfToken'])]};
 };
 const qid=query({id:uuid},['id']),none=query(),program=query({programId:uuid});
 const history=query({id:uuid,before:uuid});history.not={required:['id','before']};
 const partner={status:['PartnerStatusResponse',none],session:['PartnerSessionResponse',none],gigs:['GigListResponse',none],gig:['PartnerGigDetailResponse',qid],earnings:['EarningsResponse',none],agreements:['PartnerAgreementsResponse',none],profile:['ProfileResponse',none],visits:['VisitsResponse',none],leads:['LeadsResponse',none],activity:['ActivityResponse',none],referrals:['ReferralsResponse',none],statement:['EarningsResponse',none],statements:[{anyOf:[ref('StatementHistoryResponse'),ref('WeeklyStatementDownload')]},history],'own-export':['OwnExportResponse',qid]};
 const ownerHistory={...history,properties:{...history.properties,programId:uuid}};
 const owner={session:['OwnerSessionResponse',none],programs:['ProgramsResponse',none],partners:['PartnersResponse',none],campaigns:['CampaignsResponse',none],budgets:['BudgetsResponse',none],audit:['AuditResponse',none],gigs:['GigListResponse',none],gig:['PartnerGigDetailResponse',qid],forecasts:['ForecastsResponse',program],earnings:['OwnerEarningsResponse',program],ledger:['OwnerEarningsResponse',program],legal:['LegalListResponse',none],'legal-version':['LegalVersionResponse',query({id:uuid,programId:uuid},['id'])],'legal-diff':['LegalDiffResponse',query({id:uuid,compareTo:uuid},['id','compareTo'])],'legal-choices':['LegalChoicesResponse',query({programId:uuid},['programId'])],agreement:['AgreementResponse',qid],agreements:['OwnerAgreementsResponse',none],'review-feedback':['ReviewFeedbackDownload',qid],'review-package':['ReviewPackageDownload',qid],statements:[{anyOf:[ref('OwnerStatementHistoryResponse'),ref('WeeklyStatementDownload')]},ownerHistory],statement:['OwnerEarningsResponse',program],exports:['AccountingHistoryResponse',none],export:['AccountingDownload',qid],visits:['VisitsResponse',none],leads:['LeadsResponse',none],referrals:['OwnerReferralsResponse',none]};
 const convert=(entries,isOwner)=>Object.fromEntries(Object.entries(entries).map(([key,[schema,canonicalQuery]])=>{
  const name=isOwner?'OwnerRead_'+key.replaceAll('-','_'):null;
  return [key,{query:canonicalQuery,response:isOwner?ref(name):typeof schema==='string'?ref(schema):schema,...(isOwner?{schemaName:name,schema:ownerSchema(typeof schema==='string'?ref(schema):schema)}:{})}];
 }));
 return {partner:convert(partner,false),owner:convert(owner,true)};
}
