import { footSection } from '../../../public/assets/js/customize/gridfinity.js';

// Same angular samples at every station: hulls connect corresponding arc points
// without scaling the straight segments of the rounded square.
function sectionPoints(z, clearance) {
  const section = footSection(z);
  const width = section.width + 2 * clearance;
  const radius = section.radius + clearance;
  const c = width / 2 - radius;
  const points = [];
  for (let corner = 0; corner < 4; corner++) {
    const cx = corner === 0 || corner === 3 ? c : -c;
    const cy = corner < 2 ? c : -c;
    for (let step = 0; step <= 12; step++) {
      const a = (corner * 90 + step * 7.5) * Math.PI / 180;
      points.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a), z]);
    }
  }
  return points;
}

export function gridFoot({ Manifold }, clearance = 0) {
  if (!Number.isFinite(clearance) || clearance < 0 || clearance > 0.4) throw new RangeError('Invalid socket clearance.');
  const stations = [0, 0.8, 2.6, 4.75].map(z => sectionPoints(z, clearance));
  const segments = [];
  try {
    for (let i = 0; i < stations.length - 1; i++) {
      segments.push(Manifold.hull([...stations[i], ...stations[i + 1]]));
    }
    return Manifold.union(segments);
  } finally { segments.forEach(s => s.delete()); }
}

// Convex rounded-rectangle stations joined by straight ramps. Stations may
// shrink and expand; keeping separate segments preserves the mating waist.
export function roundedLoft({ Manifold }, stations) {
  const rings = stations.map(({ z, width, depth, radius }) => {
    const points = [];
    for (let corner = 0; corner < 4; corner++) {
      const cx = (corner === 0 || corner === 3 ? 1 : -1) * (width / 2 - radius);
      const cy = (corner < 2 ? 1 : -1) * (depth / 2 - radius);
      for (let step = 0; step <= 12; step++) {
        const a = (corner * 90 + step * 7.5) * Math.PI / 180;
        points.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a), z]);
      }
    }
    return points;
  });
  const segments = [];
  try {
    for (let i = 0; i < rings.length - 1; i++) segments.push(Manifold.hull([...rings[i], ...rings[i + 1]]));
    return Manifold.union(segments);
  } finally { segments.forEach(s => s.delete()); }
}
