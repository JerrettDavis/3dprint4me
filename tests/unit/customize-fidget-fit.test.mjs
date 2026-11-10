import test from 'node:test';
import assert from 'node:assert/strict';
import {loadEngine} from '../../customizer/framework/engine.js';
import {buildConicalFitSample} from '../../customizer/generators/infinity-fidget/fit-sample.js';
import {foldAngles,referencePose} from '../helpers/fidget-motion.mjs';
test('spherical fit bearings preserve production pivot clearance throughout rotation',async()=>{
const wasm=await loadEngine();
const params={shape:'spherical',size_mm:40,connector_mm:10,chamfer_mm:0,block_gap_mm:1.2};
const out=buildConicalFitSample(params,{wasm});
try {
for(let angle=0;angle<=90;angle+=5) {
const pose=referencePose(foldAngles(angle,0),params);
const moving=out.solids[1].solid.transform(pose.bodies.get(1).elements);
const hit=out.solids[0].solid.intersect(moving);
try{assert.ok(hit.volume()<1e-7,`bearing collision at ${angle} degrees: ${hit.volume()} mm3`);}
finally{hit.delete();moving.delete();}
}
}finally{out.solids.forEach(p=>p.solid.delete());}
});

test('production fit sample has two connected bearing bodies and a separate captured link at each clearance',async()=>{
  const wasm=await loadEngine();
  for(const clearance_mm of [0.2,0.4,0.5]) {
    const out=buildConicalFitSample({clearance_mm},{wasm});
    try {
      assert.equal(out.solids.length,3);
      for(const p of out.solids) {
        assert.ok(p.solid.volume()>0);
        const pieces=p.solid.decompose();
        try{assert.equal(pieces.length,1,p.name);}finally{pieces.forEach(s=>s.delete());}
      }
      for(let i=0;i<3;i++)for(let j=0;j<i;j++) {
        const hit=out.solids[i].solid.intersect(out.solids[j].solid);
        try{assert.ok(hit.volume()<1e-7);}finally{hit.delete();}
      }
      assert.equal(out.slicerSettings.layer_height,'0.2');
      assert.match(out.warnings.join(' '),new RegExp(String(clearance_mm)));
    }finally{out.solids.forEach(p=>p.solid.delete());}
  }
});
