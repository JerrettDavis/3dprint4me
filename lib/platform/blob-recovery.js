import { createHash } from 'node:crypto';

// Bounded in-memory recovery format. Never log this record: it contains customer files.
const MAX_BYTES=64*1024*1024, MAX_OBJECTS=10000;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function pathname(value) {
  if(typeof value!=='string'||!value||value.length>1024||value.startsWith('/')||/[\\\x00-\x1f:]/.test(value)||value.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Invalid recovery path');
  return value;
}
export function validateObjects(archive,{maxBytes=MAX_BYTES}={}) {
  if(archive?.version!==1||!Array.isArray(archive.objects)||archive.objects.length>MAX_OBJECTS)throw Error('Invalid object archive');
  let total=0;const seen=new Set();
  return archive.objects.map(object=>{
    const path=pathname(object.pathname);
    if(seen.has(path)||typeof object.base64!=='string'||typeof object.contentType!=='string'||object.contentType.length>256||/[\r\n]/.test(object.contentType))throw Error('Invalid object record');
    seen.add(path);
    // Canonical base64 rejects permissive Buffer decoding of malformed records.
    if(object.base64.length>Math.ceil(maxBytes/3)*4)throw Error('Object bound');
    const bytes=Buffer.from(object.base64,'base64');total+=bytes.length;
    if(bytes.toString('base64')!==object.base64||total>maxBytes||object.size!==bytes.length||object.sha256!==digest(bytes))throw Error('Object integrity failure');
    return {pathname:path,bytes,contentType:object.contentType};
  });
}
export async function exportObjects(sdk,{maxBytes=MAX_BYTES}={}) {
  const objects=[],seen=new Set(),cursors=new Set();let cursor,total=0;
  do {
    const page=await sdk.list({limit:1000,...(cursor?{cursor}:{})});
    for(const item of page.blobs) {
      const path=pathname(item.pathname);
      if(seen.has(path)||objects.length>=MAX_OBJECTS||!Number.isSafeInteger(item.size)||item.size<0||item.size>maxBytes-total)throw Error('Object export bound');
      seen.add(path);
      const result=await sdk.get(path,{access:'private',useCache:false});
      if(result?.statusCode!==200||!result.stream||result.blob.size!==item.size)throw Error('Object changed during backup');
      const reader=result.stream.getReader(),chunks=[];let size=0;
      try {
        for(;;) {const {done,value}=await reader.read();if(done)break;size+=value.length;
          if(size>item.size||size>maxBytes-total)throw Error('Object export bound');chunks.push(value);}
      }catch(error){await reader.cancel().catch(()=>{});throw error;}
      if(size!==item.size)throw Error('Object length mismatch');
      const bytes=Buffer.concat(chunks);total+=size;
      objects.push({pathname:path,size,contentType:result.blob.contentType,sha256:digest(bytes),base64:bytes.toString('base64')});
    }
    if(!page.hasMore)break;
    if(!page.cursor||cursors.has(page.cursor))throw Error('Invalid object pagination');
    cursor=page.cursor;cursors.add(cursor);
  }while(true);
  const archive={version:1,objects};validateObjects(archive,{maxBytes});return archive;
}
export async function restoreObjects(archive,sdk) {
  const objects=validateObjects(archive); // Validate every record before any remote write.
  for(const object of objects) {
    let existing;
    try{existing=await sdk.get(object.pathname,{access:'private',useCache:false});}
    catch(error){if(error?.name!=='BlobNotFoundError')throw error;}
    if(existing) {
      if(existing.statusCode!==200||existing.blob.size!==object.bytes.length||existing.blob.contentType!==object.contentType)throw Error('Existing object conflict');
      const chunks=[];let size=0;const reader=existing.stream.getReader();
      try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>object.bytes.length)throw Error('Existing object conflict');chunks.push(value);}}
      catch(error){await reader.cancel().catch(()=>{});throw error;}
      if(digest(Buffer.concat(chunks))!==digest(object.bytes))throw Error('Existing object conflict');
      continue;
    }
    await sdk.put(object.pathname,object.bytes,{access:'private',addRandomSuffix:false,allowOverwrite:false,contentType:object.contentType});
  }
  return {objects:objects.length,bytes:objects.reduce((n,o)=>n+o.bytes.length,0)};
}

// One bounded object at a time; total store size is not held in memory or capped
// by the database recovery archive. Restic encrypts this stream directly.
export async function* exportObjectStream(sdk,requiredPaths=[],{maxObjectBytes=MAX_BYTES}={}) {
  if(!Array.isArray(requiredPaths)||requiredPaths.some(p=>pathname(p)!==p))throw Error('Invalid required paths');
  const required=new Set(requiredPaths),seen=new Set(),cursors=new Set();let cursor;
  yield {type:'header',version:1};
  do {
    const page=await sdk.list({limit:1000,...(cursor?{cursor}:{})});
    for(const item of page.blobs) {
      if(seen.has(item.pathname)||seen.size>=1000000)throw Error('Invalid object listing');
      const archive=await exportObjects({...sdk,list:async()=>({blobs:[item],hasMore:false})},{maxBytes:maxObjectBytes});
      seen.add(item.pathname);required.delete(item.pathname);
      yield {type:'object',...archive.objects[0]};
    }
    if(!page.hasMore)break;
    if(!page.cursor||cursors.has(page.cursor))throw Error('Invalid object pagination');
    cursor=page.cursor;cursors.add(cursor);
  }while(true);
  if(required.size)throw Error('Database references missing private files');
  yield {type:'footer',version:1,objects:seen.size};
}
