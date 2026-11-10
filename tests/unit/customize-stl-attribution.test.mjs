import test from 'node:test';
import assert from 'node:assert/strict';
import {partsToStl} from '../../customizer/framework/stl.js';
import g from '../../public/assets/js/customize/generators/infinity-fidget.js';
import {readFile} from 'node:fs/promises';

const parts=[{mesh:{vertices:[[0,0,0],[1,0,0],[0,1,0]],triangles:[[0,1,2]]}}];

test('3MF public provenance retains the complete distributed MIT notice',async()=>{
  const notice=await readFile(new URL('../../customizer/static/licenses/infinity-fidget-MIT.txt',import.meta.url),'utf8');
  assert.equal(g.publicParams({}).source_notice.replace(/\r\n/g,'\n').trim(),notice.replace(/\r\n/g,'\n').trim());
  assert.ok(g.stlHeader.length<=80);
  assert.match(g.stlHeader,/https:\/\/3dprint4.me\//);
});

test('binary STL can retain a static generator attribution without changing mesh records',()=>{
  const data=partsToStl(parts,{header:g.stlHeader});
  assert.match(new TextDecoder().decode(data.slice(0,80)),/Jan Pieper/);
  assert.match(new TextDecoder().decode(data.slice(0,80)),/infinity-fidget-MIT/);
  assert.equal(new DataView(data.buffer).getUint32(80,true),1);
  assert.equal(data.length,134);
});

test('STL headers are bounded to 80 printable bytes and preserve the existing default',()=>{
  assert.match(new TextDecoder().decode(partsToStl(parts).slice(0,80)),/^3dprint4.me customizer/);
  const data=partsToStl(parts,{header:'A'.repeat(200)});
  assert.equal(new TextDecoder().decode(data.slice(0,80)),'A'.repeat(80));
  assert.equal(new DataView(data.buffer).getUint32(80,true),1);
});
