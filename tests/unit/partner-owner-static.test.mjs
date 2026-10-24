import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('owner shell hosting uses no-store and a restrictive native-origin CSP',async()=>{
 const config=JSON.parse(await readFile('operator/vercel.json','utf8'));
 const row=config.headers.find(row=>row.source==='/partners(.*)');assert.ok(row);
 const headers=Object.fromEntries(row.headers.map(h=>[h.key,h.value]));assert.equal(headers['Cache-Control'],'no-store');
 assert.match(headers['Content-Security-Policy'],/connect-src 'self' https:\/\/api\.3dprint4\.me;/);assert.ok(!headers['Content-Security-Policy'].includes('unsafe-inline'));
 const html=await readFile('operator/partners.html','utf8');for(const script of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){assert.match(script[1],/src="\/assets\//);assert.equal(script[2].trim(),'');}
});
test('owner shell service-worker additions contain only static resources and never private API payloads',async()=>{
 const source=await readFile('operator/sw.js','utf8');const assets=JSON.parse(source.match(/const SHELL_ASSETS = (\[[^;]+\]);/)[1]);
 for(const path of ['/partners','/partners.html','/assets/partner-owner.js','/assets/partner-owner-client.js','/assets/partner-owner-access.js','/assets/partner-owner-leads.js','/assets/partner-owner-referrals.js','/assets/partner-owner-finance.js','/assets/partner-owner-legal.js','/assets/partner-owner.css'])assert.ok(assets.includes(path));
 assert.ok(assets.every(path=>!path.startsWith('/api/')));assert.match(source,/url\.pathname\.startsWith\("\/api\/"\)/);
});
