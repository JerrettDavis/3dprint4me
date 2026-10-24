import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
const root=resolve(import.meta.dirname,'../partner/public'),host='127.0.0.1',port=Number(process.env.PARTNER_PORT??4190),apiOrigin=process.env.PARTNER_API_ORIGIN??'http://127.0.0.1:4173';
const api=new URL(apiOrigin);if(api.origin!==apiOrigin||api.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(api.hostname))throw new Error('Development API must be loopback.');
const routes=new Set(['/','/join','/gigs','/activity','/earnings','/agreements','/profile','/help']);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'};
const server=createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('X-Robots-Tag','noindex, nofollow');
 res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' ${apiOrigin}; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'`);
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return;}
 try{const url=new URL(req.url,'http://localhost');if(url.pathname==='/config.json'){res.setHeader('Content-Type',types['.json']);res.end(JSON.stringify({apiOrigin}));return;}
 const path=routes.has(url.pathname)||/^\/gigs\/[^/]+$/.test(url.pathname)?'/index.html':decodeURIComponent(url.pathname),target=resolve(root,'.'+path);
 if(!target.startsWith(root+sep))throw new Error();const bytes=await readFile(target);res.writeHead(200,{'Content-Type':types[extname(target)]??'application/octet-stream'});res.end(req.method==='HEAD'?undefined:bytes);
 }catch{res.writeHead(404);res.end('Not found.');}
});
server.listen(port,host,()=>console.log(`Partner shell: http://${host}:${port}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
