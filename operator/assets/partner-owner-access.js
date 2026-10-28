// One-time credentials are intentionally not stored or replayed as ordinary edits.
const IDENTITY_TEXT='I verified the identity of this partner and understand that issuing a code replaces all unused codes.';
const CHANGE_TEXT='I understand that this ends access and invalidates unused codes without changing amounts owed.';
export function mountPartnerAccess({root,account,enrollmentAllowed,api,isCurrent,onUnauthorized,refresh,announce}){
 let disposed=false,busy=false,timer=null,issueEpoch=0;
 const heading=document.createElement('h3');heading.textContent='Private access';root.append(heading);
 const copy=document.createElement('p');copy.textContent='Use the agreed identity-check process before handing over a code. Every issue replaces all unused codes. Codes expire after 30 minutes and are shown only in this owner view.';root.append(copy);
 const secret=document.createElement('div');secret.className='owner-access-code';secret.setAttribute('aria-live','polite');
 const live=()=>!disposed&&isCurrent()&&api.signedIn;
 function clearSecret(text='Code hidden. It is not saved here. Recheck identity and issue a replacement if private handoff was not completed.'){
  issueEpoch++;
  if(timer!==null){clearTimeout(timer);timer=null;}
  const focused=secret.contains(document.activeElement);
  for(const field of secret.querySelectorAll('input'))field.value='';
  const hadCode=secret.querySelector('input');secret.replaceChildren();
  if(hadCode){const note=document.createElement('p');note.textContent=text;secret.append(note);}
  if(focused&&live()&&!document.hidden)issueButton?.focus();
 }
 const issueForm=document.createElement('form');issueForm.dataset.accessIssue='';
 let issueButton=null,identity=null;
 const purpose=account.status==='invited'?'enroll':'recover';
 const canIssue=account.status==='invited'?enrollmentAllowed:['active','suspended'].includes(account.status);
 if(canIssue){
  const note=document.createElement('p');note.textContent=purpose==='recover'?'Recovery resets the passphrase and invalidates earlier sessions when redeemed. A suspended account stays blocked until the fresh code is redeemed.':'Enrollment is subject to program clearance again when the code is redeemed.';
  const label=document.createElement('label');label.className='owner-check';identity=document.createElement('input');identity.type='checkbox';identity.required=true;label.append(identity,document.createTextNode(IDENTITY_TEXT));
  issueButton=document.createElement('button');issueButton.type='submit';issueButton.textContent=purpose==='recover'?'Issue recovery code':'Issue enrollment code';
  issueForm.append(note,label,issueButton);root.append(issueForm);
  issueForm.onsubmit=async event=>{
   event.preventDefault();if(busy||!live()||!identity.checked)return;
   clearSecret();const intent=issueEpoch,controls=freeze();identity.checked=false;
   try{
    const result=await api.command('partner.invite',{partnerId:account.id,purpose},crypto.randomUUID());
    if(!live())return;
    if(intent!==issueEpoch||document.hidden){announce('Code delivery was interrupted. Recheck identity before issuing a replacement.',true);return;}
    const expires=new Date(result.expiresAt).getTime(),remaining=expires-Date.now();
    if(typeof result.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(result.token)||result.partnerId!==account.id||result.purpose!==purpose||!Number.isFinite(remaining)||remaining<=0)throw Error('The code could not be displayed. Recheck identity before issuing a replacement.');
    showCode(result.token,result.expiresAt,purpose);timer=setTimeout(()=>clearSecret('This code display expired. The server also enforces code expiry.'),Math.min(remaining,30*60000));
    announce('One-time code ready for private handoff.');
   }catch(error){if(disposed||!isCurrent())return;if([401,403].includes(error.status))onUnauthorized(error);else announce(error.status===0?'The code response was not received. Recheck identity before issuing a replacement; any previous code may already be invalid.':error.message,true);}
   finally{thaw(controls);}
  };
 }else{
  const note=document.createElement('p');note.textContent=account.status==='invited'?'Enrollment is unavailable until program clearance is complete.':'Revoked accounts cannot use old credentials, unused codes or recovery. Existing obligations remain for lawful settlement.';root.append(note);
 }
 root.append(secret);
 if(account.status!=='revoked'){
  const form=document.createElement('form');form.dataset.accessChange='';
  const label=document.createElement('label');label.append(document.createTextNode('Access change'));const select=document.createElement('select');select.name='status';
  for(const [value,title]of [['suspended','Suspend portal access'],['revoked','Revoke portal access']]){if(account.status===value)continue;const option=document.createElement('option');option.value=value;option.textContent=title;select.append(option);}label.append(select);
  const warning=document.createElement('p');warning.textContent='Suspension ends existing sessions and unused codes; fresh owner-issued recovery is required to restore access. Revocation also blocks recovery. Neither action changes accepted work or amounts owed.';
  const confirm=document.createElement('label');confirm.className='owner-check';const check=document.createElement('input');check.type='checkbox';check.required=true;confirm.append(check,document.createTextNode(CHANGE_TEXT));
  const button=document.createElement('button');button.textContent='Apply access change';button.type='submit';form.append(label,warning,confirm,button);root.append(form);
  form.onsubmit=async event=>{
   event.preventDefault();if(busy||!live()||!check.checked)return;
   const status=select.value;clearSecret();const controls=freeze();check.checked=false;
   try{await api.command('partner.revoke',{partnerId:account.id,status},crypto.randomUUID());if(!live())return;const current=await refresh();if(current)announce(`Portal access ${status}. Existing obligations are unchanged.`);}
   catch(error){if(disposed||!isCurrent())return;if([401,403].includes(error.status))onUnauthorized(error);else announce(error.status===0?'The access change could not be confirmed. Reload account records before taking another access action.':error.message,true);}
   finally{thaw(controls);}
  };
 }
 function freeze(){busy=true;const controls=[...root.querySelectorAll('input,select,button')].map(field=>[field,field.disabled]);for(const [field]of controls)field.disabled=true;return controls;}
 function thaw(controls){busy=false;for(const [field,disabled]of controls)field.disabled=disabled;}
 function showCode(token,expiresAt,kind){
  secret.replaceChildren();const title=document.createElement('h4');title.textContent=kind==='recover'?'Private recovery handoff':'Private enrollment handoff';
  const label=document.createElement('label');label.append(document.createTextNode(kind==='recover'?'One-time recovery code':'One-time enrollment code'));
  const field=document.createElement('input');field.type='password';field.readOnly=true;field.autocomplete='off';field.spellcheck=false;field.value=token;label.append(field);
  const note=document.createElement('p');note.textContent=`Expires ${new Date(expiresAt).toLocaleString()}. Open https://partners.3dprint4.me/join separately and enter the code there. Never put the code in a URL or public message.`;
  const buttons=document.createElement('div');buttons.className='owner-actions';
  const reveal=document.createElement('button');reveal.type='button';reveal.textContent='Reveal code';reveal.onclick=()=>{field.type=field.type==='password'?'text':'password';reveal.textContent=field.type==='password'?'Reveal code':'Mask code';};
  const select=document.createElement('button');select.type='button';select.textContent='Select code';select.onclick=()=>{field.type='text';reveal.textContent='Mask code';field.focus();field.select();};
  const hide=document.createElement('button');hide.type='button';hide.textContent='Hide and clear code';hide.onclick=()=>clearSecret();buttons.append(reveal,select,hide);secret.append(title,label,note,buttons);
 }
 const conceal=()=>{if(document.hidden){if(identity)identity.checked=false;clearSecret('Code hidden because this page is no longer visible. Recheck identity before issuing a replacement if needed.');}};
 const leaving=()=>clearSecret();document.addEventListener('visibilitychange',conceal);addEventListener('pagehide',leaving);
 return ()=>{disposed=true;if(identity)identity.checked=false;clearSecret();document.removeEventListener('visibilitychange',conceal);removeEventListener('pagehide',leaving);};
}
