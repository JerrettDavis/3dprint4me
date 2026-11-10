import test from 'node:test';
import assert from 'node:assert/strict';
import {loadEngine} from '../../customizer/framework/engine.js';
import {buildCubeAssembly} from '../../customizer/generators/infinity-fidget/cube-assembly.js';
import definition from '../../public/assets/js/customize/generators/infinity-fidget.js';
import {validateParams} from '../../public/assets/js/customize/schema.js';

test('fidget exports preserve 0.2 mm layers and a wall generator that can print its narrow breakaway features',async()=>{
  const wasm=await loadEngine(),out=buildCubeAssembly({},{wasm});
  try {
    assert.equal(out.slicerSettings?.layer_height,'0.2');
    assert.equal(out.slicerSettings?.initial_layer_print_height,'0.2');
    assert.equal(out.slicerSettings?.wall_generator,'arachne');
    assert.equal(out.slicerSettings?.enable_support,'0');
  }finally{out.solids.forEach(p=>p.solid.delete());}
});

async function checkLayerStarts(wasm,params) {
  const out=buildCubeAssembly(params,{wasm});
  let union,previous;
  try {
    union=wasm.Manifold.union(out.solids.map(p=>p.solid));
    const max=Math.max(...out.solids.map(p=>p.solid.boundingBox().max[2]));
    for(let layer=0;layer<Math.ceil(max/0.2);layer++) {
      const section=union.slice(layer*0.2+0.1);
      const pieces=section.decompose();
      try {
        if(previous)for(const piece of pieces) {
          const hit=piece.intersect(previous);
          try{assert.ok(hit.area()>1e-7,`floating region starts at layer ${layer+1} / ${(layer*0.2+0.1).toFixed(1)} mm`);}finally{hit.delete();}
        }
      }finally{pieces.forEach(p=>p.delete());previous?.delete();previous=section;}
    }
  }finally{previous?.delete();union?.delete();out.solids.forEach(p=>p.solid.delete());}
}

test('0.2 mm layers have no new floating component with the built-in supports enabled',async()=>{
  await checkLayerStarts(await loadEngine(),{});
});
test('large round bearing lands start on the bed rather than leaving detached upper pins',async()=>{
  await checkLayerStarts(await loadEngine(),{shape:'spherical',size_mm:40,connector_mm:10,chamfer_mm:0,block_gap_mm:1.2});
});

test('every configured starting design has supported layer starts, including the round bodies and writing',async()=>{
  const wasm=await loadEngine();
  for(const design of definition.designs) {
    const checked=validateParams(definition,design.params);
    assert.ok(checked.ok,design.id);
    try{await checkLayerStarts(wasm,checked.value);}catch(e){throw new Error(design.id+': '+e.message,{cause:e});}
  }
});
