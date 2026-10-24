import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPartnerHandlers } from '../../lib/partner-outreach/http.js';
import { buildPartnerApiDocument } from '../../scripts/build-partner-api-document.mjs';
import * as builder from '../../scripts/build-partner-api-document.mjs';

const root=new URL('../../',import.meta.url);
const document=()=>readFile(new URL('docs/partner-openapi.json',root),'utf8').then(JSON.parse);

test('inventory discovery fails closed when application composition introduces an unknown entry',()=>{
 assert.deepEqual(builder.commandFactoryNames('const commands={...workCommands({repo,now}),...additionalCommands};'),['workCommands']);
 for(const composition of ['...workCommands({repo}),...newRegistry,...additionalCommands','...workCommands({repo}),"new.action":handler,...additionalCommands','...workCommands({repo})']){
  assert.throws(()=>builder.commandFactoryNames('const commands={'+composition+'};'),/composition/);
 }
});

test('checked-in API document is fresh and contains only local schema references',async()=>{
 const doc=await document();assert.deepEqual(doc,await buildPartnerApiDocument());
 function visit(value){
  if(!value||typeof value!=='object')return;
  if(value.$ref){
   assert.ok(value.$ref.startsWith('#/'));
   assert.ok(value.$ref.slice(2).split('/').reduce((o,k)=>o?.[k],doc),'Unresolved schema reference '+value.$ref);
  }
  for(const nested of Object.values(value))visit(nested);
 }
 visit(doc);
 const owner=doc.paths['/api/operator-partners'].get.parameters.find(p=>p.name==='resource').schema.enum;
 assert.ok(!owner.includes('activity'));assert.ok(!owner.includes('own-export'));
 assert.ok(!doc.paths['/api/partner/v1/export'].get.responses['200']);
 assert.ok(doc.paths['/api/partner/v1/export'].get.responses['400']);
 assert.ok(doc.paths['/api/partner/v1/export'].get.responses['405']);
});

test('documented API paths, authentication and command transport match native handlers',async()=>{
 const doc=await document(),native=createPartnerHandlers({getRuntime:()=>{throw Error('No runtime required');},env:{}});
 assert.equal(doc.openapi,'3.1.1');
 assert.deepEqual(Object.keys(doc.paths).sort(),Object.keys(native.routes).sort());
 assert.equal(doc.components.securitySchemes.partnerCookie.name,'__Host-3dp-partner');
 assert.equal(doc.components.securitySchemes.ownerCookie.name,'__Host-3dp-session');
 assert.deepEqual(doc.paths['/api/partner/v1/status'].get.security,[]);
 assert.deepEqual(doc.paths['/api/partner/v1/login'].post.security,[]);
 assert.deepEqual(doc.paths['/api/partner/v1/invite/redeem'].post.security,[]);
 for(const [path,limit]of [['/api/partner/v1/commands',262144],['/api/operator-partners',786432]]){
  const operation=doc.paths[path].post;
  assert.equal(operation['x-max-body-bytes'],limit);
  assert.ok(operation.parameters.some(p=>p.name==='X-CSRF-Token'&&p.in==='header'&&p.required));
  assert.ok(!operation.parameters.some(p=>p.name==='Idempotency-Key'));
  const schema=operation.requestBody.content['application/json'].schema;
  assert.deepEqual(schema.required,['action','input','key']);assert.equal(schema.additionalProperties,false);
  assert.equal(schema.properties.key.format,'uuid');
  assert.ok(operation.responses['422'],'Validation errors preserve 422 through native HTTP');
 }
 assert.deepEqual(doc.servers,[{url:'/',description:'Relative to the configured API origin; deployment and same-site HTTPS must be independently verified.'}]);
});

test('published command roles and allowed fields cover every application command factory',async()=>{
 const doc=await document(),source=await readFile(new URL('lib/partner-outreach/application.js',root),'utf8');
 const expression=source.match(/const commands=\{([^;]+)\};/)[1];
 const factories=[...expression.matchAll(/\.\.\.(\w+)\(\{/g)].map(m=>m[1]);
 assert.ok(factories.length>=12);
 const expected={};
 for(const factory of factories){
  const declaration=[...source.matchAll(/import \{([^}]+)\} from '([^']+)'/g)].find(m=>m[1].split(',').map(x=>x.trim()).includes(factory));
  assert.ok(declaration,'Factory import must be discoverable: '+factory);
  const module=await import(new URL('lib/partner-outreach/'+declaration[2].slice(2),root));
  const commands=module[factory]({repo:{},approvals:{},now:()=>new Date('2026-10-24T12:00Z'),env:{}});
  for(const [name,command]of Object.entries(commands)){
   assert.ok(!expected[name],'Duplicate command '+name);
   expected[name]={roles:[command.role].flat().sort(),allowedFields:[...command.fields].sort(),receipt:'application'};
  }
 }
 expected['partner.invite']={roles:['OWNER'],allowedFields:['partnerId','purpose'],receipt:'authentication'};
 expected['partner.revoke']={roles:['OWNER'],allowedFields:['partnerId','status'],receipt:'authentication'};
 assert.deepEqual(doc['x-command-inventory'],Object.fromEntries(Object.entries(expected).sort(([a],[b])=>a.localeCompare(b))));
 const partnerActions=doc.paths['/api/partner/v1/commands'].post.requestBody.content['application/json'].schema.properties.action.enum;
 assert.deepEqual(partnerActions,Object.keys(expected).filter(k=>expected[k].roles.includes('PARTNER')).sort());
});

test('every published command has a closed typed input schema and role-scoped envelope branch',async()=>{
 const doc=await document();
 for(const [action,metadata]of Object.entries(doc['x-command-inventory'])){
  const name='CommandInput_'+action.replaceAll('.','_'),schema=doc.components.schemas[name];
  assert.ok(schema,'Missing typed input '+action);
  assert.equal(schema.type,'object');assert.equal(schema.additionalProperties,false);
  assert.deepEqual(Object.keys(schema.properties).sort(),metadata.allowedFields);
  assert.ok(schema.required.every(key=>metadata.allowedFields.includes(key)));
  assert.ok(doc['x-command-responses'][action]?.$ref,'Missing command result '+action);
  for(const [field,value]of Object.entries(schema.properties))assert.ok(value.type||value.$ref||value.anyOf||value.oneOf,action+'.'+field+' must have a type');
 }
 for(const [path,role]of [['/api/partner/v1/commands','PARTNER'],['/api/operator-partners','OWNER']]){
  const schema=doc.paths[path].post.requestBody.content['application/json'].schema;
  assert.deepEqual(schema.oneOf.map(branch=>branch.properties.action.const),Object.keys(doc['x-command-inventory']).filter(action=>doc['x-command-inventory'][action].roles.includes(role)));
 }
});

test('every successful read has a resource response and explicit canonical query contract',async()=>{
 const doc=await document();
 for(const [path,value]of Object.entries(doc.paths)){
  if(!value.get||path==='/api/operator-partners'||path==='/api/partner/v1/export')continue;
  const operation=value.get;
  assert.ok(operation.responses['200'].content?.['application/json']?.schema,'Untyped read '+path);
  assert.equal(operation['x-query-schema'].additionalProperties,false,path);
 }
 const owner=doc.paths['/api/operator-partners'].get;
 const resources=owner.parameters.find(p=>p.name==='resource').schema.enum;
 assert.deepEqual(Object.keys(owner['x-resource-contracts']).sort(),[...resources].sort());
 for(const contract of Object.values(owner['x-resource-contracts'])){
  assert.ok(contract.response.$ref);assert.equal(contract.query.additionalProperties,false);
 }
 assert.deepEqual(doc.paths['/api/partner/v1/gig'].get['x-query-schema'].required,['id']);
 assert.deepEqual(owner['x-resource-contracts']['legal-diff'].query.required,['id','compareTo']);
 assert.equal(doc.components.schemas.PartnerGigDetailResponse.properties.materials.maxItems,200);
 assert.ok(doc.components.schemas.PartnerGigDetailResponse.required.includes('materialsHasMore'));
 assert.equal(doc.components.schemas.Gig.properties.terms.$ref,'#/components/schemas/OfferSnapshot');
});
