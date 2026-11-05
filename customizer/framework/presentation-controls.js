export function createPresentationControls(bar, onChange) {
  const root = document.createElement('div');
  root.className = 'cz-presentation';
  root.innerHTML = `<div class="cz-presentation-switch" role="group" aria-label="Preview style">
    <button class="cz-bar-button" type="button" data-presentation="model" aria-pressed="true">Model</button>
    <button class="cz-bar-button" type="button" data-presentation="realistic" aria-pressed="false">Realistic preview</button>
    </div><p class="cz-presentation-note" role="status" id="cz-presentation-note">View your design, then see it in studio lighting.</p>
    <button class="cz-bar-button" type="button" id="cz-presentation-retry" hidden>Retry preview</button>`;
  bar?.after(root);
  const buttons = [...root.querySelectorAll('[data-presentation]')];
  const note = root.querySelector('p');
  const retry = root.querySelector('#cz-presentation-retry');
  buttons.forEach(button => button.addEventListener('click', () => onChange(button.dataset.presentation === 'realistic')));
  retry.addEventListener('click', () => onChange(true));
  return {
    update(realistic, phase = 'ready') {
      buttons.forEach(button => button.setAttribute('aria-pressed', String((button.dataset.presentation === 'realistic') === realistic)));
      root.dataset.state = phase;
      retry.hidden = phase !== 'error' || !realistic;
      note.textContent = realistic
        ? phase === 'loading' ? 'Updating realistic preview…'
          : phase === 'invalid' ? 'Complete your settings to update the realistic preview.'
          : phase === 'error' ? 'Realistic preview is unavailable. Retry or switch to Model; your print file is unchanged.'
            : 'Illustrative studio view · supports removed · actual colors and finish vary.'
        : 'Model view · printable geometry and part layout.';
    }
  };
}
