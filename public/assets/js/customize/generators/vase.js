import { VASE_PATTERNS } from '../vase-field.js?v=89c1ce1c55a77d71';

const urn = [
  { height: 0, radius: 0.62 }, { height: 0.18, radius: 0.88 },
  { height: 0.48, radius: 1 }, { height: 0.78, radius: 0.7 }, { height: 1, radius: 0.55 },
];
const tapered = [{ height: 0, radius: 0.75 }, { height: 0.5, radius: 0.875 }, { height: 1, radius: 1 }];
const presetShapes = {
  dune: { pattern: 'dune', relief: 0.12, frequency: 5, vertical_frequency: 2, twist_deg: 45, organic: 0.03 },
  classic: { pattern: 'smooth', profile: urn, height_mm: 180, diameter_mm: 100 },
  blossom: { pattern: 'smooth', lobes: 7, lobe_depth: 0.18, twist_deg: 45, profile: tapered },
  ripple: { pattern: 'ripple', relief: 0.1, frequency: 8, vertical_frequency: 3, profile: tapered },
  'faceted-planter': { construction: 'hollow', pattern: 'smooth', facets: 6, profile: tapered, height_mm: 90, diameter_mm: 110 },
  rose: { pattern: 'smooth', facets: 7, lobes: 7, lobe_depth: 0.12, twist_deg: 60, height_mm: 140 },
  scales: { pattern: 'scales', relief: 0.12, frequency: 8, vertical_frequency: 6, profile: tapered },
  cells: { pattern: 'cells', relief: 0.1, frequency: 6, vertical_frequency: 4, profile: tapered },
  crystal: { pattern: 'zigzag', facets: 8, relief: 0.07, frequency: 8, vertical_frequency: 3, twist_deg: 45 },
  fractal: { pattern: 'fractal', relief: 0.12, frequency: 2, vertical_frequency: 2, organic: 0.06, twist_deg: 30 },
};
const presets = Object.fromEntries(Object.entries(presetShapes).map(([id, params]) => [id, {
  profile: urn, pattern: 'smooth', relief: 0.1, frequency: 6, vertical_frequency: 4,
  facets: 0, twist_deg: 0, lobes: 0, lobe_depth: 0.12, organic: 0, ...params,
}]));
const labels = {
  dune: 'Wind-shaped dunes', classic: 'Classic urn', blossom: 'Blossom', ripple: 'Twisted ripple',
  'faceted-planter': 'Hollow faceted planter', rose: 'Faceted rose', scales: 'Layered scales',
  cells: 'Cell relief', crystal: 'Zigzag crystal', fractal: 'Organic multiscale',
};
const surfaceLabels = { smooth: 'Smooth', ripple: 'Ripple', dune: 'Dune', scales: 'Scales', cells: 'Cells', zigzag: 'Zigzag', fractal: 'Multiscale / fractal' };
const hollow = { construction: 'hollow' };
const randomizeSurface = p => p.construction === 'solid';
const textured = p => p.pattern !== 'smooth';

export default {
  id: 'vase', version: 1, title: 'Algorithmic vase',
  blurb: 'Shape an editable spline profile, then add dunes, ripples, facets, scales or organic relief. Export modeled walls or a solid for slicer vase mode.',
  category: 'home', origin: 'house', initialView: '3d',
  interruptBuilds: true,
  openDesigns: false,
  rights: { publishable: true, note: 'Original procedural geometry by 3dprint4.me. Presets describe independent mathematical forms; no reference model geometry is included.' },
  schema: {
    profile: { type: 'profile', label: 'Vase profile', default: urn, group: 'profile', randomize: false, physicalDimensions: true, help: 'Move the points or edit their height/radius percentages. The curve stays within neighboring radii. Add up to 12 points; endpoint heights remain fixed.' },
    construction: { type: 'enum', label: 'Print construction', group: 'print', default: 'solid', randomize: false, options: [
      { value: 'solid', label: 'Solid · slicer vase mode' }, { value: 'hollow', label: 'Hollow · modeled walls' },
    ], help: 'Solid output needs spiral/vase mode in the slicer. Hollow output has an open mouth and modeled walls/base; print it normally. Inspect the actual sliced layers.' },
    height_mm: { type: 'number', label: 'Height', min: 30, max: 250, step: 1, default: 155, unit: 'mm', group: 'size' },
    diameter_mm: { type: 'number', label: 'Maximum diameter', min: 30, max: 220, step: 1, default: 95, unit: 'mm', group: 'size', help: 'The complete deformed envelope is scaled to this diameter. Check your printer bed.' },
    facets: { type: 'int', label: 'Polygon sides', min: 0, max: 32, step: 1, default: 0, group: 'form', help: '0 gives a circular section; choose at least 3 for planar polygon sides.' },
    poly_density: { type: 'int', label: 'Poly density', min: 0, max: 100, step: 1, default: 50, randomize: false, group: 'form', help: '0 = very low poly, 50 = standard, 100 = smooth. Changes the actual mesh around and up the vase, including downloads. Higher density takes longer. Polygon sides still controls intentional corners.' },
    twist_deg: { randomizeWhen: randomizeSurface, type: 'number', label: 'Twist from base to mouth', min: -360, max: 360, step: 1, default: 45, unit: 'degrees', group: 'form' },
    lobes: { randomizeWhen: randomizeSurface, type: 'int', label: 'Lobes / petals', min: 0, max: 16, step: 1, default: 0, group: 'form' },
    lobe_depth: { randomizeWhen: randomizeSurface, type: 'number', label: 'Lobe depth', min: 0, max: 0.3, step: 0.01, default: 0.12, group: 'form', visibleWhen: p => p.lobes > 0, help: 'Fraction of the local radius. Deep lobes can produce steep overhangs.' },
    organic: { randomizeWhen: randomizeSurface, type: 'number', label: 'Organic displacement', min: 0, max: 0.2, step: 0.01, default: 0.03, group: 'surface', help: 'Seeded smooth variation, blended away at the flat base.' },
    pattern: { randomizeWhen: randomizeSurface, type: 'enum', label: 'Surface algorithm', default: 'dune', group: 'surface', options: VASE_PATTERNS.map(value => ({ value, label: surfaceLabels[value] })) },
    relief: { randomizeWhen: randomizeSurface, type: 'number', label: 'Surface relief', min: 0, max: 0.3, step: 0.01, default: 0.12, group: 'surface', visibleWhen: textured, help: 'Fraction of the local radius, before final diameter scaling.' },
    frequency: { randomizeWhen: randomizeSurface, type: 'int', label: 'Repeats around vase', min: 1, max: 24, step: 1, default: 5, group: 'surface', visibleWhen: textured },
    vertical_frequency: { randomizeWhen: randomizeSurface, type: 'int', label: 'Repeats up vase', min: 1, max: 24, step: 1, default: 2, group: 'surface', visibleWhen: textured },
    seed: { randomizeWhen: randomizeSurface, type: 'int', label: 'Pattern seed', min: 0, max: 65535, step: 1, default: 123, group: 'surface', help: 'The same settings and seed reproduce the same organic and multiscale pattern.' },
    wall_mm: { type: 'number', label: 'Minimum wall thickness', min: 0.8, max: 4, step: 0.1, default: 1.2, unit: 'mm', group: 'print', visibleWhen: hollow, help: 'A geometric minimum; curved and textured walls may be thicker. Narrow cavities are rejected.' },
    base_mm: { type: 'number', label: 'Closed base thickness', min: 0.8, max: 6, step: 0.1, default: 2.4, unit: 'mm', group: 'print', visibleWhen: hollow },
    color: { type: 'color', label: 'Vase color', default: '#b98a68', group: 'colors' },
  },
  rules(p) {
    const error = p.facets === 1 || p.facets === 2 ? 'Choose 0 for a circle, or at least 3 polygon sides.' : '';
    return { limits: {}, errors: error ? [error] : [], fieldErrors: error ? { facets: error } : {} };
  },
  presets,
  designs: Object.entries(presets).map(([id, params]) => ({ id, label: labels[id], blurb: id === 'faceted-planter'
    ? 'Open modeled walls and a closed floor. Print normally with vase mode off.'
    : 'Editable original procedural form. Solid output is intended for slicer vase mode.', params })),
  defaultDesign: 'dune',
};
