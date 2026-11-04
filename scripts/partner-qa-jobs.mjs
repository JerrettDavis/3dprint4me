import pg from 'pg';
import {createNativeDatabase,nativePoolOptions} from '../lib/database.js';
import {assertNoQaProviders} from '../lib/partner-outreach/qa-runtime.js';
import {generateWeeklyStatements} from '../lib/partner-outreach/statements.js';
import {purgeExpiredPartnerExports} from '../lib/partner-outreach/export-retention.js';
export async function runQaJobs({database}){
 const [identity]=await database.query`SELECT current_database() AS name,(SELECT realm FROM public.partner_qa_identity WHERE singleton=true) AS realm`;
 if(identity?.name!=='3dprint4me_partner_qa'||identity.realm!=='qa')throw Error('QA jobs require their isolated database.');
 const scoped={...database,withTransaction:run=>database.withTransaction(tx=>run({...tx,realm:'qa'}))};
 return {statements:await generateWeeklyStatements({database:scoped}),cleanup:await purgeExpiredPartnerExports(scoped)};
}
async function main(){
 assertNoQaProviders(process.env);
 if(process.env.PARTNER_QA_JOBS_ENABLED!=='1'||!process.env.PARTNER_QA_DATABASE_URL)throw Error('Explicit QA jobs configuration required.');
 const pool=new pg.Pool({...nativePoolOptions(process.env.PARTNER_QA_DATABASE_URL),max:2,application_name:'3dprint4me-partner-qa-jobs'});pool.on('error',()=>console.error('QA job storage unavailable.'));
 const database=createNativeDatabase({pool});let stopping=false;
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;});
 try{while(!stopping){try{await runQaJobs({database});}catch{console.error('QA maintenance failed.');}for(let n=0;n<60&&!stopping;n++)await new Promise(r=>setTimeout(r,1000));}}finally{await pool.end();}
}
import {pathToFileURL} from 'node:url';
if(import.meta.url===pathToFileURL(process.argv[1]??'').href)main().catch(()=>{console.error('QA jobs startup failed.');process.exitCode=1;});
