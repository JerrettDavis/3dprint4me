import {readZipDirectory,readZipEntry} from '../../public/assets/js/print-estimation/three-mf.js';
import {canonical,unbase64,REVIEW_ARCHIVE_MAX} from '../assets/review-envelope.js';
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true}),HASH=/^[a-f0-9]{64}$/;
const bad=()=>Error('Review archive verification failed. Obtain a fresh package through the agreed trusted channel.');
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
async function inflateBounded(data,max){
 const reader=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(),chunks=[];let total=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>max)throw bad();chunks.push(value);}const result=new Uint8Array(total);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;}
 finally{await reader.cancel().catch(()=>{});}
}
export async function verifyReviewArchive(bytes,fingerprint,{now=new Date(),inflateRaw=inflateBounded}={}){
 if(!HASH.test(fingerprint))throw Error('Enter the independently trusted signing fingerprint (64 hexadecimal characters).');
 try{
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>REVIEW_ARCHIVE_MAX)throw bad();
  const limits={maxZipEntries:100,maxCompressionRatio:10000},entries=readZipDirectory(bytes,limits),budget={remaining:64*1024*1024};
  for(const entry of entries.values())if(entry.special||entry.isDirectory||!/^[-A-Za-z0-9_.]+$/.test(entry.name)||entry.uncompressedSize>32*1024*1024)throw bad();
  const read=async(name,max)=>{const entry=entries.get(name.toLowerCase());if(!entry||entry.name!==name||entry.uncompressedSize>max)throw bad();return readZipEntry(bytes,entry,budget,limits,inflateRaw);};
  const manifestBytes=await read('manifest.json',256*1024),signatureBytes=await read('signature.json',2048),manifest=JSON.parse(decoder.decode(manifestBytes)),signature=JSON.parse(decoder.decode(signatureBytes));
  if(signature.algorithm!=='Ed25519'||typeof signature.publicKey!=='string'||signature.publicKey.length>256||await sha(encoder.encode(signature.publicKey))!==fingerprint||manifest.publicKeyFingerprint!==fingerprint)throw Error('The archive does not match the independently trusted signing fingerprint.');
  const match=/^-----BEGIN PUBLIC KEY-----\n([A-Za-z0-9+/=\n]+)-----END PUBLIC KEY-----\n$/.exec(signature.publicKey);if(!match)throw bad();
  const key=await crypto.subtle.importKey('spki',unbase64(match[1].replaceAll('\n',''),64),{name:'Ed25519'},false,['verify']);
  if(!await crypto.subtle.verify('Ed25519',key,unbase64(signature.signature,64),encoder.encode(canonical(manifest))))throw bad();
  if(manifest.schemaVersion!==1||manifest.private!==true||!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>98||entries.size!==manifest.files.length+2||!Array.isArray(manifest.documents)||!manifest.documents.length||manifest.documents.length>20||!Array.isArray(manifest.reviewers)||!manifest.reviewers.length||manifest.reviewers.length>8)throw bad();
  const expires=new Date(manifest.expiresAt);if(!Number.isFinite(expires.getTime())||expires<=now)throw Error('This review grant has expired. Ask the owner for a fresh package. Offline copies cannot be recalled.');
  const seen=new Set(),files=[];
  for(const file of manifest.files){
   if(typeof file.name!=='string'||!/^[a-zA-Z0-9_.-]+\.(?:md|docx|json|csv|txt)$/.test(file.name)||['manifest.json','signature.json'].includes(file.name)||seen.has(file.name.toLowerCase())||!Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>32*1024*1024||!HASH.test(file.sha256))throw bad();
   seen.add(file.name.toLowerCase());const content=await read(file.name,file.bytes);if(content.length!==file.bytes||await sha(content)!==file.sha256)throw bad();files.push({name:file.name,bytes:content});
  }
  return {manifest,files,archiveSha256:await sha(bytes)};
 }catch(error){if(/independently trusted signing fingerprint|grant has expired/.test(error.message))throw error;throw bad();}
}
