export function takeInquiryText(storage) {
  try {
    const raw=storage.getItem('3dp-inquiry-text-v1');storage.removeItem('3dp-inquiry-text-v1');
    if(!raw||raw.length>12000)return null;
    const value=JSON.parse(raw);
    if(!value||typeof value!=='object'||Array.isArray(value))return null;
    const text=(key,max)=>typeof value[key]==='string'?value[key].slice(0,max):'';
    let modelUrl='';try{const url=new URL(text('referenceUrl',2000));if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)modelUrl=url.href;}catch{}
    return {name:text('name',120),email:text('email',254),description:text('message',5000),modelUrl,service:'',terms:false};
  }catch{return null;}
}

// Capabilities live only in this closure. Never put them in form fields or browser storage.
export function captureInquiryHandoff({location=window.location,history=window.history,fetchImpl=(...args)=>fetch(...args)}={}) {
  const present=location.hash.startsWith('#inquiry=');
  let token=present?location.hash.slice(9):null;
  if(present) history.replaceState(null,'',location.pathname+location.search);
  async function action(body) {
    const response=await fetchImpl('/api/inquiry?kind=handoff',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',signal:AbortSignal.timeout(15000),body:JSON.stringify({...body,token})});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(payload.error||'This invitation is unavailable. Ask us for a fresh link.');
    return payload;
  }
  return {
    present, token:()=>token,
    async load() {
      if(!present)return null;
      if(!/^[a-f0-9]{64}$/.test(token||'')){token=null;throw new Error('This invitation is invalid. Ask us for a fresh link.');}
      const context=await action({action:'read'});
      if(context.completed)return {completed:true,id:context.id};
      const q=context.inquiry;
      return {...context,prefill:{service:context.project?.service||'',projectTitle:context.project?.title||'',description:q.message||'',name:q.name||'',email:q.replyEmail||'',modelUrl:q.referenceUrl||'',terms:false}};
    },
    download:index=>action({action:'file',index})
  };
}
