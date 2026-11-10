// Pure geometry-domain helpers shared by the browser worker and server validation.
export const VASE_PROFILE_LIMITS = Object.freeze({
  minPoints: 3, maxPoints: 12, minSeparation: 0.02, minRadius: 0.05, maxRadius: 1,
});

export function validateVaseProfile(points) {
  const limits = VASE_PROFILE_LIMITS;
  if (!Array.isArray(points) || points.length < limits.minPoints || points.length > limits.maxPoints) {
    throw new RangeError('Vase profile needs 3 to 12 points.');
  }
  const result = Array.from(points, (point, index) => {
    if (!point || typeof point !== 'object' || Array.isArray(point)
      || !Number.isFinite(point.height) || !Number.isFinite(point.radius)
      || point.height < 0 || point.height > 1
      || point.radius < limits.minRadius || point.radius > limits.maxRadius) {
      throw new RangeError('Vase profile points need finite normalized heights and radii from 0.05 to 1.');
    }
    if (index > 0 && point.height - points[index - 1].height < limits.minSeparation - 1e-12) {
      throw new RangeError('Vase profile points must be ordered and at least 0.02 apart in height.');
    }
    return { height: point.height, radius: point.radius };
  });
  if (result[0].height !== 0 || result.at(-1).height !== 1) {
    throw new RangeError('Vase profile must start at height 0 and end at height 1.');
  }
  return result;
}

// Fritsch–Butland weighted harmonic slopes keep every interval within its endpoint
// radii while retaining a continuous first derivative (unlike piecewise linear editing).
function profileSlopes(points) {
  const widths = [], secants = [];
  for (let i = 0; i < points.length - 1; i++) {
    widths.push(points[i + 1].height - points[i].height);
    secants.push((points[i + 1].radius - points[i].radius) / widths[i]);
  }
  const slopes = new Array(points.length).fill(0);
  for (let i = 1; i < points.length - 1; i++) {
    if (secants[i - 1] * secants[i] <= 0) continue;
    const a = 2 * widths[i] + widths[i - 1];
    const b = widths[i] + 2 * widths[i - 1];
    slopes[i] = (a + b) / (a / secants[i - 1] + b / secants[i]);
  }
  const endpoint = (h0, h1, d0, d1) => {
    const slope = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
    if (slope * d0 <= 0) return 0;
    if (d0 * d1 <= 0 && Math.abs(slope) > Math.abs(3 * d0)) return 3 * d0;
    return slope;
  };
  slopes[0] = endpoint(widths[0], widths[1], secants[0], secants[1]);
  slopes[slopes.length - 1] = endpoint(widths.at(-1), widths.at(-2), secants.at(-1), secants.at(-2));
  return slopes;
}

export function compileVaseProfile(input) {
  const points = validateVaseProfile(input);
  const slopes = profileSlopes(points);
  return height => {
    if (!Number.isFinite(height)) throw new RangeError('Vase sample height must be finite.');
    if (height <= 0) return points[0].radius;
    if (height >= 1) return points.at(-1).radius;
    let index = 0;
    while (points[index + 1].height < height) index++;
    const a = points[index], b = points[index + 1];
    const width = b.height - a.height;
    const t = (height - a.height) / width;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * a.radius
      + (t3 - 2 * t2 + t) * width * slopes[index]
      + (-2 * t3 + 3 * t2) * b.radius
      + (t3 - t2) * width * slopes[index + 1];
  };
}

export function sampleVaseProfile(input, height) {
  return compileVaseProfile(input)(height);
}
