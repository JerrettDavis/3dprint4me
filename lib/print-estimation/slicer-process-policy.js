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
