export function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; }
let sequence = 0;
export function field(parent, label, value = '', { type = 'text', min, max, required = false, options, step } = {}) {
  const wrap = el('label', 'filament-field', label), input = el(options ? 'select' : type === 'textarea' ? 'textarea' : 'input');
  input.id = `filament-field-${++sequence}`; wrap.htmlFor = input.id;
  if (options) for (const [v, text] of options) { const option = el('option', '', text); option.value = v; input.append(option); }
  else if (type !== 'textarea') input.type = type;
  input.value = value ?? ''; input.required = required;
  if (type === 'text') input.maxLength = 120;
  if (min != null) input.min = min; if (max != null) input.max = max; if (step != null) input.step = step;
  wrap.append(input); parent.append(wrap); return input;
}
export function button(parent, label, callback, className = 'action') {
  const b = el('button', className, label); b.type = 'button';
  b.onclick = async () => { b.disabled = true; try { await callback(); } finally { b.disabled = false; } }; parent.append(b); return b;
}
export function message(parent) { const node = el('p', 'filament-message'); node.setAttribute('role', 'status'); parent.append(node); return node; }
export async function perform(output, callback, success = '') {
  output.textContent = '';
  try { const result = await callback(); output.textContent = success; return result; }
  catch (error) { output.textContent = error.message || 'The filament update could not be saved. Retry or refresh to review changes.'; return null; }
}
export function swatch(value, label = value) {
  const node = el('span', 'filament-color');
  const chip = el('span', 'filament-swatch'); chip.setAttribute('aria-hidden', 'true');
  if (/^#[a-f0-9]{6}$/i.test(value ?? '')) chip.style.backgroundColor = value;
  node.append(chip, el('span', '', label || 'Unknown color')); return node;
}
