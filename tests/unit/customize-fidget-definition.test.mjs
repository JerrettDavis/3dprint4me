import test from 'node:test';
import assert from 'node:assert/strict';
import g from '../../public/assets/js/customize/generators/infinity-fidget.js';
import {validateParams,clampParams} from '../../public/assets/js/customize/schema.js';
import {cubeMechanics} from '../../public/assets/js/customize/fidget-topology.js';

test('fidget defaults and all starting designs obey the mechanical constraints',()=>{
  for(const params of [{},...g.designs.map(d=>d.params)]) {
    const out=validateParams(g,params);
    assert.ok(out.ok,out.errors.join('; '));
    assert.doesNotThrow(()=>cubeMechanics(out.value));
  }
});

test('fidget validates colors as a shared five-material palette without silently recoloring blocks',()=>{
  const colors=['#110000','#220000','#330000','#440000','#550000','#660000','#770000','#880000'];
  const input=Object.fromEntries(colors.map((color,i)=>[`block_${i+1}_color`,color]));
  const out=validateParams(g,input);
  assert.equal(out.ok,false);
  assert.match(out.errors.join(' '),/five|5/);
  assert.ok(out.fieldErrors.block_1_color);
  const allowed=validateParams(g,{block_2_color:'#d6a052',block_3_color:'#f6f5f1'});
  assert.ok(allowed.ok,allowed.errors.join(';'));
  assert.equal(allowed.value.block_2_color,'#d6a052');
});

test('writing and image controls cannot silently overwrite each other',()=>{
  const out=validateParams(g,{artwork:'pixel-face',artwork_block:'2',block_2_symbol:'B'});
  assert.equal(out.ok,false);
  assert.ok(out.fieldErrors.block_2_symbol);
  assert.ok(validateParams(g,{artwork:'pixel-face',artwork_block:'2',block_1_symbol:'A'}).ok);
});
test('a plain fit sample does not require unused artwork or font permissions',()=>{
  const out=validateParams(g,{model_kind:'fit',artwork:'image',block_1_symbol:'A',font:'system',font_license_ack:false});
  assert.ok(out.ok,out.errors.join('; '));
});

test('size edits clamp connector thickness and chamfer to a mechanically valid combination',()=>{
  const defaults=validateParams(g,{}).value;
  const small=clampParams(g,{...defaults,size_mm:18},'size_mm');
  assert.ok(validateParams(g,small).ok);
  assert.doesNotThrow(()=>cubeMechanics(small));
  for(const [key,value] of [['connector_mm',10],['chamfer_mm',2.5],['clearance_mm',0.5]]) {
    const edited=clampParams(g,{...defaults,[key]:value},key);
    assert.ok(validateParams(g,edited).ok,`${key} edit must preserve a valid mechanism`);
    assert.equal(edited[key],value,'the edited field wins');
  }
  const squareEdges=clampParams(g,{...defaults,chamfer_mm:0},'chamfer_mm');
  assert.ok(validateParams(g,squareEdges).ok);
  assert.equal(squareEdges.chamfer_mm,0);
  assert.ok(squareEdges.block_gap_mm>=3.4,'two square edges require clearance during the coupled fold');
});

test('raised painting reserves enough gap for two decorated faces to meet during folding',()=>{
  assert.equal(validateParams(g,{block_1_symbol:'A',mark_height_mm:1,block_gap_mm:1}).ok,false);
  const defaults=validateParams(g,{block_1_symbol:'A'}).value;
  const taller=clampParams(g,{...defaults,mark_height_mm:1},'mark_height_mm');
  assert.ok(validateParams(g,taller).ok);
  assert.ok(taller.block_gap_mm>=2.2);
});
test('spherical connector input below its dynamic minimum clamps to a valid bearing',()=>{
  const defaults=validateParams(g,{shape:'spherical'}).value;
  const edited=clampParams(g,{...defaults,connector_mm:4},'connector_mm');
  assert.ok(validateParams(g,edited).ok);
  assert.equal(edited.size_mm,18);
  assert.equal(edited.connector_mm,4.6);
  const large=clampParams(g,{...defaults,size_mm:40,connector_mm:10,chamfer_mm:0},'size_mm');
  assert.ok(validateParams(g,large).ok);
  assert.ok(large.block_gap_mm>=1.2,'large round bearing feet need their own corner sweep gap');
});
test('a coupled corner sweep rejects the small gap that only passed a single fold',()=>{
  assert.equal(validateParams(g,{size_mm:18,connector_mm:6.8,chamfer_mm:1.7,block_gap_mm:0.6}).ok,false);
  assert.ok(validateParams(g,{size_mm:18,connector_mm:6.8,chamfer_mm:1.7,block_gap_mm:0.9}).ok);
  const defaults=validateParams(g,{}).value;
  assert.ok(validateParams(g,clampParams(g,{...defaults,block_gap_mm:0.6},'block_gap_mm')).ok);
});
