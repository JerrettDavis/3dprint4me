import { zipSync, strToU8 } from 'fflate';
import { BAMBU_PROJECT_SETTINGS } from './bambu-template.js';

const CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CONTENT = 'http://schemas.openxmlformats.org/package/2006/content-types';

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function color8(value) {
  let s = String(value || '#ffffff').trim().toUpperCase();
  if (!s.startsWith('#')) s = `#${s}`;
  if (/^#[0-9A-F]{6}$/.test(s)) return `${s}FF`;
  if (/^#[0-9A-F]{8}$/.test(s)) return s;
  throw new Error(`Invalid color: ${value}`);
}

function meshXml(mesh) {
  const verts = mesh.vertices.map(([x, y, z]) => `<vertex x="${x.toFixed(6)}" y="${y.toFixed(6)}" z="${z.toFixed(6)}"/>`).join('');
  const tris = mesh.triangles.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`).join('');
  return `<mesh><vertices>${verts}</vertices><triangles>${tris}</triangles></mesh>`;
}

const MAX_SLOTS = 5;
const BED_CENTER = [128, 128];

function bounds(parts) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) for (const v of p.mesh.vertices) for (let i = 0; i < 3; i++) {
    if (v[i] < min[i]) min[i] = v[i];
    if (v[i] > max[i]) max[i] = v[i];
  }
  return { min, max };
}

function slotsFor(parts) {
  const colors = [];
  for (const p of parts) {
    const c = color8(p.color).slice(0, 7);
    if (!colors.includes(c)) colors.push(c);
  }
  if (colors.length > MAX_SLOTS) throw new Error(`Bambu export supports at most ${MAX_SLOTS} unique colors; got ${colors.length}.`);
  return colors;
}

function modelXml(parts, title, description, slots) {
  const objects = parts.map((p, i) =>
    `<object id="${i + 1}" type="model">${meshXml(p.mesh)}</object>`).join('');
  const asmId = parts.length + 1;
  const components = parts.map((_, i) => `<component objectid="${i + 1}"/>`).join('');
  const { min, max } = bounds(parts);
  const tx = (BED_CENTER[0] - (min[0] + max[0]) / 2).toFixed(6);
  const ty = (BED_CENTER[1] - (min[1] + max[1]) / 2).toFixed(6);
  const tz = (-min[2]).toFixed(6);
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model xmlns="${CORE}" unit="millimeter" xml:lang="en-US">` +
      `<metadata name="Application">BambuStudio-02.08.02.61</metadata>` +
      `<metadata name="BambuStudio:3mfVersion">1</metadata>` +
      `<metadata name="Title">${esc(title)}</metadata>` +
      `<metadata name="Designer">3dprint4.me</metadata>` +
      `<metadata name="Description">${esc(description)}</metadata>` +
      `<resources>${objects}` +
        `<object id="${asmId}" type="model"><components>${components}</components></object>` +
      `</resources>` +
      `<build><item objectid="${asmId}" transform="1 0 0 0 1 0 0 0 1 ${tx} ${ty} ${tz}" printable="1"/></build>` +
    `</model>`;
}

function modelSettingsXml(parts, title, slots) {
  const asmId = parts.length + 1;
  const partXml = parts.map((p, i) => {
    const ext = slots.indexOf(color8(p.color).slice(0, 7)) + 1;
    return `<part id="${i + 1}" subtype="normal_part">` +
      `<metadata key="name" value="${esc(p.name)}"/>` +
      `<metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>` +
      `<metadata key="extruder" value="${ext}"/>` +
      `</part>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<config>` +
    `<object id="${asmId}"><metadata key="name" value="${esc(title)}"/><metadata key="extruder" value="1"/>${partXml}</object>` +
    `<plate><metadata key="plater_id" value="1"/><metadata key="plater_name" value=""/><metadata key="locked" value="false"/>` +
      `<model_instance><metadata key="object_id" value="${asmId}"/><metadata key="instance_id" value="0"/></model_instance></plate>` +
    `</config>`;
}

function projectSettings(slots, overrides = {}) {
  const cfg = structuredClone(BAMBU_PROJECT_SETTINGS);
  slots.forEach((c, i) => { cfg.filament_colour[i] = c; });
  // A generator may set slicer options (supports for a hollow dome, spiral vase mode). Only keys
  // the template already has, so a typo cannot slip a bogus setting into the file.
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(cfg, key)) throw new Error(`Unknown slicer setting "${key}".`);
    cfg[key] = value;
  }
  return JSON.stringify(cfg, null, 4);
}

function contentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Types xmlns="${CONTENT}">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>` +
      `<Default Extension="config" ContentType="text/xml"/>` +
      `<Default Extension="json" ContentType="application/json"/>` +
    `</Types>`;
}

function relationshipsXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Relationships xmlns="${REL}">` +
      `<Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>` +
    `</Relationships>`;
}

export function package3mf(parts, { title, description, parameters, settings }) {
  if (!parts.length) throw new Error('No geometry parts were generated.');
  for (const p of parts) {
    if (!p.mesh.vertices.length || !p.mesh.triangles.length) throw new Error(`Part ${p.name} is empty.`);
  }
  const slots = slotsFor(parts);
  const model = modelXml(parts, title, description, slots);
  return zipSync({
    '[Content_Types].xml': strToU8(contentTypesXml()),
    '_rels/.rels': strToU8(relationshipsXml()),
    '3D/3dmodel.model': strToU8(model),
    'Metadata/model_settings.config': strToU8(modelSettingsXml(parts, title, slots)),
    'Metadata/project_settings.config': strToU8(projectSettings(slots, settings)),
    'Metadata/customizer.json': strToU8(JSON.stringify(parameters, null, 2))
  }, { level: 6 });
}
