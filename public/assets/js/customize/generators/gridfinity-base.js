const presets = {
  standard: {},
  sample: { columns: 1, rows: 1 },
  light: { style: 'light', columns: 4, rows: 3 },
  magnetic: { style: 'magnetic', columns: 3, rows: 2 },
  'magnetic-light': { style: 'magnetic-light', columns: 3, rows: 2 },
  'magnetic-sample': { style: 'magnetic-light', columns: 1, rows: 1 },
  'magnetic-tight': { style: 'magnetic-light', columns: 1, rows: 1, light_magnet_diameter_mm: 6.09 }
};
const magneticLight = { style: 'magnetic-light' };
function rules(p) {
  if (p.style !== 'magnetic-light') return { limits: {}, errors: [] };
  const limits = {
    light_base_mm: [Math.max(2.4, p.magnet_depth_mm + 0.4), 5],
    magnet_depth_mm: [2, Math.min(2.4, p.light_base_mm - 0.4)]
  };
  const message = 'Keep at least 0.4 mm beneath each magnet pocket. Increase the base thickness or reduce the pocket depth.';
  return { limits, errors: p.light_base_mm - p.magnet_depth_mm < 0.4 - 1e-6 ? [message] : [], fieldErrors: p.light_base_mm - p.magnet_depth_mm < 0.4 - 1e-6 ? { light_base_mm: message } : {} };
}
export default {
  id: 'gridfinity-base', version: 1, title: 'Gridfinity baseplate',
  blurb: 'A 42 mm Gridfinity grid: magnetless rails, a light magnetic frame with rounded magnet tabs, or a solid magnetic base. Choose rows and columns.',
  category: 'organization', origin: 'house', initialView: '3d',
  viewLabels: { front: 'Top', back: 'Bottom' },
  rights: { publishable: true, note: 'Independent geometry using the MIT Gridfinity/Rebuilt mating profile. Kenneth Hodson; Zachary Freedman and Voidstar Lab LLC. Magnetic light inspired by RIP_Plo-Koon’s Magnet Light Baseplate (Printables 250550). Notices and reference included with the local generator assets.' },
  schema: {
    columns: { type: 'int', label: 'Columns', min: 1, max: 6, step: 1, default: 3, group: 'size', help: '42 mm per column. Check your printer bed before downloading.' },
    rows: { type: 'int', label: 'Rows', min: 1, max: 6, step: 1, default: 2, group: 'size' },
    style: { type: 'enum', label: 'Construction', default: 'standard', group: 'base', options: [{ value: 'standard', label: 'Standard · magnetless' }, { value: 'light', label: 'Less material · magnetless' }, { value: 'magnetic', label: 'Magnetic · solid subfloor' }, { value: 'magnetic-light', label: 'Magnetic · light' }], help: 'Print flat without supports. Magnetic light has open centers, rounded corner tabs and top-open 6 × 2 mm magnet pockets, inspired by RIP_Plo-Koon’s Magnet Light Baseplate. Adjust thickness, openings and fit in Advanced. The solid magnetic base keeps downward-open glue pockets with bridges up to 6.4 mm.' },
    light_base_mm: { type: 'number', label: 'Base thickness below sockets', min: 2.4, max: 5, step: 0.2, default: 2.8, unit: 'mm', group: 'base', advanced: true, randomize: false, visibleWhen: magneticLight, help: 'Total plate height = this thickness + the fixed 4.75 mm mating rails. At least 0.4 mm stays under the magnet pockets.' },
    light_opening_mm: { type: 'number', label: 'Cell opening size', min: 30, max: 39.6, step: 0.2, default: 36, unit: 'mm', group: 'base', advanced: true, randomize: false, visibleWhen: magneticLight, help: 'Square opening before the rounded magnet tabs intrude at the corners. Larger openings reduce material and stiffness; outer rails remain at least 1.2 mm wide.' },
    light_tab_wall_mm: { type: 'number', label: 'Magnet tab wall thickness', min: 0.8, max: 2, step: 0.2, default: 1.2, unit: 'mm', group: 'base', advanced: true, randomize: false, visibleWhen: magneticLight },
    light_magnet_diameter_mm: { type: 'number', label: 'Light magnet pocket diameter', min: 5.8, max: 6.6, step: 0.01, default: 6.5, unit: 'mm', group: 'base', advanced: true, randomize: false, visibleWhen: magneticLight, help: '6.5 mm is a glue-clearance starting point for nominal 6 mm magnets. Tune a 1 × 1 sample for your printer; the 6.09 mm tight-fit design is not a guaranteed press fit.' },
    light_through_holes: { type: 'bool', label: 'Through-holes below magnets', default: true, group: 'base', advanced: true, randomize: false, visibleWhen: magneticLight, help: 'Small bores through the pocket floors allow magnet removal or screw fastening. Turn off for closed-bottom glue pockets.' },
    light_through_diameter_mm: { type: 'number', label: 'Through-hole diameter', min: 2.8, max: 3.6, step: 0.1, default: 3, unit: 'mm', group: 'base', advanced: true, randomize: false, visibleWhen: { style: 'magnetic-light', light_through_holes: true }, help: 'Check screw head clearance before fastening. No screw or magnet fit has been physically certified.' },
    clearance_mm: { type: 'number', label: 'Socket clearance per side', min: 0.15, max: 0.4, step: 0.05, default: 0.25, unit: 'mm', group: 'base', advanced: true, randomize: false, help: 'Print a 1 × 1 fit sample first. Physical fit depends on your printer; no sample fit is certified.' },
    magnet_diameter_mm: { type: 'number', label: 'Magnet pocket diameter', min: 6, max: 6.4, step: 0.1, default: 6.2, unit: 'mm', group: 'base', advanced: true, randomize: false, visibleWhen: { style: 'magnetic' }, help: 'For nominal 6 mm magnets. Allow glue clearance; test your magnets before printing a full base.' },
    magnet_depth_mm: { type: 'number', label: 'Magnet pocket depth', min: 2, max: 2.4, step: 0.1, default: 2.2, unit: 'mm', group: 'base', advanced: true, randomize: false, visibleWhen: { style: ['magnetic', 'magnetic-light'] }, help: 'Solid base: at least 0.8 mm above the downward pocket. Light base: at least 0.4 mm below the upward pocket; thicker bases are stiffer.' },
    color: { type: 'color', label: 'Base color', default: '#527c70', group: 'colors' }
  },
  rules, presets,
  designs: Object.entries(presets).map(([id, params]) => ({ id, label: { standard: 'Standard grid', sample: 'Fit sample', light: 'Less material', magnetic: 'Magnetic base', 'magnetic-light': 'Magnetic light', 'magnetic-sample': 'Magnetic fit sample', 'magnetic-tight': 'Tight magnet sample' }[id], blurb: { standard: 'Open sockets with full-height mating rails; no magnets needed.', sample: 'One cell to check your printer and mating fit before a full grid.', light: 'An open lattice with thinner lower rails and full mating height.', magnetic: 'Solid subfloor with glue-in magnet pockets.', 'magnetic-light': 'Open cells, rounded corner tabs, top-open magnet pockets and small through-holes.', 'magnetic-sample': 'One magnetic light cell to tune thickness, opening size and magnet fit.', 'magnetic-tight': 'One magnetic light cell with 6.09 mm pockets. Test before using as a press fit.' }[id], params })),
  defaultDesign: 'standard'
};

