const drafts=new Map();
export function clearCommunicationDrafts(){drafts.clear();}
function el(tag,cls,text){const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node;}
const labels={private:'Private comment',pending:'Saved · not sent',sending:'Sending · refresh to check',sent:'Accepted by email provider',failed:'Email failed · not sent',uncertain:'Delivery uncertain · check shop email',unconfigured:'Email is not configured · message saved'};
export function renderCommunications({item,request,inquiry,api,onAuthError}) {
 const section=el('section','conversation-sheet');section.setAttribute('aria-labelledby','conversation-title');
 const heading=el('h3','','Conversation');heading.id='conversation-title';
 const recipient=request?.contact?.email??inquiry?.replyEmail;
 const history=el('ol','conversation-history'),status=el('p','work-meta');status.setAttribute('role','status');
 const draft=drafts.get(item.id)??{body:'',command:null};drafts.set(item.id,draft);
 const form=el('form','conversation-composer'),label=el('label','','Message'),input=el('textarea');input.id='client-message';label.htmlFor=input.id;input.rows=4;input.maxLength=8000;input.required=true;input.value=draft.body;
 input.oninput=()=>{draft.body=input.value;draft.command=null;};
 const actions=el('div','conversation-actions'),comment=el('button','','Add private comment'),send=el('button','primary','Send email to client');comment.type='button';send.type='submit';send.disabled=!recipient;
 const address=el('p','work-meta',recipient?`Email to ${recipient}. Replies arrive in the shop email inbox.`:'No client email is available. Private comments can still be saved.');
 async function fail(error){if(!section.isConnected)return;if(['signed-out','forbidden'].includes(error.kind)){drafts.clear();onAuthError();return;}status.textContent=error.message;}
 async function load(){try{const result=await api.listCommunications(item.id);if(!section.isConnected)return;history.replaceChildren();for(const message of result.messages){
   const row=el('li',`conversation-message conversation-${message.kind}`),meta=el('p','work-meta',`${message.author} · ${new Date(message.createdAt).toLocaleString()} · ${labels[message.state]??message.state}`);
   row.append(meta,el('p','conversation-body',message.body));if(message.recipient)row.append(el('p','work-meta',`To: ${message.recipient}`));
   const copy=el('button','','Copy message');copy.type='button';copy.onclick=async()=>{try{await navigator.clipboard.writeText(message.body);status.textContent='Message copied.';}catch{status.textContent='Select the message text above to copy it.';}};row.append(copy);
   if(['pending','failed','uncertain','unconfigured','sending'].includes(message.state)){
     const retry=el('button','','Retry email');retry.type='button';retry.onclick=async()=>{retry.disabled=true;try{await api.retryCommunication(item.id,message.id);await load();}catch(error){await fail(error);}finally{retry.disabled=false;}};row.append(retry);
   }history.append(row);
 }if(!result.messages.length)history.append(el('li','work-meta','No messages yet. Add a private comment or email the client.'));}catch(error){await fail(error);}}
 let busy=false;
 async function submit(kind){if(busy||!form.reportValidity())return;busy=true;comment.disabled=send.disabled=true;input.readOnly=true;status.textContent=kind==='email'?'Saving and sending email…':'Saving private comment…';
   const command=draft.command?.kind===kind?draft.command:{commandId:crypto.randomUUID(),kind,body:input.value};draft.command=command;
   try{const result=await api.createCommunication(item.id,command);if(draft.command===command){draft.body='';draft.command=null;}if(!section.isConnected)return;input.value=draft.body;status.textContent=labels[result.message.state]??'Message saved.';await load();}
   catch(error){await fail(error);}finally{busy=false;comment.disabled=false;send.disabled=!recipient;input.readOnly=false;}
 }
 comment.onclick=()=>submit('comment');form.onsubmit=event=>{event.preventDefault();submit('email');};
 const refresh=el('button','','Refresh conversation');refresh.type='button';refresh.onclick=load;
 actions.append(comment,send);form.append(label,input,address,actions);section.append(heading,history,form,refresh,status);
 queueMicrotask(load);return section;
}
