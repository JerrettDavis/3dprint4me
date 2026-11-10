import { footprint } from '../gridfinity.js?v=d550e83a7468bf17';

const vase = p => p.style === 'vase';
const presets = {
  standard: {}, thin: { wall_mm: 1.2, stacking_lip: false },
  magnetic: { magnets: true }, labeled: { label_shelf: true },
  divided: { compartments_x: 2, compartments_y: 2 },
  vase: { style: 'vase', stacking_lip: false, vase_part: 'shell' },
  adapter: { style: 'vase', stacking_lip: false, vase_part: 'adapter' }
};
function rules(p) {
  const errors = [], fieldErrors = {};
  const add = (key, text) => { errors.push(text); fieldErrors[key] = text; };
  if (vase(p)) {
    if (p.stacking_lip) add('stacking_lip', 'Vase shells and adapters have no stacking lip.');
    if (p.magnets) add('magnets', 'Choose a standard bin for magnet pockets.');
    if (p.label_shelf) add('label_shelf', 'A spiral vase cannot have a label shelf.');
    if (p.compartments_x !== 1 || p.compartments_y !== 1) add('compartments_x', 'A spiral vase must have one continuous compartment.');
  }
  if (p.label_shelf && p.height_units < 3) add('height_units', 'The label shelf needs a bin at least 3 height units tall.');
  // clampParams calls rules on raw committed edits before bounding the numbers.
  // Invalid counts belong to scalar validation/clamping, not a throwing helper.
  if (![p.columns, p.rows].every(n => Number.isInteger(n) && n >= 1 && n <= 6)) return { errors, fieldErrors };
  const { width, depth } = footprint(p.columns, p.rows);
  if ((width - 2 * p.wall_mm - (p.compartments_x - 1) * 1.2) / p.compartments_x < 12) add('compartments_x', 'Each compartment must be at least 12 mm wide.');
  if ((depth - 2 * p.wall_mm - (p.compartments_y - 1) * 1.2) / p.compartments_y < 12) add('compartments_y', 'Each compartment must be at least 12 mm deep.');
  return { errors, fieldErrors };
}
export default {
  id: 'gridfinity-bin', version: 1, title: 'Gridfinity bin',
  blurb: 'Scalable storage bins with dividers, paper-label shelves and optional magnets, plus separate spiral-vase shells and adapters.',
  category: 'organization', origin: 'house', initialView: '3d', viewLabels: { front: 'Top', back: 'Bottom' },
  rights: { publishable: true, note: 'Independent geometry using the MIT Gridfinity/Rebuilt mating profile. Kenneth Hodson; Zachary Freedman and Voidstar Lab LLC. Local MIT notices included.' },
  schema: {
    columns: { type: 'int', label: 'Columns', min: 1, max: 6, step: 1, default: 2, group: 'size' },
    rows: { type: 'int', label: 'Rows', min: 1, max: 6, step: 1, default: 2, group: 'size' },
    height_units: { type: 'int', label: 'Height units', min: 2, max: 12, step: 1, default: 6, group: 'size', help: '7 mm per unit to the rim, including the standard feet. A stacking lip adds 4 mm and has a printable 0.4 mm top rim.' },
    style: { type: 'enum', label: 'Print style', default: 'standard', group: 'construction', options: [{ value: 'standard', label: 'Standard bin' }, { value: 'vase', label: 'Spiral vase · two separate prints' }], help: 'Print upright without supports. A vase needs a separately printed adapter glued underneath.' },
    vase_part: { type: 'enum', label: 'Vase print component', default: 'shell', group: 'construction', visibleWhen: vase, options: [{ value: 'shell', label: 'Shell · spiral mode' }, { value: 'adapter', label: 'Adapter · normal printing' }], help: 'Download each component separately. The shell is exported solid for your slicer to hollow in spiral mode. Only the selected component goes with a print request; request both separately.' },
    wall_mm: { type: 'number', label: 'Wall thickness', min: 1.2, max: 2.4, step: 0.2, default: 1.6, unit: 'mm', group: 'construction', visibleWhen: p => !vase(p) },
    stacking_lip: { type: 'bool', label: 'Stacking lip', default: true, group: 'construction', visibleWhen: p => !vase(p) },
    magnets: { type: 'bool', label: '6 × 2 mm magnet pockets', default: false, group: 'construction', visibleWhen: p => !vase(p), help: 'Downward-open glue pockets, default 6.2 × 2.2 mm. Check polarity before gluing; roofs bridge up to 6.4 mm.' },
    compartments_x: { type: 'int', label: 'Compartments across', min: 1, max: 6, step: 1, default: 1, group: 'inside', visibleWhen: p => !vase(p) },
    compartments_y: { type: 'int', label: 'Compartments front to back', min: 1, max: 6, step: 1, default: 1, group: 'inside', visibleWhen: p => !vase(p) },
    label_shelf: { type: 'bool', label: 'Paper-label shelf', default: false, group: 'inside', visibleWhen: p => !vase(p), help: 'An 8 mm shelf with a 45° underside for a paper label. Minimum bin height: 3 units. Text is not printed into this shelf.' },
    magnet_diameter_mm: { type: 'number', label: 'Magnet pocket diameter', min: 6, max: 6.4, step: 0.1, default: 6.2, unit: 'mm', group: 'construction', advanced: true, randomize: false, visibleWhen: p => !vase(p) && p.magnets, help: 'For nominal 6 mm magnets. Allow glue clearance and test a sample.' },
    magnet_depth_mm: { type: 'number', label: 'Magnet pocket depth', min: 2, max: 2.4, step: 0.1, default: 2.2, unit: 'mm', group: 'construction', advanced: true, randomize: false, visibleWhen: p => !vase(p) && p.magnets },
    color: { type: 'color', label: 'Bin color', default: '#d6a052', group: 'colors' }
  }, rules,
  onParamChange(key, p) {
    if (key === 'style' && vase(p)) return { stacking_lip: false, magnets: false, label_shelf: false, compartments_x: 1, compartments_y: 1 };
    if (key === 'height_units' && p.height_units < 3) return { label_shelf: false };
    return null;
  },
  presets, designs: Object.entries(presets).map(([id, params]) => ({ id, label: { standard: 'Standard bin', thin: 'Thin walls', magnetic: 'Magnetic bin', labeled: 'Paper-label shelf', divided: 'Four compartments', vase: 'Vase shell', adapter: 'Vase adapter' }[id], blurb: ['vase', 'adapter'].includes(id) ? 'Download the shell and adapter separately, then glue together after printing.' : 'An editable starting point for your storage.', params })), defaultDesign: 'standard'
};

