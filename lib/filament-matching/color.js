// Local sRGB/D65 color math. CIE76 ranks candidates; channel limits decide eligibility.
const NAMES = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', orange: '#ffa500', purple: '#800080', pink: '#ffc0cb', teal: '#008080', gray: '#808080', grey: '#808080', navy: '#000080', cyan: '#00ffff', brown: '#a52a2a', magenta: '#ff00ff' };
export function parseColor(value) {
  let hex = String(value ?? '').trim().toLowerCase();
  hex = NAMES[hex] ?? hex;
  if (/^#[\da-f]{3}$/.test(hex)) hex = '#' + [...hex.slice(1)].map(c => c + c).join('');
  if (!/^#[\da-f]{6}$/.test(hex)) return null;
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const [r, g, b] = rgb.map(v => v / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  let h = 0;
  if (d) h = ((max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60);
  const hsl = [h, d ? d / (1 - Math.abs(2 * l - 1)) * 100 : 0, l * 100];
  const [lr, lg, lb] = [r, g, b].map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const f = v => v > 216 / 24389 ? Math.cbrt(v) : (24389 / 27 * v + 16) / 116;
  const x = f((0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047);
  const y = f(0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb);
  const z = f((0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883);
  return { hex, rgb, hsl, lab: [116 * y - 16, 500 * (x - y), 200 * (y - z)] };
}
const ratio = (difference, limit) => limit === 0 ? (difference < 1e-8 ? 0 : Infinity) : difference / limit;
export function colorDifference(original, offered, settings) {
  const a = parseColor(original), b = parseColor(offered);
  if (!a || !b) return { eligible: false, review: true, distance: null, fraction: null };
  const rgb = a.rgb.map((v, i) => Math.abs(v - b.rgb[i]));
  let hue = ((b.hsl[0] - a.hsl[0] + 540) % 360) - 180;
  if (Math.abs(hue + 180) < 1e-8 && settings.hueClockwise >= settings.hueCounterclockwise) hue = 180;
  const saturation = Math.abs(a.hsl[1] - b.hsl[1]), lightness = Math.abs(a.hsl[2] - b.hsl[2]);
  const neutral = a.hsl[1] < 5 || b.hsl[1] < 5;
  const exact = a.hex === b.hex;
  const hslFraction = Math.max(ratio(Math.abs(hue), hue >= 0 ? settings.hueClockwise : settings.hueCounterclockwise), ratio(saturation, settings.saturation), ratio(lightness, settings.lightness));
  const rgbFraction = Math.max(...rgb.map((v, i) => ratio(v, settings[['red', 'green', 'blue'][i]])));
  // Hue is undefined near the neutral axis. Both-mode omits hue alone, retaining S/L and RGB limits.
  const review = !exact && neutral && settings.mode === 'hsl';
  const neutralHslFraction = Math.max(ratio(saturation, settings.saturation), ratio(lightness, settings.lightness));
  const fraction = exact ? 0 : settings.mode === 'rgb' ? rgbFraction : settings.mode === 'both' ? Math.max(neutral ? neutralHslFraction : hslFraction, rgbFraction) : hslFraction;
  return { eligible: !review && fraction <= 1 + 1e-8, review, exact, fraction: Number.isFinite(fraction) ? fraction : null, distance: Math.hypot(...a.lab.map((v, i) => v - b.lab[i])), hue, saturation, lightness, rgb };
}
