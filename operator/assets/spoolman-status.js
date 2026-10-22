import { el, button, message, perform } from './filament-ui.js';
export function renderSpoolmanStatus(sync, { role, onRefresh, onReload }) {
  const panel=el('section','filament-settings'); panel.append(el('h3','','Spoolman sync'));
  const state=sync ?? {configured:false}, age=Date.now()-Date.parse(state.lastSuccessAt), stale=!Number.isFinite(age)||age>=300000||age<0;
  const running=state.leaseUntil && Date.parse(state.leaseUntil)>Date.now();
  const label=!state.configured?'Not configured · manual inventory is available':state.requestedAt?'Refresh queued':running?'Sync in progress':state.failureCode?'Sync failed · last successful inventory retained':stale?'Stock is stale · refresh before confirming availability':'Up to date';
  panel.append(el('p','',label));
  if(state.configured)panel.append(el('p','print-meta',`${state.count ?? 0} source spools · Last complete sync: ${state.lastSuccessAt ? new Date(state.lastSuccessAt).toLocaleString() : 'Never'}`));
  const output=message(panel);
  if(role==='owner' && state.configured && onRefresh)button(panel,'Refresh from Spoolman',()=>perform(output,onRefresh,'Refresh queued. Reload inventory to check completion.'));
  if(onReload)button(panel,'Reload inventory',onReload);
  return panel;
}
