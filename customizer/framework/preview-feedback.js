// Presentation state only. Never receives customer parameters or claims numerical progress.
export function previewFeedback({ status, phase = 'loading', realistic = false, hasPreview = false, slow = false }) {
  if (status === 'error') return { busy: false, title: 'Your design needs attention', detail: 'See the message below to update your settings or try again.' };
  if (status !== 'ready') return {
    busy: true,
    title: hasPreview ? 'Updating your model…' : 'Building your model…',
    detail: slow ? 'This is taking longer than usual. Detailed designs can take a little more time; you can keep editing.'
      : hasPreview ? 'Showing the previous preview while we apply your latest settings. You can keep editing.'
        : 'Preparing the model in your browser. Your preview will appear here; you can keep editing.'
  };
  if (phase === 'error') return { busy: false, title: 'Preview unavailable', detail: realistic ? 'Your print file is ready. Use Retry preview or switch to Model.' : 'Your print file is ready. See the preview message below.' };
  if (phase === 'loading') return {
    busy: true,
    title: realistic ? 'Preparing realistic preview…' : 'Preparing your preview…',
    detail: slow ? 'Your print file is ready. The preview is taking longer than usual; you can keep editing.'
      : 'Your print file is ready. Preparing the view with your latest settings.'
  };
  return { busy: false, title: '', detail: '' };
}

export function createPreviewFeedback(stage) {
  const panel = document.createElement('div');
  panel.className = 'cz-preview-feedback';
  panel.id = 'cz-preview-feedback';
  panel.setAttribute('role', 'status');
  panel.setAttribute('aria-live', 'polite');
  panel.setAttribute('aria-atomic', 'true');
  panel.innerHTML = '<span class="cz-preview-spinner" aria-hidden="true"></span><div><strong></strong><p></p></div>';
  // Keep the live region outside aria-busy, so updates are announced during work.
  stage?.after(panel);
  let current = {};
  let timer;
  let activeKey = '';
  let slow = false;
  function paint() {
    const feedback = previewFeedback({ ...current, slow });
    panel.hidden = !feedback.title;
    panel.dataset.busy = String(feedback.busy);
    const title = panel.querySelector('strong');
    const detail = panel.querySelector('p');
    // Repeated edits in the same phase must not repeat live announcements.
    if (title.textContent !== feedback.title) title.textContent = feedback.title;
    if (detail.textContent !== feedback.detail) detail.textContent = feedback.detail;
    stage?.setAttribute('aria-busy', String(feedback.busy));
    if (stage) stage.dataset.previewBusy = String(feedback.busy);
    return feedback;
  }
  return {
    update(next) {
      current = next;
      const key = `${next.status}|${next.phase}|${next.realistic}`;
      if (key !== activeKey) {
        clearTimeout(timer);
        slow = false;
        activeKey = key;
        if (paint().busy) timer = setTimeout(() => { slow = true; paint(); }, 8000);
      } else paint();
    }
  };
}
