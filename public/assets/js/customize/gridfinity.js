// Dimensional profile adapted from Gridfinity Rebuilt (MIT), Kenneth Hodson and
// Zachary Freedman. Full notices: /customize/licenses/gridfinity.txt.
// Pure data/math shared by browser definitions, server validation and builders.
export const GRIDFINITY = Object.freeze({
  pitch: 42, gap: 0.5, heightUnit: 7, footHeight: 4.75,
  footWidth: 41.5, footRadius: 3.75, maxCellsPerAxis: 6,
  magnetOffset: 13, magnetDiameter: 6, magnetDepth: 2
});

function checkCount(n) {
  if (!Number.isInteger(n) || n < 1 || n > GRIDFINITY.maxCellsPerAxis) {
    throw new RangeError('Choose 1–6 whole Gridfinity cells per axis.');
  }
}

export function footprint(columns, rows) {
  checkCount(columns); checkCount(rows);
  return { width: columns * GRIDFINITY.pitch - GRIDFINITY.gap, depth: rows * GRIDFINITY.pitch - GRIDFINITY.gap };
}

// Future occupancy editing can filter this list without changing the grid origin.
export function cellCenters(columns, rows) {
  checkCount(columns); checkCount(rows);
  return Array.from({ length: rows * columns }, (_, i) => [
    (i % columns - (columns - 1) / 2) * GRIDFINITY.pitch,
    (Math.floor(i / columns) - (rows - 1) / 2) * GRIDFINITY.pitch
  ]);
}

export function footSection(z) {
  if (!Number.isFinite(z) || z < 0 || z > GRIDFINITY.footHeight) {
    throw new RangeError('Foot section must lie between 0 and 4.75 mm.');
  }
  const inset = z < 0.8 ? 2.95 - z : z <= 2.6 ? 2.15 : 4.75 - z;
  return { width: GRIDFINITY.footWidth - 2 * inset, radius: GRIDFINITY.footRadius - inset };
}
