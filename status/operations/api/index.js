import { createHmac } from 'node:crypto';

// Deploy only to the separately protected operations project. Its read credential
// cannot write telemetry, read application data or control the production stack.
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET'){res.statusCode=405;res.setHeader('Allow','GET');res.end();return;}
  if(process.env.OPERATIONS_PROTECTION_VERIFIED!=='1'||!process.env.STATUS_READER_SECRET){res.statusCode=503;res.end('Operations access is not configured.');return;}
  try{
    const time=String(Date.now()),signature=createHmac('sha256',process.env.STATUS_READER_SECRET).update('/operations-reader\n'+time).digest('hex');
    const response=await fetch('https://status-api.3dprint4.me/operations-reader',{headers:{'x-status-read-time':time,'x-status-read-signature':signature,'User-Agent':'3dprint4me-operations/1'},redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('Evidence unavailable.');
    const body=await response.text();if(body.length>32768)throw new Error('Evidence bound.');
    res.setHeader('Content-Type','text/html;charset=utf-8');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    res.statusCode=200;res.end(body);
  }catch{res.statusCode=503;res.end('Operational evidence is temporarily unavailable.');}
}
