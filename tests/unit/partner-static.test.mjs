import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {resolve,relative,sep} from 'node:path';
const root=resolve('partner/public');
async function files(dir=root){const rows=[];for(const entry of await readdir(dir,{withFileTypes:true})){const path=resolve(dir,entry.name);if(entry.isDirectory())rows.push(...await files(path));else rows.push(path);}return rows;}

test('partner hosting emits only explicit static shell assets and restrictive headers',async()=>{
 const config=JSON.parse(await readFile('partner/vercel.json','utf8'));assert.equal(config.outputDirectory,'public');assert.ok(config.rewrites.some(route=>route.source==='/referrals'&&route.destination==='/'),'referral deep links load the shell');
 const headers=Object.fromEntries(config.headers[0].headers.map(h=>[h.key,h.value]));
 assert.equal(headers['Cache-Control'],'no-store');assert.equal(headers['Referrer-Policy'],'no-referrer');assert.equal(headers['X-Robots-Tag'],'noindex, nofollow');
 assert.match(headers['Content-Security-Policy'],/connect-src 'self' https:\/\/api\.3dprint4\.me;/);assert.ok(!headers['Content-Security-Policy'].includes('unsafe-inline'));assert.match(headers['Content-Security-Policy'],/frame-ancestors 'none'/);
 const actual=(await files()).map(p=>relative(root,p).replaceAll('\\','/')).sort();
 assert.deepEqual(actual,['assets/client.js','assets/drafts.js','assets/icon-192.png','assets/icon-512.png','assets/icon.svg','assets/offline-workspace.js','assets/partner.css','assets/partner.js','assets/pwa.js','assets/visits.js','config.json','index.html','manifest.webmanifest','sw.js']);
});

test('partner shell has no inline scripts, remote styles or server-side imports',async()=>{
 const html=await readFile(resolve(root,'index.html'),'utf8');
 for(const script of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){assert.match(script[1],/src="\/assets\//);assert.equal(script[2].trim(),'');}
 for(const file of await files())if(file.endsWith('.js')){const source=await readFile(file,'utf8');for(const match of source.matchAll(/from ['"]([^'"]+)['"]/g)){assert.ok(match[1].startsWith('./'));assert.ok(resolve(file,'..',match[1]).startsWith(root+sep));}}
 const css=await readFile(resolve(root,'assets/partner.css'),'utf8');assert.ok(!/@import|https?:/i.test(css));
});

test('partner displays the exact versioned server contact permission text',async()=>{const {CONTACT_PERMISSION_TEXT}=await import('../../partner/public/assets/visits.js');const {CONSENT_TEXT}=await import('../../lib/partner-outreach/visits.js');assert.equal(CONTACT_PERMISSION_TEXT,CONSENT_TEXT);});


test('partner shell release marker matches the worker cache version',async()=>{
 const worker=await readFile(resolve(root,'sw.js'),'utf8'),html=await readFile(resolve(root,'index.html'),'utf8');
 const version=/const CACHE='([^']+)'/.exec(worker)[1];assert.ok(html.includes('<meta name="partner-shell-release" content="'+version+'">'));
});
