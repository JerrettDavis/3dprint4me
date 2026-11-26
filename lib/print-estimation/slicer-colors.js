import {readZipDirectory,readZipEntry} from '../../public/assets/js/print-estimation/three-mf.js';
import {MODEL_ANALYSIS_LIMITS} from '../../public/assets/js/print-estimation/mesh.js';
import {nodeInflateRaw} from './geometry/analyze-model.js';
import {SliceError} from './slicer-contract.js';

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
      } else if (name === 'metadata/model_settings.config' || name === 'metadata/slic3r_pe_model.config') {
        for (const tag of source.matchAll(/<metadata\b[^>]*>/gi)) {
          if (!/\bkey\s*=\s*["']extruder["']/i.test(tag[0])) continue;
          const slot = Number(tag[0].match(/\bvalue\s*=\s*["'](\d+)["']/i)?.[1]);
          if (Number.isInteger(slot) && slot > 0) {
            if (name === 'metadata/slic3r_pe_model.config' && slot > 1) unsupportedPainting = true;
            else assigned = true;
            colorCount = Math.max(colorCount,slot);
          }
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
