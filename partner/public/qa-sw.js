// Static shell only. Private requests never enter Cache Storage.
const CACHE='partner-qa-shell-v4',PREFIX='partner-qa-shell-';
const STATIC=['/qa','/config.json','/manifest.webmanifest','/qa-assets/icon.svg','/qa-assets/icon-192.png','/qa-assets/icon-512.png','/qa-assets/partner.css','/qa-assets/partner.js','/qa-assets/client.js','/qa-assets/drafts.js','/qa-assets/visits.js','/qa-assets/pwa.js','/qa-assets/offline-workspace.js','/qa-assets/statements.js'];
let work=Promise.resolve();
function serialize(run){const result=work.then(run);work=result.catch(()=>{});return result;}
async function prepare(){
 const cache=await caches.open(CACHE),marker='<meta name="partner-qa-shell-release" content="'+'partner-qa-shell-v4'+'">';
 const existing=await Promise.all(STATIC.map(path=>cache.match(path)));
 if(existing.every(Boolean)&&(await existing[0].text()).includes(marker))return;
 // An old active worker must not reseed its version with a newly deployed shell.
 const current=await fetch(new Request('/qa',{credentials:'omit',cache:'reload',redirect:'error'}));
 if(!current.ok||!(await current.text()).includes(marker))throw Error('Shell update requires reopening partner tabs.');
 await cache.addAll(STATIC.map(path=>new Request(path,{credentials:'omit',cache:'reload',redirect:'error'})));
 if(!(await(await cache.match('/qa')).text()).includes(marker)){await caches.delete(CACHE);throw Error('Shell release changed.');}
}
self.addEventListener('install',event=>event.waitUntil(serialize(prepare)));
self.addEventListener('activate',event=>event.waitUntil(serialize(async()=>{for(const name of await caches.keys())if(name.startsWith(PREFIX)&&name!==CACHE)await caches.delete(name);await self.clients.claim();})));
self.addEventListener('message',event=>{
 if(!event.source?.url||new URL(event.source.url).origin!==self.location.origin)return;
 if(!['CLEAR_STATIC_CACHE','PREPARE_OFFLINE'].includes(event.data?.type))return;
 event.waitUntil(serialize(async()=>{try{if(event.data.type==='CLEAR_STATIC_CACHE'){for(const name of await caches.keys())if(name.startsWith(PREFIX))await caches.delete(name);}else await prepare();event.ports[0]?.postMessage({ok:true});}catch{event.ports[0]?.postMessage({ok:false});}}));
});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin)return;
 const pathInQa=url.pathname==='/qa'?'/':url.pathname.startsWith('/qa/')?url.pathname.slice(3):null;
 const navigation=request.mode==='navigate'&&pathInQa!==null&&(/^\/gigs\/[0-9a-f-]{36}$/i.test(pathInQa)||['/','/join','/gigs','/visits','/visits/new','/drafts','/activity','/earnings','/referrals','/agreements','/profile','/help'].includes(pathInQa));
 const path=navigation?'/qa':url.pathname;
 if(!navigation&&(!STATIC.includes(path)||url.search))return;
 event.respondWith((async()=>{const saved=await caches.match(path,{cacheName:CACHE});if(saved)return saved;return fetch(request);})());
});
