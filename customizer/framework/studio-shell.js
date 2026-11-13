import { editingSections, reviewEntries } from './studio-sections.js';
import { esc } from './form.js';

/** Presentation wrapper only: engine, fields, drafts, uploads and actions retain their owners. */
export function mountStudio({ generator, form, root, getParams }) {
  root.classList.add('cz-guided');
  document.body.classList.add('cz-guided-page');
  const sections = editingSections(generator);
  const settings = root.querySelector('#cz-win-settings');
  const info = root.querySelector('#cz-win-info');
  const formEl = root.querySelector('#cz-form');
  const panels = root.querySelector('.cz-panels');
  // Keep the selected product and its edit shortcut available in Review too.
  const productContext = root.querySelector('.cz-product-context');
  const productChange = productContext?.querySelector('.button');
  if (productContext) panels.prepend(productContext);
  const column = document.createElement('div'); column.className='cz-model-column';
  const preview = root.querySelector('.cz-preview');
  preview.before(column); column.append(preview, root.querySelector('.cz-notices'));
  const nav = document.createElement('nav');
  nav.className = 'cz-step-nav'; nav.setAttribute('aria-label', 'Design sections');
  nav.innerHTML = sections.map(s=>`<button type="button" data-editing-section="${esc(s.key)}">${esc(s.label)}</button>`).join('') + '<button type="button" data-editing-section="review">Review design</button>';
  root.before(nav);
  const expert = document.createElement('button');
  expert.type = 'button'; expert.className = 'cz-all-settings'; expert.textContent = 'All settings'; expert.setAttribute('aria-pressed','false');
  nav.append(expert);
  const review = document.createElement('div');
  review.id = 'cz-review-specification';
  const heading = document.createElement('h3'); heading.textContent = 'Your specification';
  const specification = document.createElement('dl'); specification.className = 'cz-review-list';
  review.append(heading, specification);
  info.querySelector('.cz-win-body').prepend(review);
  const errors = document.createElement('div'); errors.className = 'cz-step-errors'; errors.setAttribute('aria-label','Settings needing attention');
  panels.prepend(errors);
  const footer = document.createElement('div'); footer.className = 'cz-step-actions';
  const back = document.createElement('button'); back.type='button'; back.className='button secondary'; back.textContent='Back';
  const next = document.createElement('button'); next.type='button'; next.className='button primary';
  footer.append(back,next); panels.append(footer);
  let active = new URLSearchParams(location.search).get('intent') === 'request' ? 'review' : sections[0].key;
  const available = () => sections.filter(s=>s.keys.some(key=>!formEl.querySelector(`[data-field="${CSS.escape(key)}"]`)?.hidden));
  function update() {
    const params = getParams();
    specification.replaceChildren();
    for (const entry of reviewEntries(generator, params)) {
      const row=document.createElement('div'), dt=document.createElement('dt'), dd=document.createElement('dd');
      dt.textContent=entry.label; dd.textContent=entry.value; row.append(dt,dd); specification.append(row);
    }
    errors.replaceChildren();
    for (const field of formEl.querySelectorAll('.cz-field')) {
      const message=field.querySelector('.cz-field-error')?.textContent;
      if (!message) continue;
      const section=sections.find(s=>s.keys.includes(field.dataset.field));
      if (!section) continue;
      const button=document.createElement('button'); button.type='button'; button.className='cz-step-error';
      button.textContent=`${generator.schema[field.dataset.field].label ?? field.dataset.field}: ${message}`;
      button.addEventListener('click',()=>{
        if (generator.schema[field.dataset.field].advanced) root.querySelector('[data-level="advanced"]')?.click();
        show(section.key); field.closest('.cz-group')?.querySelector('[aria-expanded="false"]')?.click();
        const detail = field.closest('details'); if (detail) detail.open = true;
        field.scrollIntoView({block:'center'});
        (field.querySelector('button[role=radio][aria-checked=true], button.cz-picker-toggle') ?? field.querySelector('input:not([type=range]), textarea'))?.focus({preventScroll:true});
      }); errors.append(button);
    }
    errors.hidden = !errors.childElementCount;
    for (const s of sections) {
      const visible=s.keys.some(key=>!formEl.querySelector(`[data-field="${CSS.escape(key)}"]`)?.hidden);
      const button=nav.querySelector(`[data-editing-section="${s.key}"]`);
      button.hidden=!visible;
    }
    const following=available();
    if (active!=='all' && active!=='review' && !following.some(section=>section.key===active)) {
      show(following[0]?.key ?? 'review');
      return;
    }
    const currentIndex=following.findIndex(s=>s.key===active);
    back.hidden=active==='all'||(active!=='review'&&currentIndex<=0);
    next.textContent=`Next: ${following[currentIndex+1]?.label ?? 'Review'}`;
  }
  function show(key) {
    active=key; root.dataset.editing=key; root.dataset.sheetTab=key==='review'?'info':'settings';
    // Legacy request shortcut must not suppress the new settings surface.
    root.querySelector('.cz-request-review')?.classList.remove('cz-request-review');
    settings.hidden=key==='review'; info.hidden=key!=='review';
    for (const body of root.querySelectorAll('.cz-win-body')) { body.hidden=false; body.style.removeProperty('height'); }
    for (const win of root.querySelectorAll('.cz-win')) win.classList.remove('is-collapsed');
    const all=key==='all';
    form.setMode(all?(form.getMode()==='section'?'section':'category'):'studio',{animate:false});
    for (const button of root.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed',String(button.dataset.mode===form.getMode()));
    form.setEditingSection(all||key==='review'?null:key);
    for (const button of nav.querySelectorAll('[data-editing-section]')) {
      if(button.dataset.editingSection===key) button.setAttribute('aria-current','step'); else button.removeAttribute('aria-current');
    }
    expert.setAttribute('aria-pressed',String(all));
    if (productChange) {
      productChange.textContent = key === 'review' ? 'Change settings' : 'Review design';
      productChange.setAttribute('aria-expanded', String(key !== 'review'));
    }
    const index=sections.findIndex(s=>s.key===key);
    back.hidden=index===0||all;
    next.hidden=key==='review'||all;
    next.textContent=`Next: ${sections[index+1]?.label ?? 'Review'}`;
    footer.hidden=all;
    update();
  }
  nav.addEventListener('click',event=>{const button=event.target.closest('[data-editing-section]');if(button)show(button.dataset.editingSection);});
  expert.addEventListener('click',()=>show(active==='all'?sections[0].key:'all'));
  next.addEventListener('click',()=>{const list=available();const index=list.findIndex(s=>s.key===active);show(list[index+1]?.key??'review');nav.querySelector('[aria-current]')?.focus();});
  back.addEventListener('click',()=>{const list=available();const index=active==='review'?list.length:list.findIndex(s=>s.key===active);show(list[Math.max(0,index-1)]?.key??sections[0].key);nav.querySelector('[aria-current]')?.focus();});
  formEl.addEventListener('cz-form-updated',()=>queueMicrotask(update));
  formEl.addEventListener('cz-section-revealed',event=>show(event.detail));
  // The previous overlay windows no longer control visibility or centering.
  root.querySelector('#cz-sheet-tabs')?.setAttribute('hidden','');
  for (const el of root.querySelectorAll('.cz-win-toggle')) {
    el.setAttribute('aria-expanded','true');
    el.addEventListener('click',()=>show(el.closest('[data-win]').dataset.win==='info'?'review':'all'));
  }
  const gallery=root.querySelector('#cz-designs-toggle');
  if(gallery?.getAttribute('aria-expanded')==='true')gallery.click();
  productChange?.addEventListener('click',event=>{event.stopImmediatePropagation();show(active==='review'?sections[0].key:'review');productChange.textContent=active==='review'?'Change settings':'Review design';productChange.setAttribute('aria-expanded',String(active!=='review'));},true);
  show(active);
  return { reveal: name=>show(name==='info'?'review':active==='review'?sections[0].key:active), showTab:name=>show(name==='info'?'review':sections[0].key), layoutSoon(){}, isNarrow:()=>false, isCollapsed:()=>false, setCollapsed(){}, update };
}
