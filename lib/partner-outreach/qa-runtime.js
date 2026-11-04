import {qaScenarioCommands} from './qa-scenarios.js';
import {HttpError} from '../http.js';
import {createPartnerApplication} from './application.js';
import {createPartnerAuth} from './auth.js';
import {createQaOwnerAuthorization} from './qa-owner-auth.js';

export function assertQaSyntheticInput(action,input){
 function inspect(value,path=[]){if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){
  if(typeof item==='string'&&/email$/i.test(key)&&item&&!item.toLowerCase().endsWith('.invalid'))throw new HttpError(422,'QA requires synthetic .invalid email addresses.');
  if(typeof item==='string'&&/phone$/i.test(key)&&item&&item!=='+12025550100')throw new HttpError(422,'QA requires the synthetic phone +12025550100.');
  if(typeof item==='object')inspect(item,[...path,key]);
 }}
 inspect(input);
 if(['payment.record','payment.reverse','referral.verify_sale'].includes(action)&&!input.paymentReference?.startsWith('QA-SIMULATED-'))throw new HttpError(422,'Use a QA-SIMULATED- settlement reference.');
 if(action==='legal.record_review'&&!input.reviewerName?.startsWith('SIMULATED'))throw new HttpError(422,'QA requires a SIMULATED reviewer.');
 if(action==='legal.export_package'&&input.reviewers?.some(r=>!r.name?.startsWith('SIMULATED')))throw new HttpError(422,'QA requires SIMULATED reviewer grants.');
}
export function assertNoQaProviders(env){
 const allowed=new Set(['PARTNER_REVIEW_SIGNING_PRIVATE_KEY','PARTNER_REVIEW_SIGNING_KEY_ID']);
 for(const [key,value] of Object.entries(env))if(value&&!allowed.has(key)&&/(STRIPE|RESEND|INVOICE_NINJA|SMTP|WEBHOOK|VAPID|TWILIO|BLOB_|S3_|SUPABASE_SERVICE|HOME_ASSISTANT)/i.test(key))throw Error('QA provider credentials are forbidden.');
}
export async function assertQaIsolation({qaDatabase,ownerAuthDatabase,env={}}){
 assertNoQaProviders(env);
 if(qaDatabase===ownerAuthDatabase)throw Error('QA isolation check failed.');
 const identity=db=>db.query`SELECT current_database() AS database_name,current_user AS role_name,(r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole) AS privileged FROM pg_roles r WHERE r.rolname=current_user`;
 const [qaRows,ownerRows]=await Promise.all([identity(qaDatabase),identity(ownerAuthDatabase)]),qa=qaRows[0],owner=ownerRows[0];
 if(!qa||!owner||qa.database_name===owner.database_name||qa.privileged||owner.privileged||qa.role_name!=='platform_app'||owner.role_name!=='partner_qa_auth')throw Error('QA isolation check failed.');
 const [rights]=await ownerAuthDatabase.query`SELECT pg_has_role(current_user,'platform_backend','MEMBER') AS backend_member,has_table_privilege(current_user,'public.service_requests','SELECT') AS business_read,has_table_privilege(current_user,'public.operator_sessions','UPDATE') OR has_table_privilege(current_user,'public.operator_sessions','DELETE') OR has_table_privilege(current_user,'public.operators','UPDATE') AS auth_write`;
 if(!rights||rights.backend_member!==false||rights.business_read!==false||rights.auth_write!==false)throw Error('QA auth isolation grants failed.');
 const [sentinel]=await qaDatabase.query`SELECT realm,cluster_identifier FROM public.partner_qa_identity WHERE singleton=true`;
 const [qaIdentity]=await qaDatabase.query`SELECT database_name,cluster_identifier FROM public.partner_qa_database_identity()`;
 const [ownerIdentity]=await ownerAuthDatabase.query`SELECT database_name,cluster_identifier FROM public.partner_qa_auth_identity()`;
 if(sentinel?.realm!=='qa'||!sentinel.cluster_identifier||qaIdentity?.cluster_identifier!==sentinel.cluster_identifier||qaIdentity.database_name!==qa.database_name||!ownerIdentity?.cluster_identifier||sentinel.cluster_identifier===ownerIdentity.cluster_identifier||ownerIdentity.database_name!==owner.database_name)throw Error('QA cluster isolation check failed.');
 return {qaDatabaseName:qa.database_name,ownerDatabaseName:owner.database_name,ownerIdentity};
}
export function createPartnerQaRuntime({qaDatabase,ownerAuthDatabase,env={},now=()=>new Date(),additionalCommands={}}={}){
 assertNoQaProviders(env);
 if(!qaDatabase||!ownerAuthDatabase||qaDatabase===ownerAuthDatabase)throw Error('QA isolation check failed.');
 const boundary=createQaOwnerAuthorization({ownerAuthDatabase,env});
 const isolatedDatabase={...qaDatabase,withTransaction:operation=>qaDatabase.withTransaction(async tx=>{const result=await operation({...tx,realm:'qa'});await boundary.assertAlive();return result;})};
 const application=createPartnerApplication({database:isolatedDatabase,env,now,additionalCommands:{...qaScenarioCommands({database:isolatedDatabase,now}),...additionalCommands},ownerVerifier:boundary.guard});
 const auth=createPartnerAuth({database:isolatedDatabase,now,realm:'qa',canEnroll:application.approvals.canEnroll,verifyOwner:application.guard});
 const wrap=(object,name,actorFor)=>(...args)=>boundary.run(actorFor(...args),()=>object[name](...args));
 const app={...application,execute:args=>boundary.run(args.actor,()=>{assertQaSyntheticInput(args.action,args.input);return application.execute(args);}),read:wrap(application,'read',x=>x)};
 return {realm:'qa',database:isolatedDatabase,ownerAuthDatabase,app,auth:{...auth,issueInvite:wrap(auth,'issueInvite',x=>x.actor),revoke:wrap(auth,'revoke',x=>x.actor)}};
}
