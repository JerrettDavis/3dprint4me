import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { isIP } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { boundedBody, verifyProxy } from './proxy.js';
import { handleApiError, sendJson } from '../http.js';

// The replay store is supplied by the private database in production. It must
// atomically consume nonces; process-local memory is insufficient across restarts.
export function createPlatformServer({ routes, env=process.env, consumeNonce, authHandler, ready, gate, activate }={}) {
  if(env.LOCAL_DEV==='1'||env.SELF_HOSTED_API_ORIGIN)throw new Error('Unsafe API server configuration.');
  const server=createServer({maxHeaderSize:16384},async (incoming,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    try {
      const parsed=new URL(incoming.url,'http://api.internal');
      if(incoming.url!==parsed.pathname+parsed.search) {sendJson(res,400,{error:'Invalid request.'});return;}
      if(parsed.pathname==='/internal/ready'||parsed.pathname.startsWith('/internal/handover/')) {
        const expected=Buffer.from('Bearer '+(env.PLATFORM_PROXY_SECRET??'')),actual=Buffer.from(String(incoming.headers.authorization??''));
        if(!env.PLATFORM_PROXY_SECRET||expected.length!==actual.length||!timingSafeEqual(expected,actual)){sendJson(res,401,{error:'Authentication required.'});return;}
        if(parsed.pathname==='/internal/ready') {
          if(incoming.method!=='GET'){sendJson(res,405,{error:'Method not allowed.'},{Allow:'GET'});return;}
          await ready();sendJson(res,200,{ok:true});return;
        }
        if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(incoming.socket.remoteAddress)||!gate){sendJson(res,403,{error:'Local control required.'});return;}
        if(incoming.method!=='POST'){sendJson(res,405,{error:'Method not allowed.'},{Allow:'POST'});return;}
        if(parsed.pathname==='/internal/handover/pause')await gate.pause();
        else if(parsed.pathname==='/internal/handover/activate')await gate.activate(activate);
        else if(parsed.pathname==='/internal/handover/resume')gate.resume();
        else {sendJson(res,404,{error:'Not found.'});return;}
        sendJson(res,200,gate.status());return;
      }
      const handler=routes?.[parsed.pathname]??(parsed.pathname.startsWith('/api/auth/')?authHandler:null);
      if(!handler){sendJson(res,404,{error:'Not found.'});return;}
      const execute=async()=>{
      const body=await boundedBody(incoming,1024*1024);
      const forwarded=Object.keys(incoming.headers).some(name=>name.startsWith('x-platform-'));
      const directOperator=parsed.pathname.startsWith('/api/operator-')||parsed.pathname.startsWith('/api/auth/');
      if(!forwarded&&!directOperator){sendJson(res,401,{error:'Request authentication failed.'});return;}
      if(forwarded&&!await verifyProxy(incoming,body,{secret:env.PLATFORM_PROXY_SECRET,consumeNonce})) {
        sendJson(res,401,{error:'Request authentication failed.'});return;
      }
      const headers={...incoming.headers};
      delete headers['x-forwarded-for'];delete headers['x-real-ip'];delete headers['x-vercel-forwarded-for'];
      const clientIp=forwarded?headers['x-platform-client-ip']:headers['cf-connecting-ip'];
      if(typeof clientIp==='string'&&isIP(clientIp))headers['x-forwarded-for']=clientIp;
      for(const name of Object.keys(headers))if(name.startsWith('x-platform-'))delete headers[name];
      const req=Readable.from(body.length?[body]:[]);
      Object.assign(req,{url:incoming.url,method:incoming.method,headers,rawHeaders:incoming.rawHeaders,socket:incoming.socket});
      await handler(req,res);
      if(!res.writableEnded)throw new Error('Handler did not complete.');
      };
      if(gate)await gate.run(execute);else await execute();
    }catch(error){if(!res.writableEnded)handleApiError(res,error);}
  });
  server.requestTimeout=45000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
  server.maxRequestsPerSocket=100;
  return server;
}
