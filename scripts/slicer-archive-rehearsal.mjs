// Real-engine archive-policy rehearsal. Run in the pinned image with --network none,
// this repository mounted read-only at /source, and no worker credentials.
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sanitizeSliceArchive} from '../lib/print-estimation/slicer-sanitize.js';
import {effectiveBambuProcess} from '../lib/print-estimation/slicer-process-policy.js';
import {parseBambuResult} from '../lib/print-estimation/adapters/bambu-cli-slicer.js';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';

const directory=await mkdtemp(join(tmpdir(),'3dp-archive-rehearsal-'));
try {
  const machine=JSON.parse(await readFile(process.env.SLICER_MACHINE_PROFILE,'utf8'));
  const processPreset=effectiveBambuProcess(JSON.parse(await readFile(process.env.SLICER_PROCESS_PROFILE,'utf8')));
  const original=await readFile('/source/tests/fixtures/customize/three-color-bambu.3mf');
  const filament=JSON.parse(await readFile('/app/profiles/filament-pla.json','utf8'));
  const settingsPolicy={trustedSettings:{...machine,...processPreset},trustedFilament:filament};
  const processPath=join(directory,'process.json');
  await writeFile(processPath,JSON.stringify(processPreset));
  async function run(name,archive,sanitize=true) {
  const sanitized=sanitize ? await sanitizeSliceArchive(archive,settingsPolicy) : {bytes:archive,filamentColors:[]};
  const model=join(directory,`${name}.3mf`),output=join(directory,name);
  await writeFile(model,sanitized.bytes);
  try {
    execFileSync(process.env.SLICER_BIN,['--slice','0','--arrange','1','--orient','0','--load-settings',`${process.env.SLICER_MACHINE_PROFILE};${processPath}`,
      '--load-filaments','/app/profiles/filament-pla.json','--curr-bed-type',process.env.SLICER_BED_TYPE,
      ...(sanitized.filamentColors.length ? ['--filament-colour',sanitized.filamentColors.join(';')] : []),'--outputdir',output,model],
      {timeout:300_000,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});
  } catch(error) {
    // This command only uses the synthetic committed fixture and credential-free image.
    console.error(String(error.stdout ?? '').slice(-6000));
    console.error(String(error.stderr ?? '').slice(-2000));
    console.error(await readFile(join(output,'result.json'),'utf8').catch(()=>String(error.message).slice(0,1000)));
    throw new Error('Pinned engine rejected the synthetic archive rehearsal.');
  }
  const result=parseBambuResult(await readFile(join(output,'result.json'),'utf8'));
  const settings=new Set();
  let supportFeatures=0;
  const heights=new Set();
  const layerZ=new Set();
  for (const file of (await readdir(output)).filter(name=>name.endsWith('.gcode'))) {
    const gcode=await readFile(join(output,file),'utf8');
    supportFeatures+=(gcode.match(/^;\s*FEATURE:\s*Support/igm) ?? []).length;
    for (const match of gcode.matchAll(/^;\s*(?:LAYER_HEIGHT|layer_height):\s*([\d.]+)/gm)) heights.add(Number(match[1]));
    for (const match of gcode.matchAll(/^;\s*Z_HEIGHT:\s*([\d.]+)/gm)) layerZ.add(Number(match[1]));
    for (const line of gcode.split('\n')) if (/^;\s*(enable_support|support_type|layer_height|flush_multiplier|filament_colour|flush_volumes_matrix)\s*=/.test(line)) settings.add(line.trim());
  }
  const z=[...layerZ].sort((a,b)=>a-b);
  const maxLayerStep=z.length ? Math.max(...z.map((height,index)=>height-(z[index-1] ?? 0))) : null;
  return {name,result,settings:[...settings],supportFeatures,extrusionHeights:[...heights],layerCount:z.length,maxLayerStep};
  }

  function box(id,x,y,z,w,d,h) {
    const p=[[x,y,z],[x+w,y,z],[x+w,y+d,z],[x,y+d,z],[x,y,z+h],[x+w,y,z+h],[x+w,y+d,z+h],[x,y+d,z+h]];
    const faces=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
    return `<object id="${id}" type="model"><mesh><vertices>${p.map(v=>`<vertex x="${v[0]}" y="${v[1]}" z="${v[2]}"/>`).join('')}</vertices><triangles>${faces.map(f=>`<triangle v1="${f[0]}" v2="${f[1]}" v3="${f[2]}"/>`).join('')}</triangles></mesh></object>`;
  }
  const malicious=unzipSync(original);
  const geometry=box(1,16,6,0,8,8,20)+box(2,0,0,20,40,20,4)+box(3,50,0,0,4,4,4)+'<object id="4" type="model"><components><component objectid="1"/><component objectid="2"/><component objectid="3"/></components></object>';
  malicious['3D/3dmodel.model']=strToU8(strFromU8(malicious['3D/3dmodel.model']).replace(/<resources>[\s\S]*?<\/resources>/,`<resources>${geometry}</resources>`));
  malicious['Metadata/model_settings.config']=strToU8(strFromU8(malicious['Metadata/model_settings.config']).replace(/(<object\b[^>]*>|<part\b[^>]*>)/g,'$1<metadata key="enable_support" value="0"/><metadata key="support_type" value="normal(manual)"/><metadata key="layer_height" value="0.24"/><metadata key="sparse_infill_density" value="100%"/>'));
  const project=JSON.parse(strFromU8(malicious['Metadata/project_settings.config']));
  Object.assign(project,{enable_support:'0',support_type:'normal(manual)',layer_height:'0.24',flush_multiplier:['0'],flush_volumes_matrix:project.flush_volumes_matrix.map(()=> '0')});
  malicious['Metadata/project_settings.config']=strToU8(JSON.stringify(project));
  const hostile=zipSync(malicious);
  const results=[await run('assigned-colors',original),await run('hostile-unsanitized',hostile,false),await run('hostile-sanitized',hostile)];
  console.log(JSON.stringify(results,null,2));
  const [colors,off,on]=results;
  if (!(colors.result.toolChanges > 0) || !(colors.result.wasteGrams > 0) || off.supportFeatures !== 0 || !(on.supportFeatures > 0)
    || !on.settings.includes('; support_type = tree(auto)') || !on.settings.includes('; layer_height = 0.16')
    || !(off.maxLayerStep > 0.201) || !(on.maxLayerStep > 0) || on.maxLayerStep > 0.201) throw new Error('Archive rehearsal failed to prove trusted supports, quality and multicolor waste.');
} finally {await rm(directory,{recursive:true,force:true});}
