import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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

async function collect(sdk,priorRecords,options={}) { const records=[]; for await(const r of exportObjectStream(sdk,[],{priorRecords,...options}))records.push(r);return records; }
function taggedProvider(tag='v1') {const sdk=provider();const list=sdk.list,get=sdk.get;sdk.list=async o=>{const p=await list(o);p.blobs[0].etag=tag;return p;};sdk.get=async(...a)=>{const r=await get(...a);r.blob.etag=tag;return r;};return sdk;}
test('incremental complete checkpoint reuses validated ETags without GET',async()=>{
 const first=await collect(taggedProvider());const sdk=taggedProvider();const second=await collect(sdk,first);
 assert.equal(sdk.calls.filter(c=>c[0]==='get').length,0);assert.equal(second.at(-1).reusedBytes,bytes.length);
 assert.deepEqual(validateObjects({version:1,objects:second.filter(r=>r.type==='object')})[0].bytes,bytes);
});
test('changed and legacy objects download; deleted objects disappear',async()=>{
 const first=await collect(taggedProvider());assert.equal((await collect(taggedProvider('v2'),first)).at(-1).downloadedObjects,1);
 delete first[1].etag;assert.equal((await collect(taggedProvider(),first)).at(-1).downloadedObjects,1);
 const sdk=taggedProvider();sdk.list=async()=>({blobs:[],hasMore:false});assert.equal((await collect(sdk,first)).at(-1).objects,0);
});
test('prior corruption, duplicate records, missing footer, bounds and identity races fail closed',async()=>{
 const first=await collect(taggedProvider());
 for(const prior of [[...first.slice(0,-1)], [first[0],first[1],first[1],first[2]], [first[0],{...first[1],sha256:'0'.repeat(64)},first[2]], [first[0],first[1],{...first[2],objects:2}], [...first,first[1]]])await assert.rejects(collect(taggedProvider(),prior));
 await assert.rejects(collect(taggedProvider(),first,{maxObjectBytes:2}));
 const sdk=taggedProvider();const get=sdk.get;sdk.get=async(...a)=>{const r=await get(...a);r.blob.etag='race';return r;};await assert.rejects(collect(sdk));
});

test('incremental listing rejects duplicates, repeated cursors, unsafe names and missing references',async()=>{
 const sdk=taggedProvider();
 sdk.list=async()=>({blobs:[{pathname:'../secret',size:1}],hasMore:false});await assert.rejects(collect(sdk));
 sdk.list=async()=>({blobs:[{pathname:'x',size:1},{pathname:'x',size:1}],hasMore:false});await assert.rejects(collect(sdk));
 sdk.list=async()=>({blobs:[],hasMore:true,cursor:'loop'});await assert.rejects(collect(sdk));
 sdk.list=async()=>({blobs:[],hasMore:false});await assert.rejects(async()=>{for await(const r of exportObjectStream(sdk,['missing']))void r;});
});

test('incremental CLI streams complete prior checkpoint and redacts malformed input',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'blob-recovery-test-'));
 try {
  const loader=join(dir,'loader.mjs');
  // Only replace the provider: exercise the production CLI parser and exporter.
  const mock=`export async function list(){return {blobs:[{pathname:'3DP-test/model.stl',size:${bytes.length},etag:'v1'}],hasMore:false}}; export async function get(){throw Error('Unexpected GET: PRIVATE_PROVIDER_DETAIL')}`;
  writeFileSync(loader,`export async function resolve(specifier,context,next){if(specifier==='@vercel/blob')return {url:${JSON.stringify('data:text/javascript,'+encodeURIComponent(mock))},shortCircuit:true};return next(specifier,context);}`);
  const prior=await collect(taggedProvider());
  const args=['--no-warnings','--loader',pathToFileURL(loader).href,'scripts/blob-recovery.mjs','export-incremental'];
  const options={encoding:'utf8',env:{...process.env,BLOB_READ_WRITE_TOKEN:'test-only'}};
  const input=[{type:'requirements',paths:['3DP-test/model.stl']},...prior].map(r=>JSON.stringify(r)).join('\n')+'\n';
  const result=spawnSync(process.execPath,args,{...options,input});
  assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout.trim().split('\n').at(-1)).reusedObjects,1);
  const bad=spawnSync(process.execPath,args,{...options,input:input+'PRIVATE_CUSTOMER_BYTES\n'});
  assert.notEqual(bad.status,0);assert.equal(bad.stderr,'Private object recovery failed; diagnostics suppressed.\n');
  assert.doesNotMatch(bad.stderr,/PRIVATE_CUSTOMER_BYTES|PRIVATE_PROVIDER_DETAIL/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
