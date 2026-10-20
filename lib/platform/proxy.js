import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { HttpError, sendJson } from '../http.js';

const routes = new Set(['checkout', 'health', 'home-assistant-work', 'inquiry', 'operator-print',
  'operator-push', 'operator-session', 'operator-work-update', 'operator-work', 'print-estimate', 'request', 'upload-url'].map(x => `/api/${x}`));
const requestHeaders = ['authorization', 'content-type', 'idempotency-key', 'origin', 'x-print-estimate-token'];
const responseHeaders = ['content-type', 'allow', 'retry-after', 'access-control-allow-origin',
  'access-control-allow-credentials', 'access-control-allow-methods', 'access-control-allow-headers', 'vary'];
const maxRequest = 1024 * 1024, maxResponse = 2 * 1024 * 1024;
function header(req, name) {
  const value = req.headers?.[name];
  if (Array.isArray(value) || /[\r\n]/.test(String(value ?? ''))) throw new Error('Invalid header.');
  return String(value ?? '');
}
function validSecret(secret) { return typeof secret === 'string' && secret.length >= 32 && secret.length <= 512; }
function validPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('#') || /[\r\n\\]/.test(path)) return false;
  const parsed = new URL(path, 'https://api.3dprint4.me');
  return routes.has(parsed.pathname) && path === parsed.pathname + parsed.search;
}
function canonical(req, body, headers) {
  return JSON.stringify([1, req.method, req.url, headers['x-platform-timestamp'], headers['x-platform-nonce'],
    headers['x-platform-client-ip'], requestHeaders.map(name => [name, headers[name] ?? '']),
    createHash('sha256').update(body).digest('hex')]);
}
export function signProxy(req, body, { secret, now = Date.now(), nonce = randomBytes(24).toString('hex'), clientIp = '' }) {
  if (!validSecret(secret) || !validPath(req.url)) throw new Error('Invalid forwarding configuration.');
  const headers = Object.fromEntries(requestHeaders.map(name => [name, header(req, name)]).filter(([,value]) => value));
  Object.assign(headers, { 'x-platform-timestamp': String(now), 'x-platform-nonce': nonce, 'x-platform-client-ip': clientIp });
  headers['x-platform-signature'] = createHmac('sha256', secret).update(canonical(req, body, headers)).digest('hex');
  return headers;
}
export async function verifyProxy(req, body, { secret, consumeNonce, now = Date.now() }) {
  try {
    if (!validSecret(secret) || !validPath(req.url) || !Buffer.isBuffer(body) || body.length > maxRequest) return false;
    const headers = Object.fromEntries([...requestHeaders, 'x-platform-timestamp', 'x-platform-nonce', 'x-platform-client-ip', 'x-platform-signature'].map(name => [name, header(req,name)]));
    if (!/^\d{1,16}$/.test(headers['x-platform-timestamp']) || Math.abs(now - Number(headers['x-platform-timestamp'])) > 60000 ||
        !/^[a-zA-Z0-9_-]{32,96}$/.test(headers['x-platform-nonce']) || !/^[a-f0-9]{64}$/.test(headers['x-platform-signature']) ||
        (headers['x-platform-client-ip'] && !isIP(headers['x-platform-client-ip']))) return false;
    const expected = createHmac('sha256',secret).update(canonical(req,body,headers)).digest();
    if (!timingSafeEqual(expected,Buffer.from(headers['x-platform-signature'],'hex'))) return false;
    return (await consumeNonce(headers['x-platform-nonce'], Number(headers['x-platform-timestamp']) + 60000)) === true;
  } catch { return false; }
}
export async function boundedBody(stream, limit) {
  let size=0; const chunks=[];
  for await (const chunk of stream) {
    const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=bytes.length;
    if(size>limit) throw new HttpError(413,'Request body is too large.');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
async function requestBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return Buffer.alloc(0);
  let body;
  if (req.body !== undefined) body=Buffer.isBuffer(req.body)?req.body:Buffer.from(typeof req.body==='string'?req.body:JSON.stringify(req.body));
  else body=await boundedBody(req,maxRequest);
  if(body.length>maxRequest)throw new HttpError(413,'Request body is too large.');
  return body;
}
export function createProxy({ env=process.env, fetchImpl=fetch }={}) {
  return async function proxy(req,res) {
    if (!env.SELF_HOSTED_API_ORIGIN) return false;
    try {
      const origin=new URL(env.SELF_HOSTED_API_ORIGIN);
      if(origin.href!=='https://api.3dprint4.me/' || !validSecret(env.PLATFORM_PROXY_SECRET) || !validPath(req.url))throw new Error('Invalid forwarding configuration.');
      const body=await requestBody(req);
      const candidate=header(req,'x-forwarded-for').split(',')[0].trim();
      const headers=signProxy(req,body,{secret:env.PLATFORM_PROXY_SECRET,clientIp:isIP(candidate)?candidate:''});
      const upstream=await fetchImpl(origin.origin+req.url,{method:req.method,headers,
        ...(body.length?{body}:{}),redirect:'manual',signal:AbortSignal.timeout(35000)});
      if(upstream.status>=300&&upstream.status<400)throw new Error('Unexpected redirect.');
      const result=upstream.body?await boundedBody(upstream.body,maxResponse).catch(()=>{throw new Error('Invalid upstream response.');}):Buffer.alloc(0);
      res.statusCode=upstream.status;res.setHeader('Cache-Control','no-store');
      for(const name of responseHeaders){const value=upstream.headers.get(name);if(value)res.setHeader(name,value);}
      res.end(result);
    } catch(error) {
      sendJson(res,error instanceof HttpError&&error.status===413?413:503,{error:error instanceof HttpError&&error.status===413?'Request body is too large.':'The service is temporarily unavailable.'});
    }
    return true;
  };
}
export const maybeProxy=createProxy();
export function withPlatformProxy(handler) {
  return async (req,res) => { if (!await maybeProxy(req,res)) return handler(req,res); };
}
