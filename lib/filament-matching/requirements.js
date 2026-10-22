import { HttpError } from '../http.js';
import { getGenerator as registryGetGenerator } from '../../public/assets/js/customize/registry.js';
import { parseColor } from './color.js';
import { exactFields, materialKey } from './domain.js';

const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
export function normalizeRequirements(input) {
  if (!Array.isArray(input) || input.length > 32) throw new HttpError(400, 'Supply at most 32 filament requirements.');
  const ids = new Set();
  return input.map(row => {
    exactFields(row, ['id', 'label', 'material', 'color', 'colorHex', 'brandLine', 'grams']);
    const id = String(row.id ?? '');
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || ids.has(id)) throw new HttpError(400, 'Requirements need unique IDs.');
    ids.add(id);
    const material = materialKey(row.material);
    if (material && !/^[a-z0-9-]{2,40}$/.test(material)) throw new HttpError(400, 'Invalid material key.');
    if (row.colorHex && !/^#[\da-f]{6}$/i.test(row.colorHex) && !/^#[\da-f]{3}$/i.test(row.colorHex)) throw new HttpError(400, 'Color hex must use #RRGGBB.');
    if (row.grams != null && (typeof row.grams !== 'number' || !Number.isFinite(row.grams) || row.grams < 0 || row.grams > 10000000)) throw new HttpError(400, 'Invalid required grams.');
    return { id, label: clean(row.label || id, 120), material: material || null, color: clean(row.color, 80) || null, colorHex: parseColor(row.colorHex)?.hex ?? null, brandLine: clean(row.brandLine, 120) || null, grams: row.grams ?? null };
  });
}

export function requirementsForWork(detail, { override = null, estimate = null, getGenerator = registryGetGenerator } = {}) {
  const request = detail?.request ?? {}, spec = request.specifications ?? {};
  if (request.service !== 'print' && override === null) return { applicable: false, requirements: [], totalGrams: null, warnings: [] };
  const warnings = [];
  const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
  const totalGrams = positive(estimate?.production?.totalGrams) ?? (positive(spec.grams) ? positive(spec.grams) * (positive(spec.quantity) ?? 1) : null);
  if (override !== null) return { applicable: true, requirements: normalizeRequirements(override), totalGrams, warnings };
  const material = materialKey(spec.material) || null;
  const requirements = [];
  const customization = request.customization;
  if (customization) {
    const generator = getGenerator(customization.generatorId), params = customization.params ?? {};
    const excluded = new Set(customization.redacted ?? []);
    for (const [key, field] of Object.entries(generator?.schema ?? {})) {
      if (field.type !== 'color' || field.sensitive || excluded.has(key) || field.visibleWhen && !field.visibleWhen(params)) continue;
      const color = parseColor(params[key]);
      requirements.push({ id: `generator_${key}`, label: field.label || key, material, color: color?.hex ?? null, colorHex: color?.hex ?? null, grams: null });
    }
  }
  if (!requirements.length) {
    const raw = spec.colorHex || spec.color || spec.colorName || (typeof spec.colors === 'string' && !/^\s*\d+\s*$/.test(spec.colors) ? spec.colors : '');
    const colors = String(raw).split(/[,;\n]/).map(v => v.trim()).filter(Boolean).slice(0, 32);
    for (const [index, color] of colors.entries()) requirements.push({ id: `color_${index + 1}`, label: `Color ${index + 1}`, material, color: clean(color, 80), colorHex: parseColor(color)?.hex ?? null, grams: null });
    if (!requirements.length) {
      requirements.push({ id: 'color_1', label: 'Requested filament', material, color: null, colorHex: null, grams: null });
      warnings.push('Color count does not specify colors. Enter the requested colors for matching.');
    }
  }
  if (requirements.length === 1 && requirements[0].colorHex && !(Number(spec.colors) > 1)) requirements[0].grams = totalGrams;
  else if (totalGrams) warnings.push('Only total grams are known; per-color stock sufficiency is unverified.');
  return { applicable: true, requirements: normalizeRequirements(requirements), totalGrams, warnings };
}
