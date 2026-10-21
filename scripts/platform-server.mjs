import { createPlatformServer } from '../lib/platform/api-server.js';
import { closeDatabase, queryDatabase } from '../lib/database.js';
import { createAuthHttpHandler } from '../lib/operator-identity/http.js';
import { createHandoverGate } from '../lib/platform/handover.js';
import { createDatabaseActivation } from '../lib/platform/activation.js';
import { createControlStore } from '../lib/platform/control-store.js';

async function main() {
  const names=['checkout','health','home-assistant-work','inquiry','operator-print','operator-push',
    'operator-session','operator-work-update','operator-work','print-estimate','request','upload-url'];
  const routes=Object.fromEntries(await Promise.all(names.map(async name=>[
    `/api/${name}`,(await import(`../api/${name}.js`)).default
  ])));
  const control=createControlStore(),gate=createHandoverGate();
  const activate=createDatabaseActivation({getSelection:control.getSelection,persistSelection:control.persistSelection});
  await activate.bootstrap();
  const server=createPlatformServer({routes,consumeNonce:control.consumeNonce,gate,activate,
    ready:()=>queryDatabase`SELECT id FROM operators LIMIT 1`,
    authHandler:process.env.GITHUB_CLIENT_ID||process.env.OIDC_ISSUER?createAuthHttpHandler():undefined});
  const port=Number(process.env.PORT??8080);
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid API port.');
  server.listen(port,'0.0.0.0',()=>console.log('API service ready.'));
  let stopping=false;
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{
    if(stopping)return;stopping=true;
    const deadline=setTimeout(()=>{server.closeAllConnections();process.exit(1);},40000);deadline.unref();
    server.close(async()=>{await Promise.all([closeDatabase(),control.close()]);clearTimeout(deadline);process.exit(0);});
  });

}
main().catch(()=>{console.error('API service startup failed.');process.exit(1);});
