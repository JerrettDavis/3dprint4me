import pg from 'pg';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {MIGRATIONS,splitStatements} from './migrate-neon.mjs';
export async function provisionPartnerQa({qaAdmin,ownerAdmin,apply=false}){
 const identity=async db=>(await db.query('SELECT current_database() db,(pg_control_system()).system_identifier::text cluster')).rows[0];
 const [qa,owner]=await Promise.all([identity(qaAdmin),identity(ownerAdmin)]);
 if(qa.db!=='3dprint4me_partner_qa'||qa.db===owner.db||qa.cluster===owner.cluster)throw Error('QA provisioning requires a dedicated cluster and exact QA database identity.');
 const tables=(await qaAdmin.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows;
 if(tables.length){const sentinel=await qaAdmin.query("SELECT realm FROM public.partner_qa_identity WHERE singleton=true");if(sentinel.rows[0]?.realm!=='qa')throw Error('QA database has no valid identity sentinel.');}
 if(!apply)return {ok:true,phase:'preflight',qaDatabase:qa.db};
 // A second explicit identity check occurs before applying any schema.
 const recheck=await identity(qaAdmin);if(recheck.cluster!==qa.cluster||recheck.db!==qa.db)throw Error('QA target changed.');
 await qaAdmin.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC; DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='platform_backend') THEN CREATE ROLE platform_backend NOLOGIN; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='platform_app') THEN CREATE ROLE platform_app LOGIN IN ROLE platform_backend; END IF; END $$; GRANT USAGE ON SCHEMA public TO platform_backend");
 await qaAdmin.query("CREATE TABLE IF NOT EXISTS public.partner_qa_identity(singleton boolean PRIMARY KEY CHECK(singleton),realm text NOT NULL CHECK(realm='qa')); INSERT INTO public.partner_qa_identity VALUES(true,'qa') ON CONFLICT DO NOTHING; REVOKE ALL ON public.partner_qa_identity FROM PUBLIC");
 await qaAdmin.query('ALTER TABLE public.partner_qa_identity ADD COLUMN IF NOT EXISTS cluster_identifier text');
 await qaAdmin.query('UPDATE public.partner_qa_identity SET cluster_identifier=$1 WHERE singleton=true',[qa.cluster]);
 await qaAdmin.query('ALTER TABLE public.partner_qa_identity ALTER COLUMN cluster_identifier SET NOT NULL');
 for(const migration of MIGRATIONS)for(const sql of splitStatements(await readFile(new URL('../neon/migrations/'+migration,import.meta.url),'utf8')))await qaAdmin.query(sql);
 await qaAdmin.query('REVOKE ALL ON public.partner_qa_identity FROM platform_backend; GRANT SELECT ON public.partner_qa_identity TO platform_backend');
 await qaAdmin.query(await readFile(new URL('../deploy/platform/partner-qa-identity.sql',import.meta.url),'utf8'));
 await ownerAdmin.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='partner_qa_auth') THEN CREATE ROLE partner_qa_auth LOGIN NOINHERIT; END IF; END $$");
 await ownerAdmin.query(await readFile(new URL('../deploy/platform/partner-qa-auth.sql',import.meta.url),'utf8'));
 return {ok:true,phase:'apply',qaDatabase:qa.db};
}
async function main(){
 const [configPath,phase]=process.argv.slice(2);if(!configPath||!['preflight','apply'].includes(phase))throw Error('Use a private configuration file and preflight/apply phase.');
 const config=JSON.parse(await readFile(configPath,'utf8'));
 if(phase==='apply'&&(typeof config.qaAppPassword!=='string'||config.qaAppPassword.length<32||typeof config.ownerAuthPassword!=='string'||config.ownerAuthPassword.length<32))throw Error('Private role passwords are required before provisioning.');
 const qaAdmin=new pg.Client({connectionString:config.qaAdminUrl}),ownerAdmin=new pg.Client({connectionString:config.ownerAdminUrl});
 try{await Promise.all([qaAdmin.connect(),ownerAdmin.connect()]);const result=await provisionPartnerQa({qaAdmin,ownerAdmin,apply:phase==='apply'});
 if(phase==='apply'){
  if(typeof config.qaAppPassword!=='string'||config.qaAppPassword.length<32||typeof config.ownerAuthPassword!=='string'||config.ownerAuthPassword.length<32)throw Error('Private role passwords are required.');
  await qaAdmin.query('ALTER ROLE platform_app PASSWORD '+pg.escapeLiteral(config.qaAppPassword));await ownerAdmin.query('ALTER ROLE partner_qa_auth PASSWORD '+pg.escapeLiteral(config.ownerAuthPassword));
 }
 console.log(JSON.stringify(result));
 }finally{await Promise.allSettled([qaAdmin.end(),ownerAdmin.end()]);}
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href)main().catch(()=>{console.error('QA provisioning failed; inspect private configuration and target identities.');process.exitCode=1;});
