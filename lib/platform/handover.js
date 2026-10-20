import { HttpError } from '../http.js';

// Hold requests before any database operation while the final source snapshot is
// fenced and restored. A failed drain reopens the gate before a switch can occur.
export function createHandoverGate({maxQueue=50,queueTimeoutMs=25000}={}) {
  let paused=false,active=0,switching=false;
  const waiting=new Set(),drainers=new Set();
  function resume() {
    if(switching)throw new HttpError(409,'Database handover is in progress.');
    paused=false;for(const item of waiting){clearTimeout(item.timer);item.resolve();}waiting.clear();
  }
  return {
    async run(operation) {
      while(paused) {
        if(waiting.size>=maxQueue)throw new HttpError(503,'The service is temporarily unavailable.');
        await new Promise((resolve,reject)=>{
          const item={resolve};
          item.timer=setTimeout(()=>{waiting.delete(item);reject(new HttpError(503,'The service is temporarily unavailable.'));},queueTimeoutMs);
          waiting.add(item);
        });
      }
      active++;
      try{return await operation();}
      finally{active--;if(active===0){for(const notify of drainers)notify();drainers.clear();}}
    },
    async pause({timeoutMs=35000}={}) {
      if(switching)throw new HttpError(409,'Database handover is in progress.');
      paused=true;if(active===0)return;
      let timer,notify;
      try {
        await new Promise((resolve,reject)=>{
          notify=resolve;drainers.add(notify);
          timer=setTimeout(()=>reject(new HttpError(503,'Database handover could not drain active work.')),timeoutMs);
        });
      }catch(error){resume();throw error;}
      finally{clearTimeout(timer);drainers.delete(notify);}
    },
    async activate(operation) {
      if(!paused||active!==0||switching)throw new HttpError(409,'Database handover requires a drained service.');
      switching=true;
      try{return await operation();}finally{switching=false;}
    },
    resume,
    status:()=>({paused,active,queued:waiting.size,switching})
  };
}
