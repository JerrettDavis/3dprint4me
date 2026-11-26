import test from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
import {buildZip} from '../support/zip-fixtures.mjs';
import {sanitizeSliceArchive} from '../../lib/print-estimation/slicer-sanitize.js';

test('private working archive keeps geometry and color slots but removes process overrides',async()=>{
  const model='<model><triangle v1="0" v2="1" v3="2" paint_color="1" paint_supports="2"/></model>';
  const bytes=buildZip([{name:'3D/3dmodel.model',data:model},
    {name:'Metadata/model_settings.config',data:'<config><object id="4"><metadata key="enable_support" value="0"/><metadata key="layer_height" value="0.6"/><part id="1"><metadata key="extruder" value="2"/><metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/></part></object></config>'},
    {name:'Metadata/project_settings.config',data:JSON.stringify({filament_colour:['#ff0000','#00ff00'],filament_settings_id:['PLA','PLA'],enable_support:'0',layer_height:'0.6',flush_multiplier:['0'],flush_volumes_matrix:['0','0','0','0'],machine_start_gcode:'untrusted'})},
    {name:'Metadata/layer_config_ranges.xml',data:'untrusted'},
    {name:'Metadata/custom_gcode_per_layer.xml',data:'untrusted'}]);
  const result=await sanitizeSliceArchive(bytes,{trustedSettings:{enable_support:'1',support_type:'tree(auto)',layer_height:'0.16'}});
  const entries=unzipSync(result.bytes);
  const settings=strFromU8(entries['Metadata/model_settings.config']);
  assert.doesNotMatch(settings,/enable_support|layer_height/);
  assert.match(settings,/extruder/);
  assert.match(settings,/matrix/);
  assert.match(strFromU8(entries['3D/3dmodel.model']),/paint_color="1"/);
  assert.doesNotMatch(strFromU8(entries['3D/3dmodel.model']),/paint_supports/);
  assert.equal(entries['Metadata/layer_config_ranges.xml'],undefined);
  assert.equal(entries['Metadata/custom_gcode_per_layer.xml'],undefined);
  const project=JSON.parse(strFromU8(entries['Metadata/project_settings.config']));
  assert.equal(project.enable_support,'1');
  assert.equal(project.layer_height,'0.16');
  assert.equal(project.machine_start_gcode,undefined);
  assert.equal(project.flush_multiplier,undefined);
  assert.equal(project.flush_volumes_matrix,undefined);
  assert.deepEqual(project.filament_colour,['#ff0000','#00ff00']);
  assert.deepEqual(result.filamentColors,['#ff0000','#00ff00']);
});

test('Prusa object and layer overrides are removed from the private copy',async()=>{
  const input=buildZip([{name:'3D/3dmodel.model',data:'<model/>'},
    {name:'Metadata/Slic3r_PE_model.config',data:'<config><object id="1"><metadata key="support_material" value="0"/><metadata key="name" value="Part"/></object></config>'},
    {name:'Metadata/Slic3r_PE.config',data:'support_material = 0'},
    {name:'Metadata/layer_heights_profile.txt',data:'0;0.6'}]);
  const {bytes}=await sanitizeSliceArchive(input);
  const output=unzipSync(bytes);
  assert.doesNotMatch(strFromU8(output['Metadata/Slic3r_PE_model.config']),/support_material/);
  assert.equal(output['Metadata/Slic3r_PE.config'],undefined);
  assert.equal(output['Metadata/layer_heights_profile.txt'],undefined);
});

test('XML character references preserve names and color slot identity in the working copy',async()=>{
  const input=buildZip([{name:'3D/3dmodel.model',data:'<model/>'},{name:'Metadata/model_settings.config',data:'<config><object id="1"><metadata key="name" value="A &amp; B"/><metadata key="extruder" value="&#50;"/></object></config>'}]);
  const {bytes}=await sanitizeSliceArchive(input);
  const source=strFromU8(unzipSync(bytes)['Metadata/model_settings.config']);
  assert.match(source,/value="2"/);
  assert.match(source,/A &amp; B/);
  assert.doesNotMatch(source,/&amp;amp;/);
});


test('Prusa geometry semantics survive while actual override files are removed',async()=>{
  const names=['Slic3r_PE_layer_heights_profile.txt','Prusa_Slicer_layer_config_ranges.xml','Prusa_Slicer_custom_gcode_per_print_z.xml','Prusa_Slicer_wipe_tower_information.xml'];
  const input=buildZip([{name:'Metadata/Slic3r_PE_model.config',data:'<config><volume><metadata key="modifier" value="1"/><metadata key="volume_type" value="NegativeVolume"/></volume></config>'},...names.map(name=>({name:'Metadata/'+name,data:'override'}))]);
  const output=unzipSync((await sanitizeSliceArchive(input)).bytes);
  assert.match(strFromU8(output['Metadata/Slic3r_PE_model.config']),/NegativeVolume/);
  assert.match(strFromU8(output['Metadata/Slic3r_PE_model.config']),/modifier/);
  for(const name of names) assert.equal(output['Metadata/'+name],undefined);
});

test('support and unknown volume types fail closed in both archive dialects',async()=>{
  for(const [file,values] of [['model_settings.config',['support_blocker','support_enforcer','unknown','NegativeVolume']],['Slic3r_PE_model.config',['SupportBlocker','SupportEnforcer','unknown','negative_part']]]) {
    for(const key of ['part_type','volume_type']) for(const value of values) {
      const input=buildZip([{name:'Metadata/'+file,data:`<config><part><metadata key="${key}" value="${value}"/></part></config>`}]);
      await assert.rejects(sanitizeSliceArchive(input),/require operator review/);
    }
  }
});

