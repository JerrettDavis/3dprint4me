import {qaPostgresFixture} from './partner-qa-postgres.mjs';
import {createPlatformServer} from '../../lib/platform/api-server.js';
import {createPartnerHandlers} from '../../lib/partner-outreach/http.js';
import {createPartnerQaRuntime} from '../../lib/partner-outreach/qa-runtime.js';
import {createPartnerRuntime} from '../../lib/partner-outreach/runtime.js';
import {digest} from '../../lib/partner-outreach/postgres-repository.js';
import {randomBytes,generateKeyPairSync} from 'node:crypto';
import {once} from 'node:events';
if(process.env.PARTNER_NATIVE_BROWSER_TEST!=='1')throw Error('Explicit fixture admission required.');
for(const key of ['PARTNER_TEST_SHELL_ORIGIN','PARTNER_TEST_OWNER_ORIGIN']){const url=new URL(process.env[key]);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.origin!==process.env[key])throw Error('Loopback fixture origins required.');}
const f=await qaPostgresFixture(),ownerToken=randomBytes(32).toString('base64url');
let stopping=false,server;
async function stop(){if(stopping)return;stopping=true;if(server)await new Promise(r=>server.close(r));await f.close();}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>stop().finally(()=>process.exit(0)));
process.stdin.on('data',data=>{if(data.toString().trim()==='stop')stop().finally(()=>process.exit(0));});
try{
 await f.live.admin.query("INSERT INTO operators(id,auth_user_id,display_name,role) VALUES('qa-owner','github:2610199','Synthetic QA fixture owner','owner')");
 await f.live.admin.query("INSERT INTO operator_identity_bindings(issuer,subject,operator_id) VALUES('https://github.com/','2610199','qa-owner')");
 await f.live.admin.query("INSERT INTO operator_sessions(token_hash,operator_id,issuer,subject,expires_at) VALUES($1,'qa-owner','https://github.com/','2610199',now()+interval '1 day')",[digest(ownerToken)]);
 const env={OPERATOR_OWNER_SUBJECT:'2610199',OPERATOR_WEB_ORIGIN:process.env.PARTNER_TEST_OWNER_ORIGIN,PARTNER_WEB_ORIGIN:process.env.PARTNER_TEST_SHELL_ORIGIN};
 const qaEnv={...env,PARTNER_PROGRAM_ENABLED:'1',PARTNER_CLASSIFICATION_APPROVED:'1',PARTNER_ACCOUNTING_APPROVED:'1',PARTNER_REVIEW_SIGNING_PRIVATE_KEY:generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'})};
 const qa=createPartnerQaRuntime({qaDatabase:f.business.database,ownerAuthDatabase:f.auth.database,env:qaEnv});
 const liveDatabase=f.live.connect('platform_app').database,live=createPartnerRuntime({database:liveDatabase,env});
 const qh=createPartnerHandlers({getRuntime:()=>qa,realm:'qa',env}),lh=createPartnerHandlers({getRuntime:()=>live,env});
 server=createPlatformServer({routes:{...qh.routes,...lh.routes},directPaths:[...qh.directPaths,...lh.directPaths],env:{}});server.listen(0,'127.0.0.1');await once(server,'listening');
 process.stdout.write(JSON.stringify({apiOrigin:'http://127.0.0.1:'+server.address().port,ownerOrigin:env.OPERATOR_WEB_ORIGIN,ownerToken})+'\n');
}catch(error){await stop();throw error;}
