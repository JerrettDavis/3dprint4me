import test from 'node:test';
import assert from 'node:assert/strict';
import { cubeMechanics, cubeTopology } from '../../public/assets/js/customize/fidget-topology.js';
import { buildCubeAssembly } from '../../customizer/generators/infinity-fidget/cube-assembly.js';
import { loadEngine } from '../../customizer/framework/engine.js';
import { buildModel } from '../../customizer/framework/model.js';
import { analyzeModelBytes } from '../../public/assets/js/print-estimation/geometry.js';
import { inflateRawSync } from 'node:zlib';
import { buildConicalJoint } from '../../customizer/generators/infinity-fidget/conical-hinge.js';
import {chamferedBlock} from '../../customizer/generators/infinity-fidget/shapes.js';
import definition from '../../public/assets/js/customize/generators/infinity-fidget.js';
import {validateParams} from '../../public/assets/js/customize/schema.js';
import {partsToStl} from '../../customizer/framework/stl.js';
import {unzipSync,strFromU8} from 'fflate';

test('full cube mechanical policy rejects unsafe inputs and yields a closed eight-block cycle', () => {
  for (const [key, values] of Object.entries({size_mm:[0, 17, 1000, NaN, '20'],connector_mm:[0, 20, Infinity],clearance_mm:[0, 1],chamfer_mm:[-1, 5],aspect:[0, 3]})) {
    for (const value of values) assert.throws(() => cubeMechanics({[key]:value}), RangeError, `${key}=${value}`);
  }
  assert.throws(() => cubeMechanics({size_mm:18, connector_mm:10}), RangeError);
  const g = cubeMechanics({});
  const { blocks, joints } = cubeTopology(g);
  assert.equal(blocks.length, 8);
  assert.equal(joints.length, 8);
  const degree = Array(8).fill(0);
  for (const j of joints) { assert.notEqual(j.blocks[0],j.blocks[1]); j.blocks.forEach(i=>degree[i]++); }
  assert.deepEqual(degree, Array(8).fill(2));
  const visited = new Set([0]);
  for (let pass=0;pass<8;pass++) for(const j of joints) if(j.blocks.some(i=>visited.has(i))) j.blocks.forEach(i=>visited.add(i));
  assert.equal(visited.size,8,'single closed loop, not several disconnected cycles');
});

test('a 2 mm edge chamfer actually removes the specified corners from a 20 mm block',async()=>{
  const wasm=await loadEngine(),temps=[];
  const t=s=>{temps.push(s);return s;};
  try {
    const block=chamferedBlock(wasm,[20,20,20],2,t);
    assert.ok(block.volume()<7600,'chamfer removes actual material');
    const mesh=block.getMesh();
    try {
      for(let i=0;i<mesh.numVert;i++) {
        const x=mesh.vertProperties[i*mesh.numProp],y=mesh.vertProperties[i*mesh.numProp+1];
        assert.ok(x+y<=38+1e-5,'corner is set back 2 mm along the cube edge');
      }
    }finally{mesh.delete?.();}
  }finally{temps.reverse().forEach(s=>s.delete());}
});
test('all four body families retain connected pins at both dimension extremes',async()=>{
  const {clampParams}=await import('../../public/assets/js/customize/schema.js');
  const wasm=await loadEngine(),defaults=validateParams(definition,{}).value;
  for(const shape of ['cube','triangle','spherical','rectangular'])for(const size_mm of [18,40]) {
    const p=clampParams(definition,{...defaults,shape,size_mm,connector_mm:size_mm===40?10:shape==='spherical'?4.6:4,chamfer_mm:size_mm===40?2.5:1,aspect:1.5},'size_mm');
    const out=buildCubeAssembly(p,{wasm});
    try{for(const part of out.solids){
      const pieces=part.solid.decompose();
      try{assert.equal(pieces.length,1,`${shape} ${size_mm}: ${part.name}`);}finally{pieces.forEach(s=>s.delete());}
    }}finally{out.solids.forEach(s=>s.solid.delete());}
  }
});

test('full cube uses eight connected bodies and eight separate captured conical links', async () => {
  const wasm = await loadEngine();
  const out = buildCubeAssembly({}, {wasm});
  const scratch=[];
  const t=s=>{scratch.push(s);return s;};
  try {
    assert.equal(out.solids.length,16);
    for(const p of out.solids) {
      assert.equal(p.solid.status(),'NoError',p.name);
      assert.ok(p.solid.volume()>0,p.name);
      const pieces=p.solid.decompose();
      try {assert.equal(pieces.length,1,p.name+' has no loose pins');} finally{pieces.forEach(s=>s.delete());}
    }
    for(let i=0;i<out.solids.length;i++) for(let j=i+1;j<out.solids.length;j++) {
      const hit=t(out.solids[i].solid.intersect(out.solids[j].solid));
      assert.ok(hit.volume()<1e-6,`${out.solids[i].name} intersects ${out.solids[j].name}: ${hit.volume()}`);
    }
    const bounds=out.solids.map(p=>p.solid.boundingBox());
    const min=[0,1,2].map(a=>Math.min(...bounds.map(b=>b.min[a])));
    const max=[0,1,2].map(a=>Math.max(...bounds.map(b=>b.max[a])));
    for(const [i,wanted] of [83,41,20].entries()) assert.ok(Math.abs(max[i]-min[i]-wanted)<1e-5,`dimension ${i}`);
    assert.ok(Math.abs(min[2])<1e-6,'bed aligned');
  } finally{scratch.reverse().forEach(s=>s.delete());out.solids.forEach(p=>p.solid.delete());}
});

test('full cube 3MF is accepted by the intake analyzer without mesh repair warnings',async()=>{
  const wasm=await loadEngine();
  const model=await buildModel({id:'infinity-fidget',version:1,build:buildCubeAssembly},{},{wasm});
  const inflateRaw=async(b,max)=>new Uint8Array(inflateRawSync(b,{maxOutputLength:max}));
  const a=await analyzeModelBytes({name:model.filename,bytes:model.data,inflateRaw});
  assert.ok(a.volumeMm3>0);
  assert.deepEqual(a.warnings.filter(w=>w!=='embedded_settings_ignored'),[]);
});

test('every configured starting design survives both actual download formats',async()=>{
  const wasm=await loadEngine();
  const inflateRaw=async(b,max)=>new Uint8Array(inflateRawSync(b,{maxOutputLength:max}));
  for(const design of definition.designs) {
    const checked=validateParams(definition,design.params);
    assert.ok(checked.ok,design.id);
    const out=await buildModel({...definition,build:buildCubeAssembly},checked.value,{wasm});
    const metadata=JSON.parse(strFromU8(unzipSync(out.data)['Metadata/customizer.json']));
    assert.match(metadata.source_notice,/Permission is hereby granted/);
    assert.match(metadata.source_notice,/Copyright \(c\) 2020 Jan Pieper/);
    assert.ok(out.metrics.unique_colors<=5);
    const a=await analyzeModelBytes({name:out.filename,bytes:out.data,inflateRaw});
    const b=await analyzeModelBytes({name:design.id+'.stl',bytes:partsToStl(out.parts),inflateRaw});
    assert.deepEqual(a.warnings.filter(w=>w!=='embedded_settings_ignored'),[],design.id+' 3MF');
    assert.deepEqual(b.warnings,['units_assumed'],design.id+' STL');
    assert.ok(Math.abs(a.volumeMm3-b.volumeMm3)/a.volumeMm3<1e-5,design.id+' volume');
  }
});

test('built-in breakaway supports add real material and stay attached to their owning parts',async()=>{
  const wasm=await loadEngine(),volumes=[],perPart=[];
  for(const removable_supports of [false,true]) {
    const out=buildCubeAssembly({removable_supports},{wasm});
    try {
      volumes.push(out.solids.reduce((v,p)=>v+p.solid.volume(),0));
      perPart.push(out.solids.map(p=>p.solid.volume()));
      assert.equal(out.solids.length,16);
      for(const p of out.solids) {
        const pieces=p.solid.decompose();
        try{assert.equal(pieces.length,1,p.name+' support is not a floating island');}finally{pieces.forEach(s=>s.delete());}
      }
    }finally{out.solids.forEach(s=>s.solid.delete());}
  }
  assert.ok(volumes[1]>volumes[0]+0.5,'support toggle changes downloaded material');
  for(const i of [0,3,4,7,12,13])assert.ok(perPart[1][i]-perPart[0][i]>0.05,`real support on part ${i}`);
});

test('rectangular and spherical families change the actual bodies and keep all conical pins attached',async()=>{
  const wasm=await loadEngine();
  const volumes={};
  for(const [shape,aspect] of [['cube',1],['rectangular',1.4],['spherical',1]]) {
    const out=buildCubeAssembly({shape,aspect},{wasm});
    try {
      volumes[shape]=out.solids.slice(0,8).reduce((sum,p)=>sum+p.solid.volume(),0);
      for(const p of out.solids.slice(0,8)) {
        assert.equal(p.solid.status(),'NoError');
        const pieces=p.solid.decompose();
        try{assert.equal(pieces.length,1,shape+' '+p.name);}finally{pieces.forEach(s=>s.delete());}
      }
    }finally{out.solids.forEach(p=>p.solid.delete());}
  }
  assert.ok(volumes.rectangular>volumes.cube*1.25);
  assert.ok(volumes.spherical<volumes.cube*0.85);
});

test('every surface treatment is real removed material while the bodies and pins stay connected',async()=>{
  const wasm=await loadEngine(), volumes={};
  for(const texture of ['smooth','lines','ridged','knurled','hexagons']) {
    const out=buildCubeAssembly({texture},{wasm});
    try {
      volumes[texture]=out.solids.slice(0,8).reduce((sum,p)=>sum+p.solid.volume(),0);
      for(const p of out.solids.slice(0,8)) {
        assert.equal(p.solid.status(),'NoError',texture);
        const pieces=p.solid.decompose();
        try{assert.equal(pieces.length,1,texture+' '+p.name);}finally{pieces.forEach(s=>s.delete());}
      }
    }finally{out.solids.forEach(p=>p.solid.delete());}
  }
  for(const texture of ['lines','ridged','knurled','hexagons']) assert.ok(volumes[texture]<volumes.smooth-5,texture+' changes mesh');
  assert.equal(new Set(Object.values(volumes).map(v=>v.toFixed(3))).size,5,'distinct patterns');
});

test('per-block text, pixel art, local image outlines and colors are printable geometry',async()=>{
  const wasm=await loadEngine();
  const imageContours=[[[0,0],[8,0],[8,2],[2,2],[2,8],[0,8]]];
  for(const shape of ['cube','spherical']) for(const artwork of ['none','pixel-face','image']) {
    const p={shape,texture:'knurled',block_1_symbol:artwork==='none'?'A':'',block_2_symbol:'B',artwork,artwork_block:'1',block_1_color:'#ff8800',block_2_color:'#228844'};
    const out=buildCubeAssembly(p,{wasm,imageContours});
    try {
      assert.equal(out.solids.find(s=>s.name==='Block 1').color,'#ff8800');
      assert.equal(out.solids.find(s=>s.name==='Block 2').color,'#228844');
      const marks=out.solids.filter(s=>s.name.startsWith('Mark '));
      assert.equal(marks.length,2,`${shape} ${artwork}`);
      for(const mark of marks) {
        assert.equal(mark.solid.status(),'NoError');
        assert.ok(mark.solid.volume()>0);
        for(const other of out.solids.filter(p=>!p.name.startsWith('Mark '))) {
          const hit=mark.solid.intersect(other.solid);
          try{assert.ok(hit.volume()<1e-6,mark.name+' overlaps '+other.name);}finally{hit.delete();}
        }
        // It must touch the parent body, rather than hover above a curved face.
        const id=Number(mark.name.match(/\d+/)[0]);
        const down=mark.solid.translate([0,0,-0.05]),hit=down.intersect(out.solids[id-1].solid);
        try{assert.ok(hit.volume()>0,'mark reaches its own body');}finally{hit.delete();down.delete();}
      }
    }finally{out.solids.forEach(s=>s.solid.delete());}
  }
});

test('every conical link clears its real endpoint body through an outward quarter-turn',async()=>{
  const wasm=await loadEngine(), g=cubeMechanics({}), topology=cubeTopology(g);
  const out=buildCubeAssembly({}, {wasm}), joint=buildConicalJoint(wasm,g);
  try {
    for(const j of topology.joints) for(const end of [0,1]) {
      const axis=[end*g.pivotSpacing,g.width/2,g.radius];
      const centered=joint.link.translate(axis.map(v=>-v));
      try {
        for(let angle=0;angle<=90;angle+=5) {
          const a=centered.rotate([0,(end?-1:1)*angle,0]),b=a.translate(axis),c=b.rotate(j.rotation),d=c.translate(j.origin);
          const hit=d.intersect(out.solids[j.blocks[end]].solid);
          try {assert.ok(hit.volume()<1e-6,`joint ${j.id} endpoint ${end} at ${angle}: ${hit.volume()}`);}
          finally{[hit,d,c,b,a].forEach(s=>s.delete());}
        }
      }finally{centered.delete();}
    }
  }finally{joint.dispose();out.solids.forEach(p=>p.solid.delete());}
});
