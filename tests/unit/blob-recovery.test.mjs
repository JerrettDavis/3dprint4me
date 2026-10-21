import test from 'node:test';
import assert from 'node:assert/strict';
import { exportObjects, validateObjects, restoreObjects, exportObjectStream } from '../../lib/platform/blob-recovery.js';

const bytes=Buffer.from('private model');
const stream=()=>new ReadableStream({start(c){c.enqueue(bytes);c.close();}});
function provider() {
  const calls=[];
  return {calls, list:async options=>{calls.push(['list',options]);return {blobs:[{pathname:'3DP-test/model.stl',size:bytes.length}],hasMore:false};},
    get:async(path,options)=>{calls.push(['get',path,options]);return {statusCode:200,stream:stream(),blob:{size:bytes.length,contentType:'application/octet-stream'}};},
    put:async(...args)=>{calls.push(['put',...args]);}};
}
test('private object export hashes all bytes and restores original paths without overwrite',async()=>{
  const sdk=provider(),archive=await exportObjects(sdk);
  assert.equal(validateObjects(archive).length,1);
  sdk.get=async()=>null;
  await restoreObjects(archive,sdk);
  const put=sdk.calls.find(c=>c[0]==='put');
  assert.equal(put[1],'3DP-test/model.stl');
  assert.deepEqual(put[2],bytes);
  assert.deepEqual(put[3],{access:'private',addRandomSuffix:false,allowOverwrite:false,contentType:'application/octet-stream'});
  assert.deepEqual(sdk.calls.find(c=>c[0]==='get')[2],{access:'private',useCache:false});
});
test('streaming export verifies required database paths and restore resumes identical files',async()=>{
  const sdk=provider(),records=[];
  for await(const record of exportObjectStream(sdk,['3DP-test/model.stl']))records.push(record);
  assert.equal(records.at(-1).objects,1);
  await assert.rejects(async()=>{for await(const record of exportObjectStream(sdk,['missing']))void record;});
  const archive=await exportObjects(sdk);
  await restoreObjects(archive,sdk);
  assert.equal(sdk.calls.filter(c=>c[0]==='put').length,0);
  sdk.get=async()=>({statusCode:200,stream:stream(),blob:{size:1,contentType:'application/octet-stream'}});
  await assert.rejects(restoreObjects(archive,sdk));
});
test('streamed store size can exceed the per-object memory bound',async()=>{
  const sdk=provider();sdk.list=async()=>({hasMore:false,blobs:[1,2,3].map(n=>({pathname:'model-'+n,size:bytes.length}))});
  let count=0;
  for await(const record of exportObjectStream(sdk,[],{maxObjectBytes:bytes.length}))if(record.type==='object')count++;
  assert.equal(count,3);
});
test('tampering, duplicate paths and unsafe paths fail before any restore writes',async()=>{
  const archive=await exportObjects(provider());
  for(const altered of [
    {...archive,objects:[{...archive.objects[0],sha256:'0'.repeat(64)}]},
    {...archive,objects:[...archive.objects,...archive.objects]},
    {...archive,objects:[{...archive.objects[0],pathname:'https://evil.test/file'}]},
    {...archive,objects:[{...archive.objects[0],pathname:'../escape'}]},
  ]) {const sdk=provider();await assert.rejects(restoreObjects(altered,sdk));assert.equal(sdk.calls.length,0);}
});
test('pagination is complete and repeated cursors, disappearing objects and bounds fail closed',async()=>{
  const sdk=provider();let n=0;
  sdk.list=async()=>++n===1?{blobs:[],hasMore:true,cursor:'next'}:{blobs:[{pathname:'x',size:bytes.length}],hasMore:false};
  assert.equal((await exportObjects(sdk)).objects.length,1);
  sdk.list=async()=>({blobs:[],hasMore:true,cursor:'same'});
  await assert.rejects(exportObjects(sdk));
  const missing=provider();missing.get=async()=>null;
  await assert.rejects(exportObjects(missing));
  await assert.rejects(exportObjects(provider(),{maxBytes:2}));
});
