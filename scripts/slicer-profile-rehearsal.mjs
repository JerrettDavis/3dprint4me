// Offline, credential-free real-engine rehearsal. Run inside Dockerfile.bambu's image
// with this repository mounted at /source and --network none.
import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, writeFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {effectiveBambuProcess,effectivePrusaProfile} from '../lib/print-estimation/slicer-process-policy.js';
import {parseBambuResult} from '../lib/print-estimation/adapters/bambu-cli-slicer.js';
import {parseGcodeSummary} from '../lib/print-estimation/adapters/local-cli-slicer.js';

function boxesStl(boxes) {
  const triangles = [];
  const faces = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  for (const [x,y,z,w,d,h] of boxes) {
    const p = [[x,y,z],[x+w,y,z],[x+w,y+d,z],[x,y+d,z],[x,y,z+h],[x+w,y,z+h],[x+w,y+d,z+h],[x,y+d,z+h]];
    for (const face of faces) triangles.push(face.map(i=>p[i]));
  }
  const bytes = Buffer.alloc(84 + triangles.length*50);
  bytes.writeUInt32LE(triangles.length, 80);
  triangles.forEach((triangle,i)=>triangle.flat().forEach((n,j)=>bytes.writeFloatLE(n,84+i*50+12+j*4)));
  return bytes;
}

const directory = await mkdtemp(join(tmpdir(), '3dp-support-rehearsal-'));
try {
  const prusa = process.env.SLICER_PROVIDER === 'local-cli';
  // Engine verification only: this synthetic Prusa config is never deployed as a shop profile.
  const base = prusa ? 'printer_settings_id = Synthetic engine rehearsal\n' + (await readFile('/source/deploy/slicer-worker/profiles/default.ini','utf8')).split('\n').filter(line=>!line.startsWith('#')).join('\n')
    : JSON.parse(await readFile(process.env.SLICER_PROCESS_PROFILE, 'utf8'));
  const results = [];
  for (const [name, boxes, trees] of [
    ['flat-auto', [[0,0,0,20,20,4]], true],
    ['overhang-disabled', [[16,6,0,8,8,20],[0,0,20,40,20,4]], false],
    ['overhang-auto', [[16,6,0,8,8,20],[0,0,20,40,20,4]], true]
  ]) {
    const model = join(directory, `${name}.stl`);
    const preset = join(directory, `${name}.${prusa?'ini':'json'}`);
    const output = join(directory, name);
    await writeFile(model, boxesStl(boxes));
    await writeFile(preset, prusa ? (trees ? effectivePrusaProfile(base,'pla') : base) : JSON.stringify(trees ? effectiveBambuProcess(base) : {...base, enable_support:'0'}));
    const args = prusa ? ['--export-gcode','--load',preset,'--output',`${output}.gcode`,model]
      : ['--slice','0','--arrange','1','--orient','0','--load-settings',`${process.env.SLICER_MACHINE_PROFILE};${preset}`,
      '--load-filaments','/app/profiles/filament-pla.json','--curr-bed-type',process.env.SLICER_BED_TYPE,'--outputdir',output,model];
    execFileSync(process.env.SLICER_BIN, args,
      {timeout:300_000, maxBuffer:16*1024*1024, stdio:['ignore','pipe','pipe']});
    const result = prusa ? {...parseGcodeSummary(await readFile(`${output}.gcode`,'utf8')),returnCode:0}
      : parseBambuResult(await readFile(join(output,'result.json'),'utf8'));
    const gcodes = prusa ? [`${name}.gcode`] : (await readdir(output)).filter(name=>name.endsWith('.gcode'));
    let supportFeatures = 0;
    const settings = new Set();
    for (const file of gcodes) {
      const source = await readFile(join(prusa?directory:output,file),'utf8');
      supportFeatures += (source.match(/^;\s*(?:FEATURE|TYPE):\s*Support/igm) ?? []).length;
      for (const line of source.split('\n')) if (/^;\s*(enable_support|support_type|support_on_build_plate_only|support_material|support_material_style|support_material_auto)\s*=/.test(line)) settings.add(line.trim());
    }
    results.push({name,...result,supportFeatures,settings:[...settings]});
  }
  console.log(JSON.stringify(results,null,2));
  const [flat,off,on] = results;
  if (flat.returnCode !== 0 || off.returnCode !== 0 || on.returnCode !== 0 || flat.supportFeatures || off.supportFeatures || !on.supportFeatures
    || !(on.materialGrams > off.materialGrams) || !(on.elapsedSeconds > off.elapsedSeconds)
    || !on.settings.some(line=>(prusa?/support_material_style\s*=\s*organic/:/support_type\s*=\s*tree\(auto\)/).test(line))) {
    throw new Error('Real-engine support rehearsal did not prove automatic trees and increased production totals.');
  }
} finally {await rm(directory,{recursive:true,force:true});}
