import test from 'node:test';
import assert from 'node:assert/strict';
import {Matrix4} from 'three';
import {foldAngles,extendedFoldAngles,referenceAxes,referencePose} from '../helpers/fidget-motion.mjs';
import {buildCubeAssembly} from '../../customizer/generators/infinity-fidget/cube-assembly.js';
import {loadEngine} from '../../customizer/framework/engine.js';

test('independent default motion axes match the reference source dimensions',()=>{
  const a=referenceAxes();
  assert.deepEqual(a[0],[1,[16,10,4]]);
  assert.deepEqual(a[6],[0,[73,16,16]]);
  assert.deepEqual(a[10],[2,[46,37,10]]);
});

async function checkFold(wasm,params={},samples=20,cycle=false,complete=false) {
  const out=buildCubeAssembly({...params,removable_supports:false},{wasm});
  try {
    let foldedBounds;
    for(let step=0;step<=(complete?14:cycle?7:2)*samples;step++) {
      const a=Math.min(90,step/samples*90),b=Math.max(0,(step-samples)/samples*90);
      const pose=referencePose(cycle?extendedFoldAngles(step/samples,complete):foldAngles(a,b),params);
      const identity=new Matrix4().elements;
      assert.ok(pose.closure.elements.every((v,i)=>Math.abs(v-identity[i])<1e-7),'full loop closes at '+step);
      if(complete&&step===14*samples)for(const matrix of [...pose.bodies.values(),...pose.links.values()]) {
        assert.ok(matrix.elements.every((v,i)=>Math.abs(v-identity[i])<1e-7),'every moving part returns to its starting pose');
      }
      const placed=out.solids.map(p=>{
        const id=Number(p.name.match(/\d+/)[0])-1;
        const matrix=p.name.startsWith('Captured')?pose.links.get(id):pose.bodies.get(id);
        return p.solid.transform(matrix.elements);
      });
      try {
        for(let i=0;i<placed.length;i++)for(let j=0;j<i;j++) {
          const a=placed[i].boundingBox(),b=placed[j].boundingBox();
          if([0,1,2].some(k=>a.max[k]<b.min[k]||b.max[k]<a.min[k]))continue;
          const hit=placed[i].intersect(placed[j]);
          try{assert.ok(hit.volume()<1e-5,`step ${step}: ${out.solids[i].name} collides with ${out.solids[j].name}, ${hit.volume()} mm3`);}finally{hit.delete();}
        }
        if(step===(cycle?7:2)*samples) {
          const boxes=placed.slice(0,16).map(s=>s.boundingBox());
          foldedBounds=[0,1,2].map(k=>Math.max(...boxes.map(b=>b.max[k]))-Math.min(...boxes.map(b=>b.min[k])));
        }
      }finally{placed.forEach(s=>s.delete());}
    }
    return foldedBounds;
  }finally{out.solids.forEach(s=>s.solid.delete());}
}
test('the mechanism continues forward through two distinct cubes without collisions or opening the loop',async()=>{
  const bounds=await checkFold(await loadEngine(),{},12,true);
  for(const size of bounds)assert.ok(Math.abs(size-41)<1e-5);
  assert.notDeepEqual(extendedFoldAngles(7),foldAngles(90,90));
});
test('a complete continuous folding sequence returns the actual mechanism to its starting configuration',async()=>{
  await checkFold(await loadEngine(),{},8,true,true);
});
test('round bearing feet preserve the closed folding path at both allowed size extremes',async()=>{
  const wasm=await loadEngine();
  for(const params of [
    {shape:'spherical',size_mm:18,connector_mm:4.6,chamfer_mm:0,block_gap_mm:0.6},
    {shape:'spherical',size_mm:40,connector_mm:10,chamfer_mm:0,block_gap_mm:1.2}
  ])try{await checkFold(wasm,params,6,true,true);}catch(e){throw new Error(JSON.stringify(params)+': '+e.message,{cause:e});}
});

test('the complete eight-block loop closes and its actual meshes fold from flat into a cube',async()=>{
  const wasm=await loadEngine(),bounds=await checkFold(wasm);
  for(const size of bounds)assert.ok(Math.abs(size-41)<1e-5,'actual folded geometry is 41 mm on all axes');
});

test('shape, finish, writing and meaningful dimension extremes preserve a collision-free full fold',async()=>{
  const wasm=await loadEngine();
  for(const params of [
    {shape:'triangle',connector_mm:6,chamfer_mm:1.5,texture:'lines',block_1_symbol:'A',block_5_symbol:'B'},
    {shape:'rectangular',aspect:1.4,texture:'ridged',block_1_symbol:'A',block_5_symbol:'B'},
    {shape:'spherical',chamfer_mm:0,texture:'knurled',block_1_symbol:'A',block_5_symbol:'B'},
    {chamfer_mm:0,block_gap_mm:3.4},
    {size_mm:18,connector_mm:6.8,chamfer_mm:1.7,clearance_mm:0.2,block_gap_mm:0.9},
    {size_mm:40,connector_mm:10,chamfer_mm:2.5,clearance_mm:0.5,block_gap_mm:1.2,texture:'hexagons',texture_pitch_mm:2.4}
  ]) {try{await checkFold(wasm,params,8,true,true);}catch(e){throw new Error(JSON.stringify(params)+': '+e.message,{cause:e});}}
});
