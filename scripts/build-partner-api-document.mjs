import { readFile,writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { commandInputSchemas } from './partner-api-input-schemas.mjs';

const root=new URL('../',import.meta.url);
const reads=['gigs','gig','earnings','agreements','profile','visits','leads','activity','referrals','statement','statements','export','own-export'];
const ownerReads=['session','programs','partners','campaigns','budgets','audit','gigs','gig','forecasts','earnings','ledger','legal','legal-version','legal-diff','legal-choices','agreement','agreements','review-feedback','review-package','statements','statement','exports','export','visits','leads','referrals'];
const json=schema=>({'application/json':{schema}});
const object=properties=>({type:'object',properties,additionalProperties:false});
const uuid={type:'string',format:'uuid',pattern:'^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[1-8][a-fA-F0-9]{3}-[89abAB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$'};
const origin={name:'Origin',in:'header',required:true,schema:{type:'string'},description:'Exact configured PARTNER_WEB_ORIGIN or OPERATOR_WEB_ORIGIN for this route; credentials are allowed only for that origin. Required for every non-GET request, including OPTIONS.'};
const csrf={name:'X-CSRF-Token',in:'header',required:true,schema:{type:'string'},description:'Session-specific token returned by the matching partner or owner session read. Tokens are not interchangeable.'};
const error={$ref:'#/components/schemas/Error'};
const headers={'Cache-Control':{schema:{const:'no-store'}},'Referrer-Policy':{schema:{const:'no-referrer'}},'X-Content-Type-Options':{schema:{const:'nosniff'}}};
const responseDefinitions=()=>Object.fromEntries(Object.entries({200:'Operation-specific JSON. Nested domain/result schemas remain to be completed.',400:'Invalid JSON, fields or domain input.',401:'Missing, expired, revoked or invalid credentials.',403:'Origin, CSRF, role or eligibility denied.',404:'Unknown or inaccessible record.',405:'Method not allowed.',409:'Revision, capacity, replay-payload or lifecycle conflict.',410:'Expired or changed derived export.',413:'JSON body exceeds route limit.',415:'Unsupported content type.',422:'Consent, contact, visit outcome or placement validation failed.',429:'Authentication rate limit.',503:'Sanitized unavailable service; no provider credentials or internal errors.'}).map(([status,description])=>[status,{description,headers,content:json(status==='200'?{type:'object',additionalProperties:true}:error)}]));
const responses=()=>Object.fromEntries(Object.keys(responseDefinitions()).map(status=>[status,{$ref:'#/components/responses/Status'+status}]));
const query=(name,schema={type:'string'})=>({name,in:'query',schema,description:'At most one value. Resource-specific requiredness and authorization are validated on the server.'});

export function commandFactoryNames(source){
 const expression=source.match(/const commands=\{([^;]+)\};/)?.[1];
 if(!expression)throw Error('Application command composition changed; update API inventory builder.');
 const call=/\.\.\.(\w+)\(\{[^{}]*\}\),/g;
 const factories=[...expression.matchAll(call)].map(m=>m[1]);
 if(!factories.length||expression.replace(call,'').trim()!=='...additionalCommands')throw Error('Unrecognized application command composition; update API inventory builder.');
 return factories;
}

export async function commandInventory(){
 const source=await readFile(new URL('lib/partner-outreach/application.js',root),'utf8');
 const inventory={};
 for(const factory of commandFactoryNames(source)){
  const declaration=[...source.matchAll(/import \{([^}]+)\} from '([^']+)'/g)].find(m=>m[1].split(',').map(x=>x.trim()).includes(factory));
  if(!declaration)throw Error('Cannot locate command factory '+factory);
  const module=await import(new URL('lib/partner-outreach/'+declaration[2].slice(2),root));
  for(const [name,command]of Object.entries(module[factory]({repo:{},approvals:{},now:()=>new Date('2026-10-24T12:00Z'),env:{}}))){
   if(inventory[name])throw Error('Duplicate command '+name);
   inventory[name]={roles:[command.role].flat().sort(),allowedFields:[...command.fields].sort(),receipt:'application'};
  }
 }
 inventory['partner.invite']={roles:['OWNER'],allowedFields:['partnerId','purpose'],receipt:'authentication'};
 inventory['partner.revoke']={roles:['OWNER'],allowedFields:['partnerId','status'],receipt:'authentication'};
 return Object.fromEntries(Object.entries(inventory).sort(([a],[b])=>a.localeCompare(b)));
}

export async function buildPartnerApiDocument(){
 const inventory=await commandInventory(),paths={},inputSchemas=commandInputSchemas();
 for(const [action,metadata]of Object.entries(inventory)){
  const schema=inputSchemas['CommandInput_'+action.replaceAll('.','_')];
  if(!schema||JSON.stringify(Object.keys(schema.properties).sort())!==JSON.stringify(metadata.allowedFields))throw Error('Typed input schema is missing or stale for '+action);
 }
 const options={summary:'Exact-origin preflight',security:[],parameters:[origin],responses:{204:{description:'Allowed origin; no body.',headers},403:{description:'Origin denied.',content:json(error)}}};
 const add=(path,method,operation)=>{paths[path]??={options};paths[path][method]={operationId:(method+'_'+path.replaceAll(/[^a-zA-Z0-9]/g,'_')),responses:responses(),...operation};};
 const envelope=role=>({...object({action:{type:'string',enum:Object.keys(inventory).filter(k=>inventory[k].roles.includes(role)).sort()},input:{type:'object',description:'See the action-specific input schema. Ownership, lifecycle and current policy checks remain server-authoritative.'},key:uuid}),required:['action','input','key'],oneOf:Object.keys(inventory).filter(k=>inventory[k].roles.includes(role)).map(action=>({properties:{action:{const:action},input:action==='statement.export'&&role==='OWNER'?{allOf:[{$ref:'#/components/schemas/CommandInput_statement_export'},{required:['partnerId']}]}:{$ref:'#/components/schemas/CommandInput_'+action.replaceAll('.','_')}}}))});
 const command=(role,limit)=>({summary:role+' command',security:[{[role==='OWNER'?'ownerCookie':'partnerCookie']:[]}],parameters:[origin,csrf],'x-max-body-bytes':limit,requestBody:{required:true,content:json(envelope(role))},description:'Send action, input and UUID key in JSON. Application commands persist same-key/same-payload receipts; a different payload conflicts. Authentication commands partner.invite and partner.revoke do not use application receipts: do not assume the body key deduplicates them. Idempotency-Key is not consumed as a command key.'});
 add('/api/partner/v1/status','get',{summary:'Invitation-only maintenance message',security:[]});
 add('/api/partner/v1/session','get',{summary:'Own active session and CSRF token; renews secure session cookie'});
 const password={type:'string',maxLength:128,writeOnly:true,description:'Maximum 512 UTF-8 bytes; invite redemption also requires at least 15 characters. Login failures are generic.'};
 for(const [path,properties]of [['login',{accountId:uuid,password}],['invite/redeem',{token:{type:'string',pattern:'^[A-Za-z0-9_-]{43}$',writeOnly:true},password:{...password,minLength:15}}]]){
  add('/api/partner/v1/'+path,'post',{summary:path==='login'?'Sign in with account ID and passphrase':'Redeem one-use enrollment/recovery invitation',security:[],parameters:[origin],'x-max-body-bytes':4096,requestBody:{required:true,content:json({...object(properties),required:Object.keys(properties)})}});
 }
 add('/api/partner/v1/logout','post',{summary:'Revoke current session and clear cookie',parameters:[origin,csrf]});
 add('/api/partner/v1/commands','post',command('PARTNER',262144));
 for(const resource of reads)add('/api/partner/v1/'+resource,'get',{summary:resource==='export'?'Reserved accounting export route (partner denied)':'Own scoped '+resource,parameters:[query('id',uuid),query('programId',uuid),query('compareTo',uuid),...(resource==='statements'?[query('before')]:[])],description:resource==='export'?'This transport route exists but the application restricts accounting exports to OWNER. Partner reads return 404; use own-export for partner personal-data and statement copies.':'Server checks ownership before returning private data. A query field accepted by transport may be denied or invalid for this resource. No arbitrary partnerId query override exists.',...(resource==='export'?{responses:{401:responses()[401],403:responses()[403],404:responses()[404],503:responses()[503]}}:{})});
 add('/api/operator-partners','get',{summary:'Owner resource multiplexer',security:[{ownerCookie:[]}],parameters:[query('resource',{type:'string',enum:ownerReads}),query('id',uuid),query('programId',uuid),query('compareTo',uuid),query('before')],description:'Defaults to programs. resource=session returns owner ID and CSRF token. Other successful reads include csrfToken alongside resource data. Requires the numeric GitHub-bound enabled owner session.'});
 add('/api/operator-partners','post',command('OWNER',786432));
 return {openapi:'3.1.1',info:{title:'3dprint4.me native partner API',version:'0.3.0-inputs',description:'Actual native transport and command field inventory; not yet a complete typed domain contract. No deployment or professional clearance is implied. Unknown query keys and duplicate query values are rejected. Successful and error JSON is private no-store. Request JSON accepts application/json and +json media types. Typed command inputs describe structural constraints; dynamic policy and response models remain tracked implementation work.'},servers:[{url:'/',description:'Relative to the configured API origin; deployment and same-site HTTPS must be independently verified.'}],security:[{partnerCookie:[]}],paths,components:{responses:Object.fromEntries(Object.entries(responseDefinitions()).map(([status,value])=>['Status'+status,value])),securitySchemes:{partnerCookie:{type:'apiKey',in:'cookie',name:'__Host-3dp-partner',description:'HttpOnly; Secure; Path=/; SameSite=Strict. Never expose cookie values in browser JavaScript.'},ownerCookie:{type:'apiKey',in:'cookie',name:'__Host-3dp-session',description:'Independent existing owner identity session; partner cookie cannot grant owner access.'}},schemas:{...inputSchemas,Error:{type:'object',required:['error'],properties:{error:{type:'string'},missingGates:{type:'array',items:{type:'string'}}},additionalProperties:false}}},'x-command-inventory':inventory};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const target=new URL('docs/partner-openapi.json',root),content=JSON.stringify(await buildPartnerApiDocument(),null,2)+'\n';
 if(process.argv.includes('--check')){
  if(await readFile(target,'utf8')!==content)throw Error('Partner API document is stale; run node scripts/build-partner-api-document.mjs.');
  console.log('Partner API transport document matches command metadata.');
 }else{await writeFile(target,content);console.log('Wrote docs/partner-openapi.json.');}
}
