import { importedEligibility } from '../spoolman/domain.js';
import { HttpError } from '../http.js';
import { colorDifference, parseColor } from './color.js';

export const DEFAULT_MATCHING_SETTINGS = Object.freeze({ mode: 'hsl', hueClockwise: 45, hueCounterclockwise: 45, saturation: 35, lightness: 35, red: 80, green: 80, blue: 80, closePercent: 25, stepPercent: 25, stockBufferGrams: 10, materialRules: [] });
export const exactFields = (input, fields) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'An object is required.');
  if (Object.keys(input).some(key => !fields.includes(key))) throw new HttpError(400, 'Unexpected field.');
};
export const materialKey = value => String(value ?? '').trim().toLowerCase();
export function normalizeMatchingSettings(input = {}) {
  exactFields(input, Object.keys(DEFAULT_MATCHING_SETTINGS));
  const result = { ...DEFAULT_MATCHING_SETTINGS, ...input };
  if (!['hsl', 'rgb', 'both'].includes(result.mode)) throw new HttpError(400, 'Choose HSL, RGB, or both.');
  for (const [key, max] of Object.entries({ hueClockwise: 180, hueCounterclockwise: 180, saturation: 100, lightness: 100, red: 255, green: 255, blue: 255, closePercent: 100, stepPercent: 100, stockBufferGrams: 100000 })) {
    const v = result[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < (key.endsWith('Percent') ? 1 : 0) || v > max) throw new HttpError(400, `Invalid ${key} threshold.`);
  }
  if (!Array.isArray(result.materialRules) || result.materialRules.length > 50) throw new HttpError(400, 'At most 50 material rules are allowed.');
  result.materialRules = result.materialRules.map(rule => {
    exactFields(rule, ['from', 'to']);
    const from = materialKey(rule.from), to = materialKey(rule.to);
    if (![from, to].every(v => /^[a-z0-9-]{2,40}$/.test(v)) || from === to) throw new HttpError(400, 'Material rules require two different material keys.');
    return { from, to };
  });
  return result;
}

export function matchRequirement(requirement, inventory, settings = DEFAULT_MATCHING_SETTINGS, context = {}) {
  const material = materialKey(requirement.material), requested = parseColor(requirement.colorHex || requirement.color);
  const warnings = [];
  const base = { requirement, recommendedId: null, candidates: [], furtherCandidates: [], band: null, warnings };
  if (!material || !requested || material === 'other') return { ...base, status: 'review', warnings: ['Specify the requested material and a known color or hex value.'] };
  const options = [];
  let unknown = false;
  for (const row of inventory) {
    const sameMaterial = materialKey(row.material) === material;
    if (!row.active) continue;
    if (row.source && !row.source.materialKnown) { unknown = true; warnings.push('Spoolman material needs mapping.'); continue; }
    if (!sameMaterial && !settings.materialRules.some(rule => rule.from === material && rule.to === materialKey(row.material))) continue;
    const eligibility = importedEligibility(row, context);
    if (!eligibility.eligible) { unknown = true; warnings.push(...eligibility.reasons); continue; }
    if (row.onHandGrams <= 0) continue;
    const differences = colorDifference(requested.hex, row.colorHex || row.color, settings);
    if (differences.review) unknown = true;
    if (!differences.eligible) continue;
    options.push({ id: row.id, material: row.material, brandLine: row.brandLine ?? null, color: row.color ?? null, colorHex: parseColor(row.colorHex || row.color)?.hex, onHandGrams: row.onHandGrams, inventoryRevision: row.revision ?? 1, substitution: !sameMaterial || !differences.exact, differences, sufficient: requirement.grams == null ? null : row.onHandGrams >= requirement.grams + settings.stockBufferGrams });
  }
  const sort = (a, b) => Number(a.material !== material) - Number(b.material !== material) || a.differences.distance - b.differences.distance || Number(b.sufficient) - Number(a.sufficient) || a.id.localeCompare(b.id);
  options.sort(sort);
  if (!options.length) return { ...base, status: unknown ? 'review' : 'purchase', warnings: [...new Set([...warnings, unknown ? 'Some stocked colors or source data need review.' : 'No stocked filament is inside the material and color limits.'])] };
  let band = settings.closePercent;
  while (band < 100 && !options.some(row => row.differences.fraction <= band / 100 + 1e-8)) band = Math.min(100, band + settings.stepPercent);
  const candidates = options.filter(row => row.differences.fraction <= band / 100 + 1e-8), furtherCandidates = options.filter(row => !candidates.includes(row));
  const best = candidates[0];
  if (requirement.brandLine && best.brandLine?.toLowerCase() !== requirement.brandLine.toLowerCase()) warnings.push('Requested brand/line needs review.');
  if (best.sufficient === null) warnings.push('Required grams are unknown; stock sufficiency is unverified.');
  if (best.sufficient === false) warnings.push('Purchase needed: available grams do not cover demand and buffer.');
  return { ...base, candidates, furtherCandidates, recommendedId: best.id, band, status: best.sufficient === false ? 'purchase' : best.sufficient === null || warnings.length ? 'review' : best.substitution ? 'substitution' : 'ready' };
}

export function matchWorkRequirements(requirements, inventory, settings, selections = {}, context = {}) {
  const remaining = inventory.map(row => ({ ...row }));
  const results = requirements.map(requirement => {
    const result = matchRequirement(requirement, remaining, settings, context);
    result.selectedId = selections[requirement.id] ?? result.recommendedId;
    const chosen = [...result.candidates, ...result.furtherCandidates].find(row => row.id === result.selectedId);
    const selectedStock = remaining.find(row => row.id === result.selectedId);
    result.selectedOnHandGrams = selectedStock?.onHandGrams ?? null;
    if (selections[requirement.id]) {
      if (!chosen) { result.status = 'review'; result.warnings.push('The selected option is no longer an eligible stocked match.'); }
      else if (chosen.sufficient === false) result.status = 'purchase';
      else if (chosen.sufficient === null || requirement.brandLine && chosen.brandLine?.toLowerCase() !== requirement.brandLine.toLowerCase()) result.status = 'review';
      else result.status = chosen.substitution ? 'substitution' : 'ready';
    }
    if (selectedStock && requirement.grams != null) {
      const stock = selectedStock;
      stock.onHandGrams = Math.max(0, stock.onHandGrams - requirement.grams - settings.stockBufferGrams);
    }
    return result;
  });
  return { requirements: results, alerts: [...new Set(results.filter(row => row.status !== 'ready').map(row => row.status))] };
}
