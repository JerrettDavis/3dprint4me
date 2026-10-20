import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { isIP } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { boundedBody, verifyProxy } from './proxy.js';
import { handleApiError, sendJson } from '../http.js';

// The replay store is supplied by the private database in production. It must
// atomically consume nonces; process-local memory is insufficient across restarts.
export function createPlatformServer({ routes, env=process.env, consumeNonce, authHandler, ready }={}) {
  if(env.LOCAL_DEV==='1'||env.SELF_HOSTED_API_ORIGIN)throw new Error('Unsafe API server configuration.');
  const server=createServer({maxHeaderSize:16384},async (incoming,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    try {
      const parsed=new URL(incoming.url,'http://api.internal');
      if(incoming.url!==parsed.pathname+parsed.search) {sendJson(res,400,{error:'Invalid request.'});return;}
      if(parsed.pathname==='/internal/ready') {
        const expected=Buffer.from('Bearer '+(env.PLATFORM_PROXY_SECRET??'')),actual=Buffer.from(String(incoming.headers.authorization??''));
        if(!env.PLATFORM_PROXY_SECRET||expected.length!==actual.length||!timingSafeEqual(expected,actual)){sendJson(res,401,{error:'Authentication required.'});return;}
        if(incoming.method!=='GET'){sendJson(res,405,{error:'Method not allowed.'},{Allow:'GET'});return;}
        await ready();sendJson(res,200,{ok:true});return;
      }
      const handler=routes?.[parsed.pathname]??(parsed.pathname.startsWith('/api/auth/')?authHandler:null);
      if(!handler){sendJson(res,404,{error:'Not found.'});return;}
      const body=await boundedBody(incoming,1024*1024);
      const forwarded=Object.keys(incoming.headers).some(name=>name.startsWith('x-platform-'));
      if(forwarded&&!await verifyProxy(incoming,body,{secret:env.PLATFORM_PROXY_SECRET,consumeNonce})) {
        sendJson(res,401,{error:'Request authentication failed.'});return;
      }
      const headers={...incoming.headers};
      delete headers['x-forwarded-for'];delete headers['x-real-ip'];
      const clientIp=forwarded?headers['x-platform-client-ip']:headers['cf-connecting-ip'];
      if(typeof clientIp==='string'&&isIP(clientIp))headers['x-forwarded-for']=clientIp;
      for(const name of Object.keys(headers))if(name.startsWith('x-platform-'))delete headers[name];
      const req=Readable.from(body.length?[body]:[]);
      Object.assign(req,{url:incoming.url,method:incoming.method,headers,rawHeaders:incoming.rawHeaders,socket:incoming.socket});
      await handler(req,res);
      if(!res.writableEnded)throw new Error('Handler did not complete.');
    }catch(error){if(!res.writableEnded)handleApiError(res,error);}
  });
  server.requestTimeout=45000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
  server.maxRequestsPerSocket=100;
  return server;
}
