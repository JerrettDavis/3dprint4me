import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLocalPrintRepository} from '../../lib/print-estimation/adapters/local-print-repository.js';
import {createFilamentUseCases} from '../../lib/print-estimation/application/filament.js';
import {createOperatorModels} from '../../lib/print-estimation/application/operator-models.js';
import {selectLatestEstimate,createOperatorPrintView} from '../../lib/print-estimation/application/operator-view.js';
import {createSliceJobRunner} from '../../lib/print-estimation/application/slice-jobs.js';
import {zipSync} from 'fflate';
import {createEstimateSessionUseCases} from '../../lib/print-estimation/application/estimate-session.js';
import {hashCapability} from '../../lib/print-estimation/capability.js';
const work={item:{id:'work_models_12345678',requestId:'req_models_12345678'},request:{service:'print',specifications:{material:'petg'}}};
async function fixture(t) {
 const dir=await mkdtemp(join(tmpdir(),'operator-models'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const repository=createLocalPrintRepository({path:join(dir,'print.json')});const objects=new Map();
 const fileStore={authorizeUpload:async(path)=>({uploadUrl:`https://private.test/${path}`}),inspect:async path=>objects.has(path)?{size:objects.get(path).length}:null,read:async path=>objects.get(path),delete:async path=>objects.delete(path),put:async(path,bytes)=>objects.set(path,bytes)};
 const materialCosts=createFilamentUseCases({repository});
 const service=createOperatorModels({repository,fileStore,materialCosts,slicerEnabled:true});
 return {repository,fileStore,objects,service};
}
// Closed tetrahedron, binary STL.
function model(){const b=Buffer.alloc(284);b.writeUInt32LE(4,80);const triangles=[[[0,0,0],[0,10,0],[10,0,0]],[[0,0,0],[10,0,0],[0,0,10]],[[0,0,0],[0,0,10],[0,10,0]],[[10,0,0],[0,10,0],[0,0,10]]];triangles.forEach((tri,i)=>tri.flat().forEach((v,j)=>b.writeFloatLE(v,84+i*50+12+j*4)));return b;}
async function upload(f,name='part.stl',bytes=model()) {
 const grant=await f.service.authorizeUpload(work,{filename:name,size:bytes.length,options:{material:'petg'}});
 const path=new URL(grant.uploadUrl).pathname.slice(1);f.objects.set(path,bytes);
 return grant;
}
test('private work uploads attach multiple revisions; finalize replay is idempotent',async t=>{
 const f=await fixture(t),first=await upload(f);
 await assert.rejects(()=>f.service.finish({...work,item:{...work.item,id:'work_other_12345678'}},{sessionId:first.sessionId,assetId:first.assetId}),e=>e.status===404);
 await f.service.finish(work,{sessionId:first.sessionId,assetId:first.assetId});
 await f.service.finish(work,{sessionId:first.sessionId,assetId:first.assetId});
 const second=await upload(f);await f.service.finish(work,{sessionId:second.sessionId,assetId:second.assetId});
 const detail=await f.repository.forRequest(work.item.requestId);assert.equal(detail.assets.length,2);
 assert.equal(detail.estimates.filter(row=>row.purpose==='operator').length,2);
});
test('existing model is re-estimated with current options; old slice cannot override a newer revision',async t=>{
 const f=await fixture(t),grant=await upload(f);await f.service.finish(work,grant);
 await f.service.estimate(work,{assetId:grant.assetId,options:{material:'pla',quantity:3,colors:2}});
 const detail=await f.repository.forRequest(work.item.requestId),latest=selectLatestEstimate(detail.estimates);
 assert.equal(latest.purpose,'operator');assert.equal(latest.input.options.quantity,3);assert.equal(latest.input.options.material,'pla');
 const stale={...latest,id:'pest_stale',purpose:'slice',estimatorType:'slicer',geometry:{operatorRevision:'old'}};
 assert.equal(selectLatestEstimate([stale,...detail.estimates]).id,latest.id);
});
test('failed analysis retains private source and no fabricated estimate',async t=>{
 const f=await fixture(t),grant=await upload(f,'broken.stl',Buffer.from('invalid'));
 const result=await f.service.finish(work,grant);assert.equal(result.status,'failed');
 const detail=await f.repository.forRequest(work.item.requestId);assert.equal(detail.assets[0].state,'failed');assert.equal(detail.estimates.length,0);
});
test('ZIP selections roll up slicer grams for exact part and project quantities',async t=>{
 const f=await fixture(t),grant=await upload(f,'pack.zip',zipSync({'one.stl':model(),'two.stl':model()}));
 const pack=await f.service.finish(work,grant);assert.equal(pack.status,'pack');assert.equal(pack.parts.length,2);
 await f.service.estimate(work,{assetId:grant.assetId,selections:pack.parts.map((p,i)=>({partId:p.id,quantity:i+1})),options:{quantity:3,material:'petg'}});
 const runner=createSliceJobRunner({repository:f.repository,fileStore:f.fileStore,materialCosts:createFilamentUseCases({repository:f.repository}),limits:{maxModelBytes:1000000},slicer:{estimateSlice:async()=>({elapsedSeconds:3600,materialGrams:10,engine:'test',engineVersion:'1',profileId:'test'})}});
 await runner.runOnce({batchSize:10});
 const detail=await f.repository.forRequest(work.item.requestId),latest=selectLatestEstimate(detail.estimates);
 assert.equal(latest.estimatorType,'slicer');assert.equal(latest.assetId,grant.assetId);assert.equal(latest.input.production.totalGrams,90);assert.equal(latest.input.production.totalHours,9);
});
test('replayed estimate commands cannot change options or model under the same revision',async t=>{
 const f=await fixture(t),grant=await upload(f);await f.service.finish(work,grant);
 await f.service.estimate(work,{assetId:grant.assetId,options:{quantity:2}},{revision:'revision_12345678'});
 const before=await f.repository.listAssetJobs(grant.assetId);
 await assert.rejects(()=>f.service.estimate(work,{assetId:grant.assetId,options:{quantity:9,material:'asa'}},{revision:'revision_12345678'}),e=>e.status===409);
 assert.equal((await f.repository.listAssetJobs(grant.assetId)).length,before.length);
});
test('active operator revision survives more than fifty later stale slice snapshots',async t=>{
 const f=await fixture(t),grant=await upload(f);await f.service.finish(work,grant);
 const active=await f.repository.latestOperatorEstimate(work.item.requestId);
 for(let i=0;i<55;i++)await f.repository.insertEstimate({...active,purpose:'slice',estimatorType:'slicer',geometry:{operatorRevision:'stale_revision'},input:{...active.input,options:{...active.input.options,quantity:99}}});
 const history=await f.repository.forRequest(work.item.requestId);assert.equal(history.estimates.some(row=>row.purpose==='operator'),false);
 const view=await createOperatorPrintView({repository:f.repository,fileStore:f.fileStore}).forWork(work);
 assert.equal(view.latestEstimate.id,active.id);assert.equal(view.latestEstimate.assumptions.quantity,1);
});
test('operator-prepared drafts accept private models and planning estimates without manufacturing consent',async t=>{
 const f=await fixture(t),draft={item:{...work.item,projectDraft:true},request:{...work.request,consent:false,estimate:null,specifications:{}}},bytes=model();
 const grant=await f.service.authorizeUpload(draft,{filename:'draft.stl',size:bytes.length});f.objects.set(new URL(grant.uploadUrl).pathname.slice(1),bytes);
 const finished=await f.service.finish(draft,grant);assert.equal(finished.status,'ready');
 await f.service.estimate(draft,{assetId:grant.assetId,options:{material:'petg',quantity:2}});
 assert.equal(draft.item.projectDraft,true);assert.equal(draft.request.consent,false);assert.equal(draft.request.estimate,null);
});
test('a completed customer submission supersedes an earlier draft planning revision',()=>{
 const base={assetId:'asset_one',input:{options:{material:'pla',quality:'standard',colors:1,supports:'none'}},geometry:{operatorRevision:'draft_revision'}};
 const submission={...base,id:'new_customer',purpose:'submission',geometry:{}};
 const draft={...base,id:'old_draft',purpose:'operator'};
 assert.equal(selectLatestEstimate([submission,draft]).id,submission.id);
});
test('customer model session can attach after operator planning sessions and become authoritative',async t=>{
 const f=await fixture(t),draft={...work,item:{...work.item,projectDraft:true}},grant=await upload(f);await f.service.finish(draft,grant);
 const customer=createEstimateSessionUseCases({repository:f.repository,fileStore:f.fileStore,materialCosts:createFilamentUseCases({repository:f.repository})});
 const session=await customer.create({options:{quantity:4}}),bytes=model(),uploadGrant=await customer.authorizeUpload({...session,filename:'customer.stl',size:bytes.length});
 f.objects.set(new URL(uploadGrant.uploadUrl).pathname.slice(1),bytes);await customer.analyze({...session,assetId:uploadGrant.assetId},{purpose:'submission'});
 assert.equal((await f.repository.attachSession({sessionId:session.sessionId,ownershipHash:hashCapability(session.token),requestId:work.item.requestId})).attached,true);
 const latest=await f.repository.latestAuthoritativeEstimate(work.item.requestId);assert.equal(latest.purpose,'submission');assert.equal(latest.input.options.quantity,4);
});
test('draft planning estimates cannot be recorded as actual production through the application API',async t=>{
 const f=await fixture(t),grant=await upload(f),draft={...work,item:{...work.item,projectDraft:true}};await f.service.finish(draft,grant);
 await assert.rejects(()=>createOperatorPrintView({repository:f.repository,fileStore:f.fileStore}).recordRun({work:draft,run:{actualGrams:5},operator:{id:'op_owner'}}),e=>e.status===409);
});
