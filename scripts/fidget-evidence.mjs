// Development evidence only. Exports real model bytes for slicing and mesh data
// for a review board; it does not register or publish the unfinished generator.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import definition from '../public/assets/js/customize/generators/infinity-fidget.js';
import {validateParams} from '../public/assets/js/customize/schema.js';
import build from '../customizer/generators/infinity-fidget/build.js';
import {loadEngine} from '../customizer/framework/engine.js';
import {buildModel} from '../customizer/framework/model.js';
import {partsToStl} from '../customizer/framework/stl.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const dir=resolve(process.argv[2]??join(root,'screenshots/fidget-evidence'));
await mkdir(dir,{recursive:true});
const wasm=await loadEngine(),models=[];
for(const design of definition.designs) {
  const checked=validateParams(definition,design.params);
  if(!checked.ok)throw new Error(`${design.id}: ${checked.errors.join('; ')}`);
  const out=await buildModel({...definition,build},checked.value,{wasm});
  await writeFile(join(dir,design.id+'.3mf'),out.data);
  await writeFile(join(dir,design.id+'.stl'),partsToStl(out.parts,{header:definition.stlHeader}));
  models.push({id:design.id,title:design.label,parts:out.parts,metrics:out.metrics,warnings:out.warnings});
}
await writeFile(join(dir,'models.json'),JSON.stringify(models));
await writeFile(join(dir,'LICENSE.txt'),await readFile(join(root,'customizer/static/licenses/infinity-fidget-MIT.txt')));
console.log(JSON.stringify({directory:dir,models:models.map(m=>({id:m.id,...m.metrics}))},null,2));
