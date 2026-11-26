import {XMLParser,XMLBuilder,XMLValidator} from 'fast-xml-parser';
import {zipSync,strToU8} from 'fflate';
import {readZipDirectory,readZipEntry} from '../../public/assets/js/print-estimation/three-mf.js';
import {MODEL_ANALYSIS_LIMITS} from '../../public/assets/js/print-estimation/mesh.js';
import {nodeInflateRaw} from './geometry/analyze-model.js';
import {SliceError} from './slicer-contract.js';

const IDENTITY_KEYS = new Set(['name','extruder','matrix','part_type','volume_type','modifier','plater_id','plater_name','locked','object_id','instance_id']);
const COLOR_KEYS = new Set(['filament_colour','filament_multi_colour','filament_colour_type','filament_settings_id','filament_ids']);
const REMOVE = /^metadata\/(?:layer_config_ranges\.xml|layer_heights_profile\.txt|custom_gcode_per_layer\.xml|slic3r_pe_layer_heights_profile\.txt|prusa_slicer_(?:layer_config_ranges|custom_gcode_per_print_z|wipe_tower_information)\.xml|slic3r_pe\.config|.*\.gcode)$/i;
const xmlOptions = {ignoreAttributes:false,preserveOrder:true,processEntities:true,htmlEntities:true,parseTagValue:false,parseAttributeValue:false};

function cleanObjectConfig(source,prusa) {
  const types=new Set(prusa ? ['ModelPart','NegativeVolume','ParameterModifier','0','1'] : ['normal_part','negative_part','modifier_part']);
  const validateType=value=>{if (!types.has(String(value))) throw new Error('Unsupported volume type.');};
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('Unsupported XML declarations.');
  if (XMLValidator.validate(source) !== true) throw new Error('Invalid object configuration XML.');
  const parsed = new XMLParser(xmlOptions).parse(source);
  function clean(nodes,depth=0) {
    if (depth > 64) throw new Error('Configuration too deep.');
    return nodes.filter(node=> {
      const attrs=node[':@'] ?? {};
      if (attrs['@_subtype'] != null) validateType(attrs['@_subtype']);
      if ('metadata' in node && ['part_type','volume_type'].includes(attrs['@_key'])) validateType(attrs['@_value']);
      if ('metadata' in node && attrs['@_key'] === 'modifier' && !['0','1'].includes(String(attrs['@_value']))) throw new Error('Unsupported modifier.');
      if ('metadata' in node && !IDENTITY_KEYS.has(attrs['@_key'])) return false;
      for (const [key,value] of Object.entries(node)) if (key !== ':@' && Array.isArray(value)) node[key]=clean(value,depth+1);
      return true;
    });
  }
  return new XMLBuilder(xmlOptions).build(clean(parsed));
}

/** Private slicer copy only: original customer asset is never overwritten. */
export async function sanitizeSliceArchive(bytes,{trustedSettings={},trustedFilament={}}={}) {
  const limits=MODEL_ANALYSIS_LIMITS, budget={remaining:limits.maxZipUncompressedBytes};
  const output=Object.create(null);
  let filamentColors=[];
  try {
    for (const entry of readZipDirectory(bytes,limits).values()) {
      const name=entry.name.toLowerCase();
      if (REMOVE.test(name)) continue;
      let content=await readZipEntry(bytes,entry,budget,limits,nodeInflateRaw);
      if (name === 'metadata/model_settings.config' || name === 'metadata/slic3r_pe_model.config') {
        if (content.length > 2*1024*1024) throw new Error('Configuration too large.');
        content=strToU8(cleanObjectConfig(new TextDecoder('utf-8',{fatal:true}).decode(content),name === 'metadata/slic3r_pe_model.config'));
      } else if (name === 'metadata/project_settings.config') {
        if (content.length > 2*1024*1024) throw new Error('Configuration too large.');
        const original=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(content));
        const colors=original.filament_colour;
        if (colors != null && (!Array.isArray(colors) || colors.length > 64 || colors.some(value=>typeof value !== 'string' || !/^#[a-f0-9]{6}(?:[a-f0-9]{2})?$/i.test(value)))) throw new Error('Invalid color palette.');
        filamentColors=colors ?? [];
        const project=Object.fromEntries(Object.entries(original).filter(([key])=>COLOR_KEYS.has(key)));
        // Profile metadata is not a global print setting. Uploaded process and machine
        // settings, purge multipliers/matrices and G-code are deliberately not retained.
        for (const [key,value] of Object.entries(trustedSettings)) if (!['name','type','from','inherits','instantiation'].includes(key)) project[key]=value;
        const count=Math.max(1,filamentColors.length);
        for (const [key,value] of Object.entries(trustedFilament)) {
          if (['name','type','from','inherits','instantiation','compatible_printers','compatible_printers_condition','filament_settings_id','filament_colour'].includes(key)) continue;
          project[key]=Array.isArray(value) && value.length === 1 ? Array(count).fill(value[0]) : value;
        }
        project.filament_is_support=Array(count).fill(trustedFilament.filament_is_support?.[0] ?? '0');
        content=strToU8(JSON.stringify(project));
      } else if (name.endsWith('.model')) {
        const source=new TextDecoder('utf-8',{fatal:true}).decode(content);
        if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('Unsupported XML declarations.');
        // Keep geometry, transforms and paint_color. Remove painted support overrides.
        content=strToU8(source.replace(/\s+(?:[\w.-]+:)?(?:paint_supports|custom_supports)\s*=\s*(?:"[^"]*"|'[^']*')/gi,''));
      }
      output[entry.name]=content;
    }
    return {bytes:zipSync(output,{level:0}),filamentColors};
  } catch {throw new SliceError('unsupported','The embedded model settings require operator review.');}
}

