import test from 'node:test';
import assert from 'node:assert/strict';
import {cubeMechanics,cubeTopology} from '../../public/assets/js/customize/fidget-topology.js';
import {buildCubeAssembly} from '../../customizer/generators/infinity-fidget/cube-assembly.js';
import {loadEngine} from '../../customizer/framework/engine.js';
import definition from '../../public/assets/js/customize/generators/infinity-fidget.js';
import {validateParams,clampParams} from '../../public/assets/js/customize/schema.js';

const params={shape:'triangle',connector_mm:6,chamfer_mm:1.5};
test('triangle source bearing centers follow its narrower, offset eight-link mechanism',()=>{
  const g=cubeMechanics(params),t=cubeTopology(g);
  assert.equal(g.width,8);
  assert.equal(t.joints[0].origin[1]+g.width/2,14);
  assert.equal(t.joints[2].origin[1]+g.width/2,27);
  assert.equal(t.joints[6].origin[0]+g.width/2,6);
  assert.equal(t.joints[7].origin[0]+g.width/2,77);
  assert.equal(t.joints[4].origin[2]-g.width/2,6);
  assert.equal(t.joints[5].origin[2]+g.width/2,6);
});
test('triangle edits preserve valid narrower bearing sockets',()=>{
  assert.ok(validateParams(definition,params).ok);
  const defaults=validateParams(definition,{}).value;
  assert.ok(validateParams(definition,clampParams(definition,{...defaults,shape:'triangle'},'shape')).ok);
});
test('triangle bodies have alternating diagonal corner cuts and retain connected bearing pins',async()=>{
  const wasm=await loadEngine(),out=buildCubeAssembly(params,{wasm});
  try {
    assert.equal(out.solids.length,16);
    for(const part of out.solids.slice(0,8)) {
      assert.ok(part.solid.volume()<6500);
      const pieces=part.solid.decompose();
      try{assert.equal(pieces.length,1,part.name);}finally{pieces.forEach(p=>p.delete());}
    }
  }finally{out.solids.forEach(p=>p.solid.delete());}
});
