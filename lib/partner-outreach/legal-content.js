import { HttpError,isValidEmail } from '../http.js';
import { canonicalJson,digest } from './postgres-repository.js';
import { exact,text,integer,date } from './validation.js';
import { REVIEW_SCOPES } from './approvals.js';
const TYPES=new Set(['string','multiline','private-person-name','email','date','money','integer']);
const variablePattern=/{{([a-z][a-z0-9_]{1,79})}}/g;
function typed(value,type){
 if(type==='money'||type==='integer')return integer(value,0,2147483647);
 if(type==='date')return date(value);
 const result=text(value,type==='multiline'?10000:2000);
 if(type==='email'&&!isValidEmail(result))throw new HttpError(400,'A template email value is invalid.');
 return result;
}
function safeLinks(markdown){
 if(/<\/?[a-z][^>]*>/i.test(markdown)||/!\[/.test(markdown)||/\]\(\s*(?:javascript|data|file):/i.test(markdown))throw new HttpError(400,'Templates support text Markdown without HTML, remote images or active content.');
 for(const match of markdown.matchAll(/https?:\/\/[^\s<>"')]+/g)){const url=new URL(match[0]);if(url.username||url.password||url.search)throw new HttpError(400,'Remove credentials and query strings from document references.');}
}
export function prepareLegalVersion(input){
 const title=text(input.title,200),markdown=text(input.markdown,200000).replace(/\r\n?/g,'\n').normalize('NFC')+'\n';
 if(typeof input.issuable!=='boolean')throw new HttpError(400,'Specify whether the text is ready for reviewed issuance.');
 if(input.issuable&&/\bDRAFT\b|NOT ACTIVE|NON[- ]?BINDING|FOR (?:ATTORNEY )?REVIEW ONLY|NOT AN OFFER|NOT AN? EXECUTED/i.test(markdown.slice(0,800)))throw new HttpError(400,'Discussion drafts cannot be marked ready for issuance.');
 safeLinks(markdown);
 const sourceSchema=input.variablesSchema??{};if(!sourceSchema||typeof sourceSchema!=='object'||Array.isArray(sourceSchema)||Object.keys(sourceSchema).length>80)throw new HttpError(400,'Invalid template variable schema.');
 const schema={};
 for(const [key,descriptor]of Object.entries(sourceSchema)){
  if(!/^[a-z][a-z0-9_]{1,79}$/.test(key))throw new HttpError(400,'Invalid template variable name.');exact(descriptor,['type','required','default']);
  if(!TYPES.has(descriptor.type)||(descriptor.required!==undefined&&typeof descriptor.required!=='boolean'))throw new HttpError(400,'Invalid template variable type.');
  const field={type:descriptor.type,required:descriptor.required??false};if(Object.hasOwn(descriptor,'default'))field.default=typed(descriptor.default,descriptor.type);schema[key]=Object.freeze(field);
 }
 const refs=[...markdown.matchAll(variablePattern)].map(x=>x[1]);
 if(refs.some(key=>!Object.hasOwn(schema,key))||/\{\{|\}\}/.test(markdown.replace(variablePattern,'')))throw new HttpError(400,'Register every template variable with a supported type.');
 const scopes=[...new Set(input.requiredScopes??['agreement_language'])].sort();if(scopes.some(s=>!REVIEW_SCOPES.includes(s))||!scopes.includes('agreement_language'))throw new HttpError(400,'Document language review is mandatory.');
 const core={title,markdown,variablesSchema:schema,issuable:input.issuable,requiredScopes:scopes};return Object.freeze({...core,variablesSchema:Object.freeze(schema),requiredScopes:Object.freeze(scopes),hash:digest(canonicalJson(core))});
}
export function storedLegalVersion(row){
 const version=prepareLegalVersion({title:row.title,markdown:row.markdown,variablesSchema:row.variables_schema,issuable:row.issuable,requiredScopes:row.required_scopes});
 if(version.hash!==row.content_sha256)throw new HttpError(503,'Document integrity verification failed.');return version;
}
const escapeMarkdown=value=>String(value).replace(/[\\`*_{}\[\]()<>#!|]/g,'\\$&');
export function renderLegalVersion(version,bindings={}){
 exact(bindings,Object.keys(version.variablesSchema));const used=[...new Set([...version.markdown.matchAll(variablePattern)].map(x=>x[1]))],values={};
 for(const key of used){const field=version.variablesSchema[key],value=Object.hasOwn(bindings,key)?bindings[key]:field.default;if(value===undefined){if(field.required)throw new HttpError(400,'A required template value is missing.');values[key]='';}else values[key]=typed(value,field.type);}
 const markdown=version.markdown.replace(variablePattern,(_,key)=>{const value=values[key];if(value==='')return '';return version.variablesSchema[key].type==='money'?(value/100).toFixed(2):escapeMarkdown(value);});
 return {markdown,bindings:values,hash:digest(canonicalJson({versionHash:version.hash,markdown,bindings:values}))};
}
export function compareLegalVersions(before,after){
 const a=before.replace(/\r\n?/g,'\n').split('\n'),b=after.replace(/\r\n?/g,'\n').split('\n');let first=0,last=0;
 while(first<Math.min(a.length,b.length)&&a[first]===b[first])first++;
 while(last<Math.min(a.length-first,b.length-first)&&a[a.length-1-last]===b[b.length-1-last])last++;
 const clauses=source=>{const result=new Map();let anchor='preamble';for(const line of source.split('\n')){const m=/^#{1,6}\s+\[([A-Za-z0-9_-]+)\]/.exec(line);if(m)anchor=m[1];result.set(anchor,(result.get(anchor)??'')+line+'\n');}return result;};
 const old=clauses(before),next=clauses(after);return {changed:before!==after,startLine:first+1,beforeLines:a.slice(first,a.length-last),afterLines:b.slice(first,b.length-last),clauses:[...new Set([...old.keys(),...next.keys()])].map(anchor=>({anchor,changed:old.get(anchor)!==next.get(anchor),before:old.get(anchor)??'',after:next.get(anchor)??''}))};
}
