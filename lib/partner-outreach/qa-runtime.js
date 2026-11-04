import {createPartnerApplication} from './application.js';
import {createPartnerAuth} from './auth.js';
import {createQaOwnerAuthorization} from './qa-owner-auth.js';

export function assertNoQaProviders(env){
 const allowed=new Set(['PARTNER_REVIEW_SIGNING_PRIVATE_KEY','PARTNER_REVIEW_SIGNING_KEY_ID']);
 for(const [key,value] of Object.entries(env))if(value&&!allowed.has(key)&&/(STRIPE|RESEND|SMTP|WEBHOOK|VAPID|TWILIO|BLOB_|S3_|SUPABASE_SERVICE|HOME_ASSISTANT)/i.test(key))throw Error('QA provider credentials are forbidden.');
}
export async function assertQaIsolation({qaDatabase,ownerAuthDatabase,env={}}){
 assertNoQaProviders(env);
 if(qaDatabase===ownerAuthDatabase)throw Error('QA isolation check failed.');
 const identity=db=>db.query`SELECT current_database() AS database_name,current_user AS role_name,(r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole) AS privileged FROM pg_roles r WHERE r.rolname=current_user`;
 const [qaRows,ownerRows]=await Promise.all([identity(qaDatabase),identity(ownerAuthDatabase)]),qa=qaRows[0],owner=ownerRows[0];
 if(!qa||!owner||qa.database_name===owner.database_name||qa.privileged||owner.privileged)throw Error('QA isolation check failed.');
 const [sentinel]=await qaDatabase.query`SELECT realm FROM public.partner_qa_identity WHERE singleton=true`;
 if(sentinel?.realm!=='qa')throw Error('QA isolation check failed.');
 return {qaDatabaseName:qa.database_name,ownerDatabaseName:owner.database_name};
}
export function createPartnerQaRuntime({qaDatabase,ownerAuthDatabase,env={},now=()=>new Date(),additionalCommands={}}={}){
 assertNoQaProviders(env);
 if(!qaDatabase||!ownerAuthDatabase||qaDatabase===ownerAuthDatabase)throw Error('QA isolation check failed.');
 const boundary=createQaOwnerAuthorization({ownerAuthDatabase,env});
 const application=createPartnerApplication({database:qaDatabase,env,now,additionalCommands,ownerVerifier:boundary.guard});
 const auth=createPartnerAuth({database:qaDatabase,now,realm:'qa',canEnroll:application.approvals.canEnroll,verifyOwner:application.guard});
 const wrap=(object,name,actorFor)=>(...args)=>boundary.run(actorFor(...args),()=>object[name](...args));
 const app={...application,execute:wrap(application,'execute',x=>x.actor),read:wrap(application,'read',x=>x)};
 return {realm:'qa',database:qaDatabase,ownerAuthDatabase,app,auth:{...auth,issueInvite:wrap(auth,'issueInvite',x=>x.actor),revoke:wrap(auth,'revoke',x=>x.actor)}};
}
