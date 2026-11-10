// Original double-pivot connector primitive. Local X joins two pivots, Y is the
// pin axis, Z is vertical. The caller places these tools and cuts the body sockets.
// Ownership: connector/socket survive until dispose(); all other temporaries are freed.
export function buildHingeTools(wasm, h) {
  const { Manifold } = wasm;
  const temps = [];
  const t = s => { temps.push(s); return s; };
  const kept = [];
  const cylinder = (radius, length, x) => t(t(Manifold.cylinder(length, radius, radius, 64, true))
    .rotate([90, 0, 0])).translate([x, 0, 0]);
  const capsule = (radius, width) => {
    const cylinders = [-1, 1].map(sign => t(cylinder(radius, width, sign * h.pivotSpacing / 2)));
    const bridge = t(Manifold.cube([h.pivotSpacing, width, radius * 2], true));
    return t(Manifold.union([...cylinders, bridge]));
  };
  try {
    const link = capsule(h.barrelRadius, h.linkWidth);
    const pins = [-1, 1].map(sign => t(cylinder(h.pinRadius, h.pinLength, sign * h.pivotSpacing / 2)));
    const connector = Manifold.union([link, ...pins]);
    kept.push(connector);
    const channel = capsule(h.barrelRadius + h.clearance, h.linkWidth + 2 * h.clearance);
    const bores = [-1, 1].map(sign => t(cylinder(h.pinRadius + h.clearance, h.pinLength + 2 * h.clearance, sign * h.pivotSpacing / 2)));
    const socket = Manifold.union([channel, ...bores]);
    kept.push(socket);
    let disposed = false;
    return { connector, socket, dispose() {
      if (disposed) return;
      disposed = true;
      kept.forEach(s => s.delete());
    } };
  } catch (error) {
    kept.forEach(s => s.delete());
    throw error;
  } finally {
    temps.reverse().forEach(s => s.delete());
  }
}

// Sweep in the pin-normal plane, then extrude. This avoids hundreds of expensive
// 3D booleans while preserving the different widths of the bridge and pin ends.
export function buildSocketSweep(wasm, h, side) {
  if (side !== -1 && side !== 1) throw new RangeError('A hinge side must be -1 or 1.');
  const { CrossSection, Manifold } = wasm;
  const temps = [];
  const t = s => { temps.push(s); return s; };
  try {
    const pivot = side * h.pivotSpacing / 2;
    const distance = h.pivotSpacing;
    const steps = 64;
    const start = side < 0 ? 0 : Math.PI;
    const arc = radius => Array.from({ length: steps + 1 }, (_, i) => {
      const angle = start + side * Math.PI / 2 * i / steps;
      return [radius * Math.cos(angle), radius * Math.sin(angle)];
    });
    // Analytic quarter-sector + disk is the sweep of the capsule. A 0.01 mm
    // envelope allowance exceeds arc/facet sagitta at every bounded dimension.
    const radius = h.barrelRadius + h.clearance + 0.01;
    const sector = t(CrossSection.ofPolygons([[[0, 0], ...arc(distance)]], 'EvenOdd'));
    const main = t(sector.offset(radius, 'Round', 2, 64));
    const pinRadius = h.pinRadius + h.clearance + 0.01;
    const annulus = t(CrossSection.ofPolygons([[...arc(distance + pinRadius), ...arc(distance - pinRadius).reverse()]], 'EvenOdd'));
    const caps = [arc(distance)[0], arc(distance).at(-1), [0, 0]].map(at => t(t(CrossSection.circle(pinRadius, 64)).translate(at)));
    const pins = t(CrossSection.union([annulus, ...caps]));
    const extrude = (section, width) => {
      const profile = t(section.translate([pivot, 0]));
      return t(t(t(profile.extrude(width)).translate([0, 0, -width / 2])).rotate([90, 0, 0]));
    };
    const channel = extrude(main, h.linkWidth + 2 * h.clearance);
    const bores = extrude(pins, h.pinLength + 2 * h.clearance);
    return Manifold.union([channel, bores]);
  } finally { temps.reverse().forEach(s => s.delete()); }
}
