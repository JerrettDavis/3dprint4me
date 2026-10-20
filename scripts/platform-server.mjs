import { createPlatformServer } from '../lib/platform/api-server.js';
import { closeDatabase, queryDatabase } from '../lib/database.js';
import { createAuthHttpHandler } from '../lib/operator-identity/http.js';

const names=['checkout','health','home-assistant-work','inquiry','operator-print','operator-push',
  'operator-session','operator-work-update','operator-work','print-estimate','request','upload-url'];
const routes=Object.fromEntries(await Promise.all(names.map(async name=>[
  `/api/${name}`,(await import(`../api/${name}.js`)).default
])));
const consumeNonce=async(nonce,expiresAt)=>{
  const rows=await queryDatabase`INSERT INTO platform_proxy_nonces (nonce,expires_at)
    SELECT ${nonce},to_timestamp(${expiresAt}/1000.0)
    WHERE (SELECT count(*) FROM platform_proxy_nonces)<10000
    ON CONFLICT DO NOTHING RETURNING nonce`;
  return rows.length===1;
};
const server=createPlatformServer({routes,consumeNonce,ready:()=>queryDatabase`SELECT id FROM operators LIMIT 1`,
  authHandler:process.env.OPERATOR_AUTH_PROVIDER==='authentik'?createAuthHttpHandler():undefined});
const port=Number(process.env.PORT??8080);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid API port.');
server.listen(port,'0.0.0.0',()=>console.log('API service ready.'));
let stopping=false;
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{
  if(stopping)return;stopping=true;
  const deadline=setTimeout(()=>{server.closeAllConnections();process.exit(1);},40000);deadline.unref();
  server.close(async()=>{await closeDatabase();clearTimeout(deadline);process.exit(0);});
});
