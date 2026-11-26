import { SliceError } from './slicer-contract.js';

/** Applied only to a trusted, flattened shop process, never uploaded project settings. */
export function effectiveBambuProcess(base) {
  if (!base || base.type !== 'process' || typeof base.name !== 'string' || !base.name.trim()
    || (base.inherits && base.instantiation !== 'true')) {
    throw new SliceError('unavailable', 'A flattened shop process profile is required.');
  }
  const changes = new Set(String(base.different_settings_to_system?.[0] ?? '').split(';').filter(Boolean));
  const overrides = {enable_support: '1', support_type: 'tree(auto)', support_on_build_plate_only: '0'};
  for (const key of Object.keys(overrides)) changes.add(key);
  return {...base, ...overrides, different_settings_to_system: [[...changes].join(';')]};
}

export function effectivePrusaProfile(source, material = null) {
  const setting = key => source.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm'))?.[1]?.trim();
  const positiveList = key => setting(key)?.split(';').every(value=>Number(value) > 0);
  if (typeof source !== 'string' || /PLACEHOLDER/i.test(source) || !(Number(setting('layer_height')) > 0) || !setting('filament_type')
    || !(setting('printer_settings_id') || setting('printer_model')) || !(Number(setting('max_print_height')) > 0)
    || !positiveList('nozzle_diameter') || !positiveList('filament_diameter') || !positiveList('filament_density')
    || !/^[-\d.]+x[-\d.]+(?:,[-\d.]+x[-\d.]+){2,}$/.test(setting('bed_shape') ?? '')) {
    throw new SliceError('unavailable', 'An exported shop printer, material and print profile is required.');
  }
  const materials = setting('filament_type').replaceAll('"','').split(';').map(value=>value.trim().toLowerCase());
  if (material && materials.some(value=>value !== material)) throw new SliceError('unsupported', 'The shop profile does not match the requested material.');
  const overrides = {support_material:'1',support_material_auto:'1',support_material_style:'organic',support_material_buildplate_only:'0'};
  const kept = source.split(/\r?\n/).filter(line=>!Object.keys(overrides).some(key=>new RegExp(`^${key}\\s*=`).test(line)));
  return [...kept,...Object.entries(overrides).map(([key,value])=>`${key} = ${value}`),''].join('\n');
}
