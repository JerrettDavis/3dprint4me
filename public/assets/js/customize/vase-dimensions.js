import { compileVaseField } from './vase-field.js?v=6c6c04bbfe128f84';
import { validateVaseProfile, VASE_PROFILE_LIMITS } from './vase-shape.js?v=6c6c04bbfe128f84';

const TAU = 2 * Math.PI;
function dimension(settings, key, min, max) {
  const value = settings[key];
  if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`Vase ${key} must be from ${min} to ${max} mm.`);
  return value;
}

// One sampling contract for print geometry and physical endpoint controls. The
// returned diameters are centered envelope diameters, including every modifier.
export function sampleVaseEnvelope(settings) {
  const height = dimension(settings, 'height_mm', 30, 250);
  const diameter = dimension(settings, 'diameter_mm', 30, 220);
  const sample = compileVaseField(settings);
  const harmonic = settings.pattern === 'fractal' ? 4 : ['cells', 'dune'].includes(settings.pattern) ? 2 : 1;
  const texture = settings.pattern !== 'smooth' && settings.relief > 0;
  const angularCycles = Math.max(settings.lobes, settings.organic ? 7 : 0, texture ? harmonic * settings.frequency : 0);
  const verticalCycles = (texture ? harmonic * settings.vertical_frequency : 0)
    + Math.max(angularCycles, settings.facets) * Math.abs(settings.twist_deg) / 360;
  let segments = Math.max(64, Math.ceil(angularCycles * 12));
  if (settings.facets) segments = Math.ceil(segments / (settings.facets * 2)) * settings.facets * 2;
  const rows = Math.max(32, Math.ceil(verticalCycles * 12));
  if (segments > 1024 || rows > 512 || segments * (rows + settings.profile.length + 3) > 80000) {
    throw new RangeError('This vase needs too much geometry. Reduce pattern frequency, twist, or lobes.');
  }
  const heights = [...new Set([...Array.from({ length: rows + 1 }, (_, i) => i / rows), ...settings.profile.map(point => point.height)])].sort((a, b) => a - b);
  let maximum = 0;
  const rings = heights.map(t => {
    const fade = Math.min(1, t / 0.08);
    const rotation = settings.twist_deg * Math.PI / 180 * t * fade * fade * (3 - 2 * fade);
    const offset = settings.facets ? Math.PI / settings.facets - rotation : 0;
    const angles = Array.from({ length: segments }, (_, i) => i * TAU / segments + offset);
    const radii = angles.map(angle => sample(t, angle));
    for (const radius of radii) maximum = Math.max(maximum, radius);
    return { z: t * height, radii, angles };
  });
  const scale = diameter / (2 * maximum);
  for (const ring of rings) ring.radii = ring.radii.map(radius => radius * scale);
  return { rings, segments, height, diameter,
    baseDiameterMm: 2 * Math.max(...rings[0].radii),
    mouthDiameterMm: 2 * Math.max(...rings.at(-1).radii) };
}

export function measureVaseDimensions(settings) {
  const { baseDiameterMm, mouthDiameterMm } = sampleVaseEnvelope(settings);
  return { baseDiameterMm, mouthDiameterMm };
}

export function setVaseEndpointDiameter(settings, endpoint, requestedMm) {
  if (!['base', 'mouth'].includes(endpoint) || !Number.isFinite(requestedMm)) throw new RangeError('Choose a finite base or mouth diameter.');
  const original = validateVaseProfile(settings.profile), index = endpoint === 'base' ? 0 : original.length - 1;
  const metric = endpoint === 'base' ? 'baseDiameterMm' : 'mouthDiameterMm';
  const at = radius => {
    const profile = original.map(point => ({ ...point }));
    profile[index].radius = radius;
    return { profile, diameterMm: measureVaseDimensions({ ...settings, profile })[metric] };
  };
  let low = VASE_PROFILE_LIMITS.minRadius, high = VASE_PROFILE_LIMITS.maxRadius;
  const minimum = at(low), maximum = at(high);
  const minimumMm = minimum.diameterMm, maximumMm = maximum.diameterMm;
  const target = Math.max(minimumMm, Math.min(maximumMm, requestedMm));
  let best = Math.abs(minimumMm - target) < Math.abs(maximumMm - target) ? minimum : maximum;
  let radius = Math.max(low, Math.min(high, original[index].radius * target / measureVaseDimensions(settings)[metric]));
  for (let i = 0; i < 18; i++) {
    const result = at(radius);
    if (Math.abs(result.diameterMm - target) < Math.abs(best.diameterMm - target)) best = result;
    if (Math.abs(best.diameterMm - target) < 0.01) break;
    if (result.diameterMm < target) low = radius; else high = radius;
    radius = (low + high) / 2;
  }
  return { ...best, minimumMm, maximumMm, clamped: Math.abs(requestedMm - target) > 0.01 };
}
