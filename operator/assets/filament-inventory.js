import { el, field, button, message, perform, swatch } from './filament-ui.js';
import { renderSpoolmanStatus } from './spoolman-status.js';

export const MATCH_FIELDS = [
  ['hueClockwise', 'Hue clockwise (degrees)', 180], ['hueCounterclockwise', 'Hue counterclockwise (degrees)', 180],
  ['saturation', 'Saturation variance (percentage points)', 100], ['lightness', 'Lightness variance (percentage points)', 100],
  ['red', 'Red variance (0–255)', 255], ['green', 'Green variance (0–255)', 255], ['blue', 'Blue variance (0–255)', 255],
  ['closePercent', 'Close search band (%)', 100], ['stepPercent', 'Widening step (%)', 100], ['stockBufferGrams', 'Stock buffer (grams)', 100000]
];

export function renderFilamentInventory({ items, policy, sync, effective, spoolmanUiOrigin }, { role, onSave, onSaveImported, onRefresh, onReload, onSettingsSave, onSettingsPreview, onBack }) {
  const section = el('section', 'filament-inventory');
  button(section, 'Back to inbox', onBack, 'back');
  section.append(el('h2', '', 'Filament inventory'), el('p', 'print-meta', 'Private stock lots and matching limits. Available grams are unreserved.'));
  section.append(renderSpoolmanStatus(sync,{role,onRefresh,onReload}));
  if(effective) for(const [material,cost] of Object.entries(effective)) {
    if(cost.costCoverage)section.append(el('p','print-meta',`${material.toUpperCase()}: $${cost.landedUsdPerKg}/kg · ${cost.source==='fallback'?'Pricing fallback':cost.costCoverage==='partial'?'Partial cost coverage':'Recorded cost'}${cost.uncoveredGrams ? ` · ${cost.uncoveredGrams}g without a known cost` : ''}${cost.inventoryStale?' · Source stock stale':''}`));
  }
  const output = message(section), list = el('div', 'inventory-list'); section.append(list);
  const editor = el('form', 'filament-editor'), grid = el('div', 'filament-grid');
  editor.append(el('h3', '', 'Stock lot'), grid);
  const inputs = {
    material: field(grid, 'Material key', 'pla', { required: true }), brandLine: field(grid, 'Brand / line'),
    color: field(grid, 'Color name'), colorHex: field(grid, 'Color hex'),
    spoolNominalGrams: field(grid, 'Nominal spool grams', 1000, { type: 'number', min: 1, max: 100000, required: true }),
    onHandGrams: field(grid, 'On-hand grams', 0, { type: 'number', min: 0, max: 10000000, required: true }),
    purchaseCostCents: field(grid, 'Purchase cost (cents)', 0, { type: 'number', min: 0, max: 10000000, required: true }),
    freightFeeCents: field(grid, 'Freight and fees (cents)', 0, { type: 'number', min: 0, max: 10000000 }),
    active: field(grid, 'Stock status', 'true', { options: [['true', 'Active'], ['false', 'Inactive']] }),
    estimateDefault: field(grid, 'Default for estimates', 'false', { options: [['false', 'No'], ['true', 'Yes']] }),
    notes: field(grid, 'Private stock notes', '', { type: 'textarea' })
  };
  inputs.notes.maxLength = 1000; inputs.colorHex.placeholder = '#RRGGBB (optional)';
  const costOverride=field(grid,'Local cost override (cents)','',{type:'number',min:0,max:10000000});
  costOverride.parentElement.hidden=true;
  const sourceFields=['material','brandLine','color','colorHex','spoolNominalGrams','onHandGrams','purchaseCostCents','active'];
  const editingMode=imported=>{ for(const key of sourceFields)inputs[key].disabled=imported;costOverride.parentElement.hidden=!imported; };
  let editing = null;
  const draw = () => {
    list.replaceChildren();
    if (!items.length) list.append(el('p', '', 'No filament recorded. Add your first stock lot below.'));
    for (const row of items) {
      const item = el('article', 'inventory-row');
      item.append(swatch(row.colorHex, row.color || row.colorHex || 'Color unspecified'), el('p', '', `${row.material.toUpperCase()} · ${row.brandLine || 'No brand recorded'} · ${row.onHandGrams == null ? 'Weight unknown' : `${row.onHandGrams}g available`}${row.active ? '' : ' · Inactive'}`));
      if(row.source) {
        item.append(el('p','print-meta',`Spoolman spool ${row.source.spoolId} · ${row.source.rawMaterial || 'Material unknown'} · ${row.source.remainingGrams == null?'Weight unknown':`${row.source.remainingGrams}g measured in source`} · ${row.landedUsdPerKg == null?'Cost unknown — pricing fallback applies':`$${row.landedUsdPerKg}/kg${row.costOverrideCents!=null?' local override':''}`}`));
        if(row.source.appearanceReview)item.append(el('p','print-meta',`Appearance requires review${row.source.colors?.length?` · ${row.source.colors.join(', ')}`:''}. Not an automatic solid-color match.`));
        if(spoolmanUiOrigin) { const link=el('a','',`Open spool ${row.source.spoolId} in Spoolman`);link.href=`${spoolmanUiOrigin}/spool/show/${row.source.spoolId}`;link.target='_blank';link.rel='noopener noreferrer';item.append(link); }
      }
      if (role === 'owner') button(item, `Edit ${row.color || row.material}`, () => {
        editing = row;
        editingMode(Boolean(row.source));costOverride.value=row.costOverrideCents ?? '';
        for (const [key, input] of Object.entries(inputs)) input.value = row[key] == null ? '' : String(row[key]);
        (row.source?costOverride:inputs.material).focus(); editor.scrollIntoView({ block: 'start' });
      });
      list.append(item);
    }
  };
  draw();
  if (role === 'owner') {
    const save = el('button', 'primary', 'Save filament'); save.type = 'submit'; editor.append(save);
    button(editor, 'New stock lot', () => { editing = null; editingMode(false);editor.reset(); inputs.material.value = 'pla'; inputs.spoolNominalGrams.value = 1000; inputs.onHandGrams.value = 0; inputs.purchaseCostCents.value = 0; inputs.freightFeeCents.value = 0; inputs.active.value = 'true'; inputs.estimateDefault.value = 'false'; inputs.material.focus(); });
    editor.onsubmit = async event => {
      event.preventDefault(); save.disabled = true;
      const filament = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.type === 'number' ? Number(input.value) : ['active', 'estimateDefault'].includes(key) ? input.value === 'true' : input.value || null]));
      if (editing) Object.assign(filament, { id: editing.id, revision: editing.revision });
      const result = await perform(output, () => editing?.source ? onSaveImported({id:editing.id,revision:editing.revision,local:{notes:filament.notes,freightFeeCents:filament.freightFeeCents,estimateDefault:filament.estimateDefault,costOverrideCents:costOverride.value===''?null:Number(costOverride.value)}}) : onSave(filament), 'Filament saved.');
      save.disabled = false;
      if (result) { const saved = result.filament; items = [...items.filter(item => item.id !== saved.id), saved]; editing = saved; draw(); }
    };
    section.append(editor);
  } else section.append(el('p', 'print-meta', 'Only the owner can change inventory or matching settings.'));
  const settings = el('form', 'filament-settings'), controls = el('div', 'filament-grid');
  settings.append(el('h3', '', 'Color matching limits'), el('p', 'print-meta', 'Hard limits always compare with the requested color. Search widens only within these limits. Digital swatches are approximate.'), controls);
  const settingInputs = { mode: field(controls, 'Match mode', policy.settings.mode, { options: [['hsl', 'HSL'], ['rgb', 'RGB'], ['both', 'HSL and RGB']] }) };
  for (const [key, label, max] of MATCH_FIELDS) settingInputs[key] = field(controls, label, policy.settings[key], { type: 'number', min: key.endsWith('Percent') ? 1 : 0, max, step: 'any', required: true });
  const rules = field(settings, 'Allowed material substitutions (one requested > offered pair per line)', policy.settings.materialRules.map(rule => `${rule.from} > ${rule.to}`).join('\n'), { type: 'textarea' });
  rules.maxLength = 4500;
  const readSettings = () => ({ ...Object.fromEntries(Object.entries(settingInputs).map(([key, input]) => [key, key === 'mode' ? input.value : Number(input.value)])), materialRules: rules.value.split('\n').map(line => line.trim()).filter(Boolean).map(line => { const parts = line.split('>'); if (parts.length !== 2) throw Error('Use one requested > offered material pair per line.'); return { from: parts[0].trim(), to: parts[1].trim() }; }) });
  const settingsOutput = message(settings), preview = el('div', 'filament-preview'); settings.append(preview);
  button(settings, 'Preview against selected work', async () => {
    await perform(settingsOutput, async () => {
      const result = await onSettingsPreview(readSettings()); preview.replaceChildren(el('h4', '', 'Matching preview'));
      for (const row of result.requirements) preview.append(el('p', '', `${row.requirement.label}: ${row.status} · ${row.candidates.length} close options · ${row.furtherCandidates.length} further options`));
      if (!result.requirements.length) preview.append(el('p', '', 'No applicable print requirements.'));
    });
  });
  if (role === 'owner') {
    const save = el('button', 'primary', 'Save matching settings'); save.type = 'submit'; settings.append(save);
    settings.onsubmit = async event => { event.preventDefault(); save.disabled = true; const result = await perform(settingsOutput, () => onSettingsSave({ revision: policy.revision, settings: readSettings() }), 'Matching settings saved.'); if (result) policy.revision = result.revision; save.disabled = false; };
  }
  // Operators can preview changed limits but cannot persist shared policy.
  section.append(settings); return section;
}
