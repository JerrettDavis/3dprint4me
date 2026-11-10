import { compileVaseProfile, validateVaseProfile } from '../../public/assets/js/customize/vase-shape.js';

import { measureVaseDimensions, setVaseEndpointDiameter } from '../../public/assets/js/customize/vase-dimensions.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const idFor = key => `cz-${String(key).replace(/[^A-Za-z0-9_-]/g, '-')}`;
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const plot = { x: 28, y: 24, width: 264, height: 192 };

export function addProfilePoint(input) {
  const points = validateVaseProfile(input);
  if (points.length >= 12) throw new RangeError('The profile already has 12 points.');
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    if (points[i + 1].height - points[i].height > points[index + 1].height - points[index].height) index = i;
  }
  const height = (points[index].height + points[index + 1].height) / 2;
  points.splice(index + 1, 0, { height, radius: compileVaseProfile(points)(height) });
  return points;
}

export function moveProfilePoint(input, index, change) {
  const points = validateVaseProfile(input);
  if (!Number.isInteger(index) || index < 0 || index >= points.length) throw new RangeError('Choose a profile point.');
  const original = points[index];
  const radius = Number.isFinite(change.radius) ? clamp(change.radius, 0.05, 1) : original.radius;
  const height = index === 0 || index === points.length - 1 ? original.height
    : Number.isFinite(change.height) ? clamp(change.height, points[index - 1].height + 0.02, points[index + 1].height - 0.02) : original.height;
  points[index] = { height, radius };
  return points;
}

export function removeProfilePoint(input, index) {
  const points = validateVaseProfile(input);
  if (points.length <= 3 || !Number.isInteger(index) || index <= 0 || index >= points.length - 1) {
    throw new RangeError('Keep the profile endpoints and at least 3 points.');
  }
  points.splice(index, 1);
  return points;
}

function chart(points) {
  const sample = compileVaseProfile(points);
  const xy = (height, radius) => [plot.x + radius * plot.width, plot.y + (1 - height) * plot.height];
  const line = Array.from({ length: 81 }, (_, i) => xy(i / 80, sample(i / 80)).map(n => n.toFixed(3)).join(',')).join(' L');
  const handles = points.map((point, i) => {
    const [cx, cy] = xy(point.height, point.radius);
    return `<circle class="cz-profile-hit" data-profile-handle="${i}" cx="${cx}" cy="${cy}" r="22"/><circle class="cz-profile-dot" cx="${cx}" cy="${cy}" r="5"/>`;
  }).join('');
  return `<path class="cz-profile-axis" d="M28,24 V216 H292"/><path class="cz-profile-shape" d="M28,216 L${line} L28,24 Z"/>${handles}`;
}

function rows(points, id) {
  return points.map((point, index) => {
    const endpoint = index === 0 || index === points.length - 1;
    const heightId = `${id}-height-${index}`, radiusId = `${id}-radius-${index}`;
    return `<div class="cz-profile-row" data-point-row="${index}">
<label for="${heightId}">Point ${index + 1} height (%)<input class="input" type="number" id="${heightId}" data-profile-coordinate="height" data-point="${index}" min="${endpoint ? point.height * 100 : (points[index - 1].height + 0.02) * 100}" max="${endpoint ? point.height * 100 : (points[index + 1].height - 0.02) * 100}" step="0.1" value="${Number((point.height * 100).toFixed(3))}"${endpoint ? ' readonly' : ''} aria-describedby="${id}-help ${id}-error"></label>
<label for="${radiusId}">Point ${index + 1} radius (%)<input class="input" type="number" id="${radiusId}" data-profile-coordinate="radius" data-point="${index}" min="5" max="100" step="0.1" value="${Number((point.radius * 100).toFixed(3))}" aria-describedby="${id}-help ${id}-error"></label>
<button type="button" class="button secondary small-button" data-profile-remove="${index}" aria-label="Remove point ${index + 1}"${endpoint || points.length <= 3 ? ' disabled' : ''}>Remove</button>
</div>`;
  }).join('');
}

function physicalControls(parameters, points, id) {
  let measured;
  try { measured = measureVaseDimensions({ ...parameters, profile: points }); } catch { /* Invalid settings are explained by the form. */ }
  return `<div class="cz-profile-row" data-profile-dimensions>
${[['base', 'Base'], ['mouth', 'Mouth']].map(([key, label]) => `<label for="${id}-${key}-mm">${label} outside diameter (mm)<input class="input" type="number" id="${id}-${key}-mm" data-profile-diameter="${key}" min="0.1" step="0.1" value="${measured ? measured[`${key}DiameterMm`].toFixed(1) : ''}"${measured ? '' : ' disabled'} aria-describedby="${id}-dimensions-help ${id}-error"></label>`).join('')}
</div><p class="help" id="${id}-dimensions-help">Outside envelope sizes include surface relief. Editing a size moves its profile endpoint. Other profile points can limit the achievable range; polygon spans can be smaller than their envelope diameter.</p>`;
}

export function renderProfileInput(key, def, value, error = '', parameters = {}) {
  const points = validateVaseProfile(value), id = idFor(key);
  return `<div class="cz-field cz-field-profile" data-field="${escape(key)}">
<span class="cz-label" id="${id}-label">${escape(def.label ?? key)}</span>
<input type="hidden" id="${id}" name="${escape(key)}" value="${escape(JSON.stringify(points))}">
<svg class="cz-profile-chart" data-profile-chart viewBox="0 0 320 240" role="img" aria-labelledby="${id}-label" aria-describedby="${id}-help">${chart(points)}</svg>
<p class="help" id="${id}-help">${escape(def.help ?? 'Drag the curve points, or edit their percentages below. Endpoint heights stay fixed.')}</p>
${def.physicalDimensions ? physicalControls(parameters, points, id) : ''}
<div class="cz-profile-rows" data-profile-rows>${rows(points, id)}</div>
<button type="button" class="button secondary small-button" data-profile-add${points.length >= 12 ? ' disabled' : ''}>Add point</button>
<p class="help" data-profile-status aria-live="polite">${points.length} control points.</p>
<div class="cz-err${error ? ' is-open' : ''}"><p class="cz-field-error" id="${id}-error">${escape(error)}</p></div>
</div>`;
}

export function mountProfileInput(root, { getParameters = () => ({}) } = {}) {
  const hidden = root.querySelector('input[type="hidden"]');
  const svg = root.querySelector('[data-profile-chart]');
  const list = root.querySelector('[data-profile-rows]');
  const add = root.querySelector('[data-profile-add]');
  const status = root.querySelector('[data-profile-status]');
  let points = validateVaseProfile(JSON.parse(hidden.value));
  let dragging = null;
  let measuredKey = '', measured = null;
  function paintDimensions() {
    const controls = root.querySelectorAll('[data-profile-diameter]');
    if (!controls.length) return;
    if (dragging) { for (const control of controls) control.disabled = true; return; }
    const settings = { ...getParameters(), profile: points }, key = JSON.stringify(settings);
    try {
      if (key !== measuredKey) { measured = measureVaseDimensions(settings); measuredKey = key; }
      for (const control of controls) {
        control.disabled = false;
        control.value = measured[`${control.dataset.profileDiameter}DiameterMm`].toFixed(1);
      }
    } catch { for (const control of controls) control.disabled = true; }
  }
  function paint(rebuild = false) {
    svg.innerHTML = chart(points);
    if (rebuild) list.innerHTML = rows(points, hidden.id);
    else for (const control of list.querySelectorAll('[data-profile-coordinate]')) {
      const index = Number(control.dataset.point), coordinate = control.dataset.profileCoordinate;
      control.value = String(Number((points[index][coordinate] * 100).toFixed(3)));
      if (coordinate === 'height' && index > 0 && index < points.length - 1) {
        control.min = String((points[index - 1].height + 0.02) * 100);
        control.max = String((points[index + 1].height - 0.02) * 100);
      }
    }
    hidden.value = JSON.stringify(points);
    add.disabled = points.length >= 12;
    paintDimensions();
  }
  function commit(next, rebuild = false, message = '') {
    points = validateVaseProfile(next);
    paint(rebuild);
    if (message) status.textContent = message;
    hidden.dispatchEvent(new Event('change', { bubbles: true }));
  }
  root.addEventListener('change', event => {
    const control = event.target;
    if (control.matches('[data-profile-diameter]')) {
      if (control.value === '' || !Number.isFinite(Number(control.value))) { paintDimensions(); return; }
      try {
        const result = setVaseEndpointDiameter({ ...getParameters(), profile: points }, control.dataset.profileDiameter, Number(control.value));
        commit(result.profile, false, result.clamped
          ? `Achievable with this profile: ${result.minimumMm.toFixed(1)}–${result.maximumMm.toFixed(1)} mm. Size set to ${result.diameterMm.toFixed(1)} mm.`
          : `Outside diameter set to ${result.diameterMm.toFixed(1)} mm.`);
      } catch { status.textContent = 'Use simpler shape settings to calculate the end sizes.'; paintDimensions(); }
      return;
    }
    if (!control.matches('[data-profile-coordinate]')) return;
    const coordinate = control.dataset.profileCoordinate, index = Number(control.dataset.point);
    const value = control.value === '' ? NaN : Number(control.value) / 100;
    commit(moveProfilePoint(points, index, { [coordinate]: value }));
  });
  root.addEventListener('click', event => {
    const remove = event.target.closest('[data-profile-remove]');
    if (event.target.closest('[data-profile-add]')) {
      commit(addProfilePoint(points), true, `Point added. ${points.length + 1} control points.`);
      list.querySelector('input:not([readonly])')?.focus();
    } else if (remove && !remove.disabled) {
      const index = Number(remove.dataset.profileRemove);
      commit(removeProfilePoint(points, index), true, `Point removed. ${points.length - 1} control points.`);
      list.querySelector(`[data-point="${Math.min(index, points.length - 1)}"]`)?.focus();
    }
  });
  svg.addEventListener('pointerdown', event => {
    const handle = event.target.closest('[data-profile-handle]');
    if (!handle || event.button !== 0) return;
    event.preventDefault();
    dragging = { index: Number(handle.dataset.profileHandle), pointerId: event.pointerId };
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener('pointermove', event => {
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    const bounds = svg.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width * 320;
    const y = (event.clientY - bounds.top) / bounds.height * 240;
    points = moveProfilePoint(points, dragging.index, {
      radius: (x - plot.x) / plot.width, height: 1 - (y - plot.y) / plot.height,
    });
    paint();
  });
  const finish = event => {
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    dragging = null;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    commit(points);
  };
  svg.addEventListener('pointerup', finish);
  svg.addEventListener('pointercancel', finish);
  svg.addEventListener('lostpointercapture', finish);
  return {
    setValue(value) {
      try {
        const next = validateVaseProfile(value), rebuild = next.length !== points.length;
        points = next; paint(rebuild);
      } catch { /* Keep the last valid diagram while validation reports the invalid state. */ }
    },
    setError(message) {
      for (const control of root.querySelectorAll('[data-profile-coordinate], [data-profile-diameter]')) {
        if (message) control.setAttribute('aria-invalid', 'true');
        else control.removeAttribute('aria-invalid');
      }
    },
  };
}
