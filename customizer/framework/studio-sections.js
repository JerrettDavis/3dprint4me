// Presentation only. Every schema field belongs to exactly one broad editing section.
const PLANS = {
  pumpkin: [['appearance', 'Design & appearance', ['hat', 'colors', 'face', 'surface']], ['construction', 'Size & construction', ['type', 'size', 'ribs', 'stem']]],
  'gridfinity-bin': [['layout', 'Size & layout', ['size', 'inside']], ['construction', 'Construction & finish', ['construction', 'colors']]],
  'gridfinity-base': [['layout', 'Size & layout', ['size']], ['construction', 'Construction & finish', ['base', 'colors']]],
  vase: [['form', 'Profile & form', ['profile', 'size', 'form']], ['finish', 'Surface & finish', ['print', 'surface', 'colors']]],
  'infinity-fidget': [['form', 'Shape & construction', ['construction', 'shape', 'size', 'surface']], ['finish', 'Personalize & finish', ['writing', 'artwork', 'colors']]],
  'display-sign': [['content', 'Text & artwork', ['text', 'logo', 'qr']], ['appearance', 'Style & color', ['decor', 'colors']], ['construction', 'Size & holder', ['size', 'holder']]]
};
const DEFAULT = [['content', 'Content & details', ['text', 'network', 'rating', 'icon', 'tag']], ['appearance', 'Style & size', ['shape', 'size', 'layout', 'back', 'decor', 'colors']]];
export function editingSections(generator) {
  const plan = PLANS[generator.id] ?? DEFAULT;
  const result = plan.map(([key, label]) => ({ key, label, keys: [] }));
  for (const [key, def] of Object.entries(generator.schema)) {
    const index = generator.id === 'pumpkin' && key === 'body_source' ? 0 : plan.findIndex(([, , groups]) => groups.includes(def.group));
    result[index < 0 ? result.length - 1 : index].keys.push(key);
  }
  return result;
}
export function reviewEntries(generator, params) {
  return Object.entries(generator.schema).filter(([key, def]) => {
    if (def.sensitive || def.transient || !Object.hasOwn(params, key)) return false;
    const when = def.visibleWhen;
    return !when || (typeof when === 'function' ? when(params) : Object.entries(when).every(([k, value]) => Array.isArray(value) ? value.includes(params[k]) : value === params[k]));
  }).map(([key, def]) => {
    const value = params[key];
    const label = def.label ?? key;
    return { key, label, value: def.type === 'bool' ? (value ? 'Yes' : 'No') : def.type === 'profile' ? 'Custom profile' : String(def.options?.find(o => o.value === value)?.label ?? value) + (def.unit ? ` ${def.unit}` : '') };
  });
}
