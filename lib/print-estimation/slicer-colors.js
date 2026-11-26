import {readZipDirectory,readZipEntry} from '../../public/assets/js/print-estimation/three-mf.js';
import {MODEL_ANALYSIS_LIMITS} from '../../public/assets/js/print-estimation/mesh.js';
import {nodeInflateRaw} from './geometry/analyze-model.js';
import {SliceError} from './slicer-contract.js';

const xmlValue = value => String(value ?? '').replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(_,code)=>String.fromCodePoint(code[0].toLowerCase()==='x'?parseInt(code.slice(1),16):Number(code)));

/** Inspect assignment evidence only. Never return palette values or project metadata. */
export async function inspectSliceColors(bytes) {
  const limits = MODEL_ANALYSIS_LIMITS;
  const budget = {remaining:limits.maxZipUncompressedBytes};
  let colorCount = 1, genericColors = false, assigned = false, painted = false, unsupportedPainting = false;
  try {
    const entries = readZipDirectory(bytes,limits);
    for (const entry of entries.values()) {
      const name = entry.name.toLowerCase();
      if (!name.endsWith('.model') && !['metadata/project_settings.config','metadata/model_settings.config','metadata/slic3r_pe_model.config'].includes(name)) continue;
      const source = new TextDecoder('utf-8',{fatal:true}).decode(await readZipEntry(bytes,entry,budget,limits,nodeInflateRaw));
      if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('Unsupported XML declarations.');
      if (name === 'metadata/project_settings.config') {
        const project = JSON.parse(source);
        if (Array.isArray(project.filament_colour)) colorCount = Math.max(colorCount,project.filament_colour.length);
        if (Array.isArray(project.filament_type) && new Set(project.filament_type.map(value=>String(value).trim().toLowerCase())).size > 1) unsupportedPainting=true;
      } else if (name === 'metadata/model_settings.config' || name === 'metadata/slic3r_pe_model.config') {
        for (const tag of source.matchAll(/<metadata\b[^>]*>/gi)) {
          const key=xmlValue(tag[0].match(/\bkey\s*=\s*["']([^"']*)["']/i)?.[1]);
          if (key !== 'extruder') continue;
          const slot = Number(xmlValue(tag[0].match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1]).trim());
          if (Number.isInteger(slot) && slot > 0) {
            if (name === 'metadata/slic3r_pe_model.config' && slot > 1) unsupportedPainting = true;
            else assigned = true;
            colorCount = Math.max(colorCount,slot);
          } else unsupportedPainting=true;
        }
      } else {
        const resources = (source.match(/<(?:[\w.-]+:)?(?:base|color)\b/gi) ?? []).length;
        if (resources > 1 || /<(?:[\w.-]+:)?texture2d\b/i.test(source)) {genericColors = true;colorCount = Math.max(colorCount,resources);}
        painted ||= /\bpaint_color\s*=/.test(source);
        unsupportedPainting ||= /\b(?:[\w.-]+:)?mmu_segmentation\s*=/.test(source);
      }
      if (colorCount > 64) throw new Error('Too many color resources.');
    }
    return {colorCount,mapping:unsupportedPainting || genericColors || (colorCount > 1 && !assigned) || (painted && !assigned) ? 'review' : assigned ? 'assigned' : 'none'};
  } catch {throw new SliceError('unsupported','The model color assignments could not be inspected safely.');}
}
