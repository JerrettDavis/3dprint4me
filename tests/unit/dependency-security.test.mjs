import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// GHSA-mrhx-c7xc-m3w5, GHSA-xjj6-f33q-929c and the Vite 8.3 editor/server advisories.
// Inspect every locked copy, including nested SDK dependencies.
test('locked dependency graph excludes the reviewed vulnerable Zod, Undici and Vite releases',async()=>{
 const {packages}=JSON.parse(await readFile(new URL('../../package-lock.json',import.meta.url),'utf8'));
 assert.ok(!packages[''].dependencies?.['3dprint4me'],'project must not depend on its own local worktree');
 assert.ok(!Object.keys(packages).some(path=>/^[A-Za-z]:/.test(path)),'lockfile must not embed a machine-local dependency');
 const minimum={zod:[4,6,6],undici:[6,29,1],vite:[8,3,5]};
 for(const [name,required] of Object.entries(minimum)){
  const copies=Object.entries(packages).filter(([path])=>path.endsWith('/node_modules/'+name)||path==='node_modules/'+name);
  assert.ok(copies.length,'locked '+name+' is present');
  for(const [path,row] of copies){const version=row.version.split('.').map(Number);assert.ok(version.length===3&&version.every(Number.isInteger),path+' has a stable version');
   assert.equal(version[0],required[0],path+' major upgrades require explicit compatibility review');
   const comparison=version[0]-required[0]||version[1]-required[1]||version[2]-required[2];assert.ok(comparison>=0,path+' must include the reviewed security patch');
  }
 }
});
