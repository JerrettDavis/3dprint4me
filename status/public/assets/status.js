const endpoint='https://status-api.3dprint4.me/api/public';
const states={operational:'Operational',degraded:'Degraded',unavailable:'Unavailable',unknown:'Not verified'};
const summaries={operational:'All monitored services are operational',degraded:'Some services need attention',unavailable:'A service interruption is being checked',unknown:'Fresh service evidence is incomplete'};
const select=document.querySelector('select'),refresh=document.querySelector('#refresh');
try{select.value=localStorage.getItem('status-theme')??'system';}catch{}
function theme(){if(select.value==='system')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=select.value;}
select.addEventListener('change',()=>{theme();try{localStorage.setItem('status-theme',select.value);}catch{}});theme();
let snapshot,busy=false;
const stamp=value=>Number.isFinite(value)?new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'Not recorded';
function draw(){
  if(!snapshot)return;
  const now=Date.now(),components=snapshot.components.slice(0,12).map(component=>({...component,status:Number.isFinite(component.checkedAt)&&now-component.checkedAt<=720000&&component.checkedAt<=now+30000&&states[component.status]?component.status:'unknown'}));
  const values=components.map(x=>x.status),overall=values.includes('unavailable')?'unavailable':values.includes('degraded')?'degraded':values.includes('unknown')||!values.length?'unknown':'operational';
  document.querySelector('.summary').dataset.state=overall;
  document.querySelector('#summary-title').textContent=summaries[overall];
  document.querySelector('#summary').textContent=overall==='unknown'?'A service is missing fresh evidence. Unverified checks stay visible.':'Based on dated checks from the independent monitor.';
  document.querySelector('#checked').textContent='Last scheduled check · '+stamp(snapshot.checkedAt);
  const list=document.querySelector('#components');list.replaceChildren();
  for(const component of components){const row=document.createElement('li'),name=document.createElement('span'),badge=document.createElement('span');row.dataset.status=component.status;name.className='service-name';name.textContent=String(component.name).slice(0,120);badge.className='badge';badge.textContent=states[component.status];if(component.scope){const scope=document.createElement('small');scope.className='scope';scope.textContent=String(component.scope).slice(0,120);name.append(scope);}row.append(name,badge);list.append(row);}
  const history=document.querySelector('#history');history.replaceChildren();
  for(const day of (snapshot.history??[]).slice(-30)){const bar=document.createElement('span');bar.dataset.failed=String(day.failed>0);bar.title=`${day.day}: ${day.checks} checks, ${day.failed} with a failure`;bar.setAttribute('aria-label',bar.title);history.append(bar);}
  if(!history.childElementCount){const text=document.createElement('p');text.textContent='History will appear as scheduled checks arrive.';history.append(text);}
  const incidents=document.querySelector('#incidents');incidents.replaceChildren();
  for(const incident of (snapshot.incidents??[]).slice(-20).reverse()){const row=document.createElement('li');row.textContent=`${String(incident.component).slice(0,80)} · ${incident.resolvedAt?'Recovered '+stamp(incident.resolvedAt):'Open since '+stamp(incident.openedAt)}`;incidents.append(row);}
  document.querySelector('#incidents-section').hidden=!incidents.childElementCount;
}
async function update(){
  if(busy)return;busy=true;refresh.disabled=true;
  try{const response=await fetch(endpoint,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error();const text=await response.text();if(text.length>32768)throw new Error();const data=JSON.parse(text);if(data.version!==1||!Array.isArray(data.components))throw new Error();snapshot=data;document.querySelector('#refresh-error').hidden=true;draw();}
  catch{const error=document.querySelector('#refresh-error');error.textContent='Status evidence could not be refreshed. Any older evidence remains dated and expires automatically.';error.hidden=false;draw();}
  finally{busy=false;refresh.disabled=false;}
}
refresh.addEventListener('click',update);setInterval(draw,15000);setInterval(update,60000);update();
