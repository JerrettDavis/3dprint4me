const presets = {
  standard: {},
  sample: { columns: 1, rows: 1 },
  light: { style: 'light', columns: 4, rows: 3 },
  magnetic: { style: 'magnetic', columns: 3, rows: 2 }
};
export default {
  id: 'gridfinity-base', version: 1, title: 'Gridfinity baseplate',
  blurb: 'A 42 mm Gridfinity grid: standard magnetless rails, a lighter open lattice, or a magnetic base. Choose rows and columns.',
  category: 'organization', origin: 'house', initialView: '3d',
  viewLabels: { front: 'Top', back: 'Bottom' },
  rights: { publishable: true, note: 'Independent geometry using the MIT Gridfinity/Rebuilt mating profile. Kenneth Hodson; Zachary Freedman and Voidstar Lab LLC. License included with the local generator assets.' },
  schema: {
    columns: { type: 'int', label: 'Columns', min: 1, max: 6, step: 1, default: 3, group: 'size', help: '42 mm per column. Check your printer bed before downloading.' },
    rows: { type: 'int', label: 'Rows', min: 1, max: 6, step: 1, default: 2, group: 'size' },
    style: { type: 'enum', label: 'Construction', default: 'standard', group: 'base', options: [{ value: 'standard', label: 'Standard · magnetless' }, { value: 'light', label: 'Less material · magnetless' }, { value: 'magnetic', label: 'Magnetic · solid subfloor' }], help: 'Print flat without supports. The lighter lattice thins the lower rails while preserving full seating height; it is less rigid. Magnetic bases have downward-open glue pockets for 6 × 2 mm magnets; default pockets are 6.2 × 2.2 mm; roofs bridge up to 6.4 mm.' },
    clearance_mm: { type: 'number', label: 'Socket clearance per side', min: 0.15, max: 0.4, step: 0.05, default: 0.25, unit: 'mm', group: 'base', advanced: true, randomize: false, help: 'Print a 1 × 1 fit sample first. Physical fit depends on your printer; no sample fit is certified.' },
    magnet_diameter_mm: { type: 'number', label: 'Magnet pocket diameter', min: 6, max: 6.4, step: 0.1, default: 6.2, unit: 'mm', group: 'base', advanced: true, randomize: false, visibleWhen: { style: 'magnetic' }, help: 'For nominal 6 mm magnets. Allow glue clearance; test your magnets before printing a full base.' },
    magnet_depth_mm: { type: 'number', label: 'Magnet pocket depth', min: 2, max: 2.4, step: 0.1, default: 2.2, unit: 'mm', group: 'base', advanced: true, randomize: false, visibleWhen: { style: 'magnetic' }, help: 'At least 0.8 mm of subfloor remains above each pocket.' },
    color: { type: 'color', label: 'Base color', default: '#527c70', group: 'colors' }
  },
  presets,
  designs: Object.entries(presets).map(([id, params]) => ({ id, label: { standard: 'Standard grid', sample: 'Fit sample', light: 'Less material', magnetic: 'Magnetic base' }[id], blurb: { standard: 'Open sockets with full-height mating rails; no magnets needed.', sample: 'One cell to check your printer and mating fit before a full grid.', light: 'An open lattice with thinner lower rails and full mating height.', magnetic: 'Solid subfloor with glue-in magnet pockets.' }[id], params })),
  defaultDesign: 'standard'
};

