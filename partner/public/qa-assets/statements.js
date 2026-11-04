export async function mountStatementHistory({root,client,escape,announce,download,isCurrent,onUnauthorized,before=null}) {
 root.innerHTML='<h2>Weekly statements</h2><p role="status">Loading saved snapshots…</p>';
 try {
  const data=await client.read('statements',before?{before}:{});if(!isCurrent())return;
  root.innerHTML=`<h2>Weekly statements</h2><p>Saved balance snapshots are separate from current earnings. Each shows its actual as-of time. Later payments and corrections do not rewrite an earlier statement. Gifts are excluded.</p><ul class="records">${(data.items??[]).map(s=>`<li><strong>Week of ${escape(s.weekStart)} (Central Monday)</strong><p>Balances as of ${escape(s.asOf)}.</p><button data-weekly-statement="${escape(s.id)}">Download statement for ${escape(s.weekStart)}</button></li>`).join('')||'<li>No scheduled snapshots yet. You can still download a current statement above.</li>'}</ul>${data.nextCursor?'<button type="button" data-older>Older statements</button>':''}${before?'<button type="button" data-newest>Newest statements</button>':''}`;
  const openPage=cursor=>{if(isCurrent())mountStatementHistory({root,client,escape,announce,download,isCurrent,onUnauthorized,before:cursor});};
  const older=root.querySelector('[data-older]'),newest=root.querySelector('[data-newest]');if(older)older.onclick=()=>openPage(data.nextCursor);if(newest)newest.onclick=()=>openPage(null);
  for(const button of root.querySelectorAll('[data-weekly-statement]')){
   let busy=false;
   button.addEventListener('click',async()=>{
    if(busy||!isCurrent())return;busy=true;button.disabled=true;
    try {
     const id=button.dataset.weeklyStatement,data=await client.read('statements',{id});if(!isCurrent())return;
     if(data.id!==id||typeof data.csv!=='string'||!/^[a-f0-9]{64}$/.test(data.sha256)||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id))throw Error('Statement integrity check failed. Reopen the original snapshot.');
     const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data.csv))),b=>b.toString(16).padStart(2,'0')).join('');
     if(!isCurrent())return;
     if(hash!==data.sha256)throw Error('Statement integrity check failed. Reopen the original snapshot.');
     download(`partner-weekly-statement-${id}.csv`,data.csv,'text/csv;charset=utf-8');announce('Verified weekly statement downloaded. Store it privately.');
    }catch(error){if(!isCurrent())return;if(error.status===401)await onUnauthorized();else announce(error.message,true);}
    finally{busy=false;button.disabled=false;}
   });
  }
 }catch(error){
  if(!isCurrent())return;
  if(error.status===401){await onUnauthorized();return;}
  root.innerHTML='<h2>Weekly statements</h2><p>Saved statements are unavailable. Your current earnings above remain available.</p><button type="button">Try loading statements again</button>';
  root.querySelector('button').onclick=()=>{if(isCurrent())mountStatementHistory({root,client,escape,announce,download,isCurrent,onUnauthorized});};
 }
}
