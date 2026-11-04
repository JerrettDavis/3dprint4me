import pg from 'pg';
import {HttpError} from '../http.js';
import {createNativeDatabase,nativePoolOptions} from '../database.js';
import {assertQaIsolation,createPartnerQaRuntime} from './qa-runtime.js';
// Construct from a whitelist: real provider configuration is never inherited.
export async function loadConfiguredQaRuntime({env=process.env,selectedDatabase}){
 if(env.PARTNER_QA_ENABLED!=='1')return {getRuntime:()=>{throw new HttpError(503,'QA is unavailable.');},close:async()=>{}};
 if(!env.PARTNER_QA_DATABASE_URL||!env.PARTNER_QA_OWNER_AUTH_URL)throw Error('QA database configuration is incomplete.');
 const pools=[env.PARTNER_QA_DATABASE_URL,env.PARTNER_QA_OWNER_AUTH_URL].map(connection=>new pg.Pool({...nativePoolOptions(connection),max:4,application_name:'3dprint4me-partner-qa'}));
 for(const pool of pools)pool.on('error',()=>console.error('QA storage unavailable.'));
 const [qaDatabase,ownerAuthDatabase]=pools.map(pool=>createNativeDatabase({pool}));
 const qaEnv={OPERATOR_OWNER_SUBJECT:env.OPERATOR_OWNER_SUBJECT,PARTNER_PROGRAM_ENABLED:'1',PARTNER_CLASSIFICATION_APPROVED:'1',PARTNER_ACCOUNTING_APPROVED:'1',PARTNER_REVIEW_SIGNING_PRIVATE_KEY:env.PARTNER_QA_REVIEW_SIGNING_PRIVATE_KEY,PARTNER_REVIEW_SIGNING_KEY_ID:'qa-simulation-only'};
 try{
  const ids=await assertQaIsolation({qaDatabase,ownerAuthDatabase,env:qaEnv});
  const [selected]=await selectedDatabase.query`SELECT current_database() AS database_name`;
  if(selected.database_name!==ids.ownerDatabaseName)throw Error('QA auth does not reference the selected owner store.');
  const runtime=createPartnerQaRuntime({qaDatabase,ownerAuthDatabase,env:qaEnv});
  return {getRuntime:()=>runtime,close:()=>Promise.all(pools.map(pool=>pool.end()))};
 }catch(error){await Promise.all(pools.map(pool=>pool.end()));throw error;}
}
