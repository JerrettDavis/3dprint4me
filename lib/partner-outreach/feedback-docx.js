import { inflateRawSync } from 'node:zlib';
import { XMLParser } from 'fast-xml-parser';
import { HttpError } from '../http.js';
import { readZipDirectory,readZipEntry } from '../../public/assets/js/print-estimation/three-mf.js';
import { crc32 } from '../../public/assets/js/print-estimation/archive.js';

export const FEEDBACK_MAX_BYTES=524288;
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const parser=new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,trimValues:false,maxNestedTags:40,ignoreDeclaration:true,ignorePiTags:true});
const bad=()=>new HttpError(400,'Use a valid, bounded DOCX without macros, embedded files, external links or templates. You can enter review comments manually instead.');
const tag=node=>Object.keys(node).find(k=>k!==':@');
const attrs=node=>node[':@']??{};
function* walk(nodes){const stack=[...nodes].reverse();while(stack.length){const node=stack.pop(),key=tag(node);yield node;if(Array.isArray(node[key]))stack.push(...[...node[key]].reverse());}}
const all=(nodes,name)=>[...walk(nodes)].filter(node=>tag(node)===name);
const localName=name=>name.split(':').pop();
// Originals are downloadable Word files. Reject layouts where Office and the
// central-directory inspector could interpret different filenames or payloads.
function verifyZipLayout(bytes,entries){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
 for(let pos=bytes.length-22;pos>=Math.max(0,bytes.length-65557);pos--)if(view.getUint32(pos,true)===0x06054b50){end=pos;break;}
 if(end<0||end+22+view.getUint16(end+20,true)!==bytes.length||view.getUint16(end+4,true)||view.getUint16(end+6,true)||view.getUint16(end+8,true)!==entries.size)throw bad();
 const directory=view.getUint32(end+16,true);if(directory+view.getUint32(end+12,true)!==end)throw bad();
 let cursor=directory;const ranges=[];
 for(const entry of entries.values()){
  if(view.getUint16(cursor+34,true)!==0)throw bad();
  const offset=entry.localOffset;if(offset+30>directory||view.getUint32(offset,true)!==0x04034b50)throw bad();
  const flags=view.getUint16(offset+6,true),nameLength=view.getUint16(offset+26,true),start=offset+30+nameLength+view.getUint16(offset+28,true);
  const name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(offset+30,offset+30+nameLength));
  if(name!==entry.name||flags!==view.getUint16(cursor+8,true)||view.getUint16(offset+8,true)!==entry.method||start+entry.compressedSize>directory)throw bad();
  let finish=start+entry.compressedSize;
  if(flags&8){
   let descriptor=finish;if(view.getUint32(descriptor,true)===0x08074b50)descriptor+=4;
   if(descriptor+12>directory||view.getUint32(descriptor,true)!==entry.crc32||view.getUint32(descriptor+4,true)!==entry.compressedSize||view.getUint32(descriptor+8,true)!==entry.uncompressedSize)throw bad();
   finish=descriptor+12;
  }else if(view.getUint32(offset+14,true)!==entry.crc32||view.getUint32(offset+18,true)!==entry.compressedSize||view.getUint32(offset+22,true)!==entry.uncompressedSize)throw bad();
  ranges.push([offset,finish]);cursor+=46+view.getUint16(cursor+28,true)+view.getUint16(cursor+30,true)+view.getUint16(cursor+32,true);
 }
 if(cursor!==end)throw bad();
 ranges.sort((a,b)=>a[0]-b[0]);let previous=0;
 for(const [start,finish]of ranges){if(start!==previous)throw bad();previous=finish;}
 if(previous!==directory)throw bad();
}
function words(nodes){let value='';for(const node of nodes){const key=tag(node);if(key==='#text')value+=node[key];else if(['w:tab','w:br','w:cr'].includes(key))value+=' ';else if(Array.isArray(node[key]))value+=words(node[key])+(key==='w:p'?'\n':'');}return value;}
function parseXml(bytes,budget){
 const xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 if(/<!DOCTYPE|<!ENTITY|\u0000/i.test(xml)||/<\?xml[^?]*encoding\s*=\s*['"](?!utf-8['"])/i.test(xml))throw bad();
 const count=(xml.match(/</g)??[]).length;budget.xmlTokens-=count;if(count>50000||budget.xmlTokens<0)throw bad();
 const tree=parser.parse(xml,true);
 for(const node of walk(tree)){
  const name=localName(tag(node));
  if(['altChunk','oleObject','object','control','subDoc','attachedTemplate'].includes(name))throw bad();
  const instruction=name==='instrText'?words(node[tag(node)]):name==='fldSimple'?Object.entries(attrs(node)).find(([key])=>localName(key)==='instr')?.[1]:undefined;
  if(instruction!==undefined&&!/^\s*(?:PAGE|NUMPAGES)(?:\s+\\\*\s+MERGEFORMAT)?\s*$/i.test(String(instruction)))throw bad();
 }
 return tree;
}
/** Reads all entries under compressed/expanded limits; never writes or fetches.
 * Extracted author names are claims in an untrusted file, not verified identities. */
export async function inspectFeedbackDocx(input){
 try{
  const bytes=new Uint8Array(input);if(bytes.length>FEEDBACK_MAX_BYTES)throw bad();
  const limits={maxZipEntries:256,maxCompressionRatio:200},entries=readZipDirectory(bytes,limits),budget={remaining:10*1024*1024,xmlTokens:150000},xmlParts=new Map(),warnings=[];
  verifyZipLayout(bytes,entries);
  for(const [key,entry]of entries){
   if(entry.special)throw bad();if(entry.isDirectory)continue;
   const xml=key.endsWith('.xml')||key.endsWith('.rels'),image=/^(?:word\/media|docprops)\/[a-z0-9_.-]+\.(?:png|jpe?g)$/.test(key);
   if((!xml&&!image)||!/^(?:\[content_types\]\.xml|_rels\/\.rels|(?:word|docprops)\/[a-z0-9_./-]+)$/.test(key)||/vba|activex|embeddings|customui|attachedtemplate/i.test(key))throw bad();
   const expanded=await readZipEntry(bytes,entry,budget,limits,(data,max)=>inflateRawSync(data,{maxOutputLength:Math.max(1,max)}));
   if(crc32(expanded)!==entry.crc32)throw bad();
   if(!xml){warnings.push('Local images are retained in the original file but not interpreted.');continue;}
   const tree=parseXml(expanded,budget);xmlParts.set(key,tree);
   if(key.endsWith('.rels'))for(const rel of [...walk(tree)].filter(n=>localName(tag(n))==='Relationship')){
    const a=attrs(rel),target=a['@_Target']??'';
    if(a['@_TargetMode']||/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|\\)/i.test(target)||/attachedTemplate|oleObject|vbaProject|aFChunk|package$/i.test(a['@_Type']??''))throw bad();
   }
   if(key==='[content_types].xml'&&/macroenabled|vbaproject|oleobject/i.test(new TextDecoder().decode(expanded)))throw bad();
  }
  const document=xmlParts.get('word/document.xml'),root=document?.find(n=>tag(n)==='w:document');
  if(!root||attrs(root)['@_xmlns:w']!==W||!xmlParts.has('[content_types].xml')||!xmlParts.has('_rels/.rels'))throw bad();
  const comments=[],changes=[],anchors=new Map();let anchor='preamble',paragraphNo=0;
  for(const p of all(root['w:document'],'w:p')){
   paragraphNo++;const visible=words(p['w:p']),match=/^\s*\[([A-Za-z0-9_-]{1,80})\]/.exec(visible);if(match)anchor=match[1];
   for(const marker of [...all(p['w:p'],'w:commentRangeStart'),...all(p['w:p'],'w:commentReference')]){const id=String(attrs(marker)['@_w:id']);if(!anchors.has(id))anchors.set(id,anchor);}
   // Keep document order when insertions and deletions share a paragraph.
   const stack=[...p['w:p']].reverse();while(stack.length){const node=stack.pop(),key=tag(node);if(['w:ins','w:del'].includes(key)){changes.push({kind:key==='w:ins'?'insertion':'deletion',text:words(node[key]).slice(0,20000),clauseAnchor:anchor,paragraphNo,authorClaim:String(attrs(node)['@_w:author']??'').slice(0,200)});}else if(Array.isArray(node[key]))stack.push(...[...node[key]].reverse());}
  }
  const commentsPart=xmlParts.get('word/comments.xml');
  if(commentsPart){const commentRoot=commentsPart.find(n=>tag(n)==='w:comments');if(!commentRoot||attrs(commentRoot)['@_xmlns:w']!==W)throw bad();
   for(const node of all(commentRoot['w:comments'],'w:comment')){const id=String(attrs(node)['@_w:id']??'');comments.push({commentId:id,text:words(node['w:comment']).trim().slice(0,20000),clauseAnchor:anchors.get(id)??null,authorClaim:String(attrs(node)['@_w:author']??'').slice(0,200)});}
  }
  if(comments.length+changes.length>1000)throw bad();
  if(all(root['w:document'],'w:moveFrom').length||all(root['w:document'],'w:moveTo').length||all(root['w:document'],'w:pPrChange').length||all(root['w:document'],'w:rPrChange').length)warnings.push('Moves or formatting revisions require manual comparison.');
  warnings.push('Suggestions are incomplete aids. Compare the original attachment and source; confirm clause anchors and reviewer identity manually. Untracked edits are not applied or inferred.');
  return {schemaVersion:1,manualReviewRequired:true,comments,changes,warnings:[...new Set(warnings)]};
 }catch(error){if(error instanceof HttpError)throw error;throw bad();}
}
