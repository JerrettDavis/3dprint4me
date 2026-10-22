// Pure source validation. No source extra fields, comments, or credentials are imported.
const materials = { PLA: 'pla', 'PLA+': 'pla-plus', PETG: 'petg', ABS: 'abs', ASA: 'asa', TPU: 'tpu', 'FLEXIBLE (TPU)': 'tpu' };
const invalid = () => { throw new Error('Invalid Spoolman inventory snapshot.'); };
const text = (v, max) => {
  if (v == null) return null;
  if (typeof v !== 'string' || v.length > max) return invalid();
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() || null;
};
const quantity = (v, max) => v == null ? null : typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : invalid();
const hex = v => typeof v === 'string' && /^#?[a-f0-9]{6}([a-f0-9]{2})?$/i.test(v) ? `#${v.replace(/^#/, '').toLowerCase()}` : null;
export function normalizeSpoolmanSnapshot({ instanceId, currency, spools }) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(instanceId ?? '') || !/^[A-Z]{3}$/.test(currency ?? '') || !Array.isArray(spools) || spools.length > 5000) return invalid();
  const seen = new Set();
  const items = spools.map(spool => {
    if (!spool || !Number.isSafeInteger(spool.id) || spool.id < 1 || seen.has(spool.id) || typeof spool.archived !== 'boolean' || !spool.filament || typeof spool.filament !== 'object') return invalid();
    seen.add(spool.id);
    const f = spool.filament, rawMaterial = text(f.material, 64), material = materials[rawMaterial?.toUpperCase()];
    const name = text(f.name, 256), vendor = text(f.vendor?.name, 256), rawHex = hex(f.color_hex);
    const multi = text(f.multi_color_hexes, 2048), colors = multi ? multi.split(',').map(v => hex(v.trim())) : [];
    if (colors.some(v => !v)) return invalid();
    const appearanceReview = Boolean(multi || f.multi_color_direction || rawHex?.length === 9 && rawHex.slice(-2) !== 'ff' || /transparen|translucen|clear/i.test(`${name ?? ''} ${f.finish ?? ''}`));
    const remaining = quantity(spool.remaining_weight, 10000000), initial = quantity(spool.initial_weight, 100000), nominal = quantity(f.weight, 100000);
    const spoolPrice = quantity(spool.price, 100000), filamentPrice = quantity(f.price, 100000);
    const price = spoolPrice ?? filamentPrice, priceBasis = spoolPrice != null ? initial ?? nominal : nominal;
    const source = { instanceId, spoolId: spool.id, filamentId: f.id ?? null, rawMaterial, materialKnown: Boolean(material), name, vendor, remainingGrams: remaining, initialGrams: initial, nominalGrams: nominal, price, priceBasisGrams: priceBasis, priceSource: spoolPrice != null ? 'spool' : filamentPrice != null ? 'filament' : null, currency, rawColorHex: rawHex, colors, colorDirection: text(f.multi_color_direction, 40), appearanceReview, location: text(spool.location, 64) };
    return { material: material ?? 'unmapped', brandLine: [vendor, name].filter(Boolean).join(' · ').slice(0,120) || null, color: name?.slice(0,80) ?? null, colorHex: appearanceReview ? null : rawHex?.slice(0,7) ?? null, spoolNominalGrams: priceBasis > 0 ? Math.round(priceBasis) || 1 : null, purchaseCostCents: currency === 'USD' && price != null && priceBasis > 0 ? Math.round(price * 100) : null, onHandGrams: remaining == null ? null : Math.floor(remaining), active: !spool.archived, source };
  });
  return { instanceId, currency, items };
}
export function importedEligibility(row, { now = new Date(), lastSuccessAt = row.source?.lastSuccessAt } = {}) {
  if (!row.source) return { eligible: true, reasons: [] };
  const reasons = [], age = now.getTime() - Date.parse(lastSuccessAt);
  if (row.source.enabled === false) reasons.push('Spoolman syncing is disabled; current stock is unverified.');
  if (!Number.isFinite(age) || age < 0 || age >= 300000) reasons.push('Spoolman stock is stale; refresh before confirming availability.');
  if (!row.source.materialKnown) reasons.push('Spoolman material needs mapping.');
  if (row.source.appearanceReview || !row.colorHex) reasons.push('Spoolman appearance needs review; no solid-color match is verified.');
  if (row.source.remainingGrams == null) reasons.push('Spoolman remaining weight is unknown.');
  return { eligible: reasons.length === 0, reasons };
}
