// Shared mechanical policy only; no browser APIs or geometry-engine allocation.
// Dimensions are millimetres. This is a double-pivot link, not a fused hinge.
export function hingeDimensions({ blockSize = 20, thickness = 6.6, clearance = 0.3 } = {}) {
  for (const [key, value, min, max] of [
    ['blockSize', blockSize, 12, 40],
    ['thickness', thickness, 4, 10],
    ['clearance', clearance, 0.2, 0.5]
  ]) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      throw new RangeError(`${key} must be between ${min} and ${max} mm.`);
    }
  }
  const barrelRadius = thickness / 2;
  const pinRadius = Math.max(1.2, barrelRadius * 2 / 3);
  const linkWidth = thickness;
  const pinLength = linkWidth + 2 * (clearance + 1.2);
  const pivotSpacing = blockSize * 0.37;
  const wall = 1.2;
  // Keep a real cheek around each blind socket; preserve room for both pivot ends.
  if (pinLength + 2 * (clearance + wall) > blockSize || pivotSpacing < thickness) {
    throw new RangeError('Connector thickness and clearance need a larger block size.');
  }
  return Object.freeze({ blockSize, thickness, clearance, barrelRadius, pinRadius, linkWidth, pinLength, pivotSpacing, wall });
}
