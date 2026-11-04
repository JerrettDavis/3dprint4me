import {pathToFileURL} from 'node:url';
import { createPartnerHandlers } from '../lib/partner-outreach/http.js';
import { loadConfiguredQaRuntime } from '../lib/partner-outreach/qa-config.js';
import { getDatabase } from '../lib/database.js';
import { getPartnerRuntime } from '../lib/partner-outreach/runtime.js';
import { createPlatformServer } from '../lib/platform/api-server.js';
import { closeDatabase, queryDatabase } from '../lib/database.js';
import { createAuthHttpHandler } from '../lib/operator-identity/http.js';
import { createHandoverGate } from '../lib/platform/handover.js';
import { createDatabaseActivation } from '../lib/platform/activation.js';
import { createControlStore } from '../lib/platform/control-store.js';

export async function startPlatformApi({env=process.env,loadRoute=async name=>(await import(`../api/${name}.js`)).default,control=createControlStore({env}),activate,getBusinessDatabase=getDatabase,loadQa=loadConfiguredQaRuntime,serverFactory=createPlatformServer,closeBusiness=closeDatabase,installSignalHandlers=true}={}) {
  const names=['checkout','health','home-assistant-work','inquiry','operator-print','operator-push',
    'operator-session','operator-work-update','operator-work','print-estimate','request','upload-url'];
  const routes=Object.fromEntries(await Promise.all(names.map(async name=>[
    `/api/${name}`,await loadRoute(name)
  ])));
  const gate=createHandoverGate();
  activate??=createDatabaseActivation({getSelection:control.getSelection,persistSelection:control.persistSelection});
  await activate.bootstrap();
  const partner=createPartnerHandlers({getRuntime:getPartnerRuntime,env});
  const qaRuntime=await loadQa({env,getSelectedDatabase:getBusinessDatabase,getSelection:control.getSelection});
  const qa=createPartnerHandlers({getRuntime:qaRuntime.getRuntime,realm:'qa',env});
  Object.assign(routes,partner.routes,qa.routes);
  const server=serverFactory({routes,env,directPaths:[...partner.directPaths,...qa.directPaths],consumeNonce:control.consumeNonce,gate,activate,
    ready:()=>queryDatabase`SELECT id FROM operators LIMIT 1`,
    authHandler:env.GITHUB_CLIENT_ID||env.OIDC_ISSUER?createAuthHttpHandler():undefined});
  const port=Number(env.PORT??8080);
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid API port.');
  server.listen(port,'0.0.0.0',()=>console.log('API service ready.'));
  let closing;
  const close=()=>closing??=new Promise((resolve,reject)=>server.close(async()=>{try{await Promise.all([closeBusiness(),control.close(),qaRuntime.close()]);resolve();}catch(error){reject(error);}}));
  if(installSignalHandlers)for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{
    const deadline=setTimeout(()=>{server.closeAllConnections();process.exit(1);},40000);deadline.unref();
    close().then(()=>{clearTimeout(deadline);process.exit(0);},()=>process.exit(1));
  });
  return {server,close};
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href)startPlatformApi().catch(()=>{console.error('API service startup failed.');process.exit(1);});
