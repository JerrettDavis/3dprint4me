import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildZip} from '../support/zip-fixtures.mjs';
import {inspectSliceColors} from '../../lib/print-estimation/slicer-colors.js';

test('generic 3MF color resources require mapping even when the caller selected one color', async()=>{
  const bytes = buildZip([{name:'3D/3dmodel.model',data:'<model><resources><basematerials id="1"><base displaycolor="#FF0000"/><base displaycolor="#00FF00"/></basematerials></resources></model>'}]);
  assert.deepEqual(await inspectSliceColors(bytes),{colorCount:2,mapping:'review'});
});
test('Bambu assignment inspection returns only bounded counts, never metadata values',async()=>{
  const bytes = buildZip([{name:'Metadata/project_settings.config',data:JSON.stringify({filament_colour:['#ff0000','#00ff00'],private_value:'never exposed'})},
    {name:'Metadata/model_settings.config',data:'<config><object><metadata key="extruder" value="2"/></object></config>'}]);
  const result = await inspectSliceColors(bytes);
  assert.deepEqual(result,{colorCount:2,mapping:'assigned'});
  assert.ok(!JSON.stringify(result).includes('never exposed'));
});
test('real assigned three-color fixture is detected independently of options.colors',async()=>{
  const bytes = await readFile(new URL('../fixtures/customize/three-color-bambu.3mf',import.meta.url));
  const result = await inspectSliceColors(bytes);
  assert.ok(result.colorCount >= 3);
  assert.equal(result.mapping,'assigned');
});

test('Prusa painted triangles and volume assignments cannot bypass color mapping review',async()=>{
  const bytes=buildZip([{name:'3D/3dmodel.model',data:'<model><triangle slic3rpe:mmu_segmentation="123"/></model>'},
    {name:'Metadata/Slic3r_PE_model.config',data:'<config><object><volume><metadata key="extruder" value="2"/></volume></object></config>'}]);
  assert.equal((await inspectSliceColors(bytes)).mapping,'review');
});
