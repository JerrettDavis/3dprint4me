// Disposable native browser fixture. Never connects to an existing database.
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
import pg from 'pg';
import {MIGRATIONS,splitStatements} from '../../scripts/migrate-neon.mjs';
import {createNativeDatabase,nativePoolOptions,closeDatabase} from '../../lib/database.js';
import {createPartnerApplication} from '../../lib/partner-outreach/application.js';
import {createProjectRequestHandler} from '../../lib/project-request/handler.js';
import {createRequestRecord,completeRequestRecord} from '../../lib/neon.js';
import {issueReferral} from '../../lib/partner-outreach/referrals.js';
import {createPartnerAuth,hashPassword} from '../../lib/partner-outreach/auth.js';
import {createPartnerHandlers} from '../../lib/partner-outreach/http.js';
import {createPlatformServer} from '../../lib/platform/api-server.js';
if(process.env.PARTNER_NATIVE_BROWSER_TEST!=='1')throw new Error('Explicit disposable fixture flag required.');
const shell=new URL(process.env.PARTNER_TEST_SHELL_ORIGIN);
if(shell.protocol!=='http:'||shell.hostname!=='127.0.0.1'||shell.origin!==process.env.PARTNER_TEST_SHELL_ORIGIN)throw new Error('Fixture shell must be loopback.');
const IMAGE='postgres:18@sha256:edb0c08dc33befd0262ab3b5cf1c4f3f8cfd8b09e88c05b45adee29d6761ddb6';
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:90000,stdio:['pipe','pipe','pipe']}).trim();
const name=process.env.PARTNER_TEST_CONTAINER_NAME??'3dprint4me-partner-browser-'+randomUUID().slice(0,8);
if(!/^3dprint4me-partner-browser-[a-f0-9]{8}$/.test(name))throw new Error('Invalid disposable container name.');
let started=false,admin,pool,server,stopping=false;
async function stop(){if(stopping)return;stopping=true;if(server)await new Promise(resolve=>server.close(resolve));await closeDatabase();await pool?.end();await admin?.end();if(started)docker('stop',name);}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>stop().finally(()=>process.exit(0)));
process.stdin.on('data',data=>{if(data.toString().trim()==='stop')stop().finally(()=>process.exit(0));});
try{
 docker('run','--detach','--rm','--name',name,'--label','3dprint4me.purpose=partner-browser','--publish','127.0.0.1::5432','--env','POSTGRES_HOST_AUTH_METHOD=trust',IMAGE);started=true;
 const port=JSON.parse(docker('inspect',name))[0].NetworkSettings.Ports['5432/tcp'][0].HostPort;
 const url=`postgresql://postgres@127.0.0.1:${port}/postgres`;admin=new pg.Pool(nativePoolOptions(url));
 let ready=false;for(let n=0;n<80;n++){try{await admin.query('SELECT 1');ready=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,250));}}if(!ready)throw new Error('Disposable database unavailable.');
 await admin.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC; CREATE ROLE platform_backend NOLOGIN; CREATE ROLE platform_app LOGIN IN ROLE platform_backend; GRANT USAGE ON SCHEMA public TO platform_backend');
 for(const file of MIGRATIONS)for(const statement of splitStatements(await readFile(new URL('../../neon/migrations/'+file,import.meta.url),'utf8')))await admin.query(statement);
 const programId=randomUUID(),partnerId=randomUUID(),otherPartnerId=randomUUID(),gigs=[randomUUID(),randomUUID()],campaignId=randomUUID(),acceptedGigId=randomUUID(),password='Synthetic browser fixture passphrase';
 const credential=await hashPassword(password),terms={title:'Synthetic business visits',feeCents:1000,maximumBonusCents:0,tasks:['Permitted business introductions'],materials:[],area:'Tulsa',deadline:'2026-12-01'};
 await admin.query("INSERT INTO partner_programs(id,label,starts_on,enabled,synthetic) VALUES($1,'Synthetic browser fixture','2026-10-01',false,true)",[programId]);
 await admin.query("INSERT INTO partner_campaigns(id,program_id,title,terms,status) VALUES($1,$2,'Synthetic visits',$3,'published')",[campaignId,programId,JSON.stringify(terms)]);
 for(const [index,id] of [partnerId,otherPartnerId].entries()){
  await admin.query("INSERT INTO partner_accounts(id,program_id,display_name,status,credential_hash) VALUES($1,$2,$3,'active',$4)",[id,programId,'Synthetic Partner '+(index+1),credential]);
  await admin.query("INSERT INTO partner_gigs(id,program_id,partner_id,campaign_id,terms_snapshot,status) VALUES($1,$2,$3,$4,$5,'offered')",[gigs[index],programId,id,campaignId,JSON.stringify(terms)]);
 }
 // Seed a historical accepted obligation separately from new-work approval gates.
 const weekId=randomUUID();
 await admin.query("INSERT INTO partner_program_weeks(id,program_id,week_start_local,cap_cents,committed_cents) VALUES($1,$2,'2026-10-19',20000,1000)",[weekId,programId]);
 await admin.query("INSERT INTO partner_gigs(id,program_id,partner_id,campaign_id,program_week_id,terms_snapshot,status,accepted_fee_cents,accepted_at,revision) VALUES($1,$2,$3,$4,$5,$6,'accepted',1000,'2026-10-23T12:00:00Z',2)",[acceptedGigId,programId,partnerId,campaignId,weekId,JSON.stringify(terms)]);
 await admin.query("INSERT INTO partner_budget_reservations(id,program_week_id,gig_id,amount_cents) VALUES($1,$2,$3,1000)",[randomUUID(),weekId,acceptedGigId]);
 pool=new pg.Pool(nativePoolOptions(url.replace('postgres@','platform_app@')));const database=createNativeDatabase({pool}),env={PARTNER_WEB_ORIGIN:shell.origin,OPERATOR_WEB_ORIGIN:'https://work.3dprint4.me'};
 process.env.DATABASE_DRIVER='postgres';process.env.DATABASE_URL=url.replace('postgres@','platform_app@');
 const app=createPartnerApplication({database,env}),auth=createPartnerAuth({database}),runtime={database,app,auth};
 const handlers=createPartnerHandlers({getRuntime:()=>runtime,env});
 const requestHandler=createProjectRequestHandler({getRuntime:()=>({mode:'neon',requestRepository:{createDraft:createRequestRecord,completeDraft:completeRequestRecord}}),issueCheckoutProof:()=>null});
 // Explicit loopback fixture admission only; production public intake uses its signed proxy.
 server=createPlatformServer({routes:{...handlers.routes,'/api/request':requestHandler},directPaths:[...handlers.directPaths,'/api/request'],env:{}});server.listen(0,'127.0.0.1');await once(server,'listening');
 const bonusTerms={...terms,maximumBonusCents:500,bonusRules:[{id:'sale',trigger:'verified_sale',amountCents:500,maximumAwards:1,criteria:'Independent fully settled purchase.',refundTreatment:'Owner reviews refunds separately.',qualifiesBy:'2026-12-31'}]},refGigId=randomUUID();
 await admin.query("INSERT INTO partner_gigs(id,program_id,partner_id,campaign_id,program_week_id,terms_snapshot,status,accepted_fee_cents,maximum_bonus_cents,accepted_at,revision) VALUES($1,$2,$3,$4,$5,$6,'accepted',1000,500,'2026-10-23T12:00:00Z',2)",[refGigId,programId,partnerId,campaignId,weekId,JSON.stringify(bonusTerms)]);
 await admin.query("INSERT INTO partner_budget_reservations(id,program_week_id,gig_id,amount_cents) VALUES($1,$2,$3,1500)",[randomUUID(),weekId,refGigId]);
 await admin.query("UPDATE partner_program_weeks SET committed_cents=2500 WHERE id=$1",[weekId]);
 const referral=await issueReferral(database,{id:refGigId,partner_id:partnerId,program_id:programId,terms_snapshot:bonusTerms},new Date('2026-10-23T12:00:00Z'));
 process.stdout.write(JSON.stringify({referralCode:referral.code,apiOrigin:'http://127.0.0.1:'+server.address().port,partnerId,otherPartnerId,gigId:gigs[0],otherGigId:gigs[1],acceptedGigId,password})+'\n');
}catch{await stop();process.stderr.write('Disposable native partner fixture failed.\n');process.exitCode=1;}
