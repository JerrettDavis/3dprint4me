import { compileVaseProfile } from './vase-shape.js?v=7447d28f9171251a';

export const VASE_PATTERNS = Object.freeze(['smooth', 'ripple', 'dune', 'scales', 'cells', 'zigzag', 'fractal']);
const TAU = 2 * Math.PI;
const smoothstep = value => {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
};

function bounded(settings, key, min, max, integer = false) {
  const value = settings[key];
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new RangeError(`Vase ${key} must be ${integer ? 'a whole number ' : ''}from ${min} to ${max}.`);
  }
  return value;
}

function phasesFromSeed(seed) {
  let state = seed >>> 0;
  return Array.from({ length: 4 }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296 * TAU;
  });
}

function surface(pattern, angle, height, phase) {
  switch (pattern) {
    case 'smooth': return 0;
    case 'ripple': return Math.sin(angle + height);
    case 'dune': return (Math.sin(angle + 0.9 * Math.sin(height)) + 0.5 * Math.sin(2 * angle - height)) / 1.5;
    case 'scales': return Math.max(0, Math.cos(angle + 0.8 * Math.sin(height))) * (0.5 + 0.5 * Math.cos(height)) * 2 - 1;
    case 'cells': return (Math.cos(angle + height) + Math.cos(angle - height) + Math.cos(2 * height)) / 3;
    case 'zigzag': return Math.asin(Math.sin(angle + height)) * 2 / Math.PI;
    case 'fractal': return (Math.sin(angle + height + phase[0])
      + 0.5 * Math.sin(2 * angle - 2 * height + phase[1])
      + 0.25 * Math.sin(4 * angle + 4 * height + phase[2])) / 1.75;
    default: throw new RangeError('Unsupported vase surface pattern.');
  }
}

// Returns a dimensionless periodic radius field. The mesh builder normalizes the
// completed sampled envelope to the requested diameter, after every deformation.
// Profile coefficients and seed phases are prepared once per build, not per vertex.
export function compileVaseField(settings) {
  const sampleProfile = compileVaseProfile(settings?.profile);
  const facets = bounded(settings, 'facets', 0, 64, true);
  if (facets > 0 && facets < 3) throw new RangeError('Vase facets must be zero or at least 3.');
  const twist = bounded(settings, 'twist_deg', -360, 360) * Math.PI / 180;
  const lobes = bounded(settings, 'lobes', 0, 16, true);
  const depth = bounded(settings, 'lobe_depth', 0, 0.3);
  const relief = bounded(settings, 'relief', 0, 0.3);
  const organic = bounded(settings, 'organic', 0, 0.2);
  const frequency = bounded(settings, 'frequency', 1, 24, true);
  const vertical = bounded(settings, 'vertical_frequency', 1, 24, true);
  const phase = phasesFromSeed(bounded(settings, 'seed', 0, 65535, true));
  const pattern = settings.pattern;
  if (!VASE_PATTERNS.includes(pattern)) throw new RangeError('Unsupported vase surface pattern.');
  const sector = facets ? TAU / facets : 0;
  const apothem = facets ? Math.cos(Math.PI / facets) : 1;
  return (height, angle) => {
    const profile = sampleProfile(height);
    if (!Number.isFinite(angle)) throw new RangeError('Vase sample angle must be finite.');
    const t = Math.max(0, Math.min(1, height));
    const fade = smoothstep(t / 0.08);
    const theta = angle + twist * t * fade;
    const local = facets ? ((theta + sector / 2) % sector + sector) % sector - sector / 2 : 0;
    const polygon = facets ? apothem / Math.cos(local) : 1;
    const lobe = lobes ? depth * Math.cos(lobes * theta) : 0;
    const patternRadius = relief * surface(pattern, frequency * theta, TAU * vertical * t, phase);
    const noise = organic * (Math.sin(3 * theta + TAU * t + phase[0])
      + 0.5 * Math.sin(5 * theta - 2 * TAU * t + phase[1])
      + 0.25 * Math.sin(7 * theta + 3 * TAU * t + phase[2])) / 1.75;
    return profile * polygon * (1 + fade * lobe) * (1 + fade * patternRadius) * (1 + fade * noise);
  };
}
