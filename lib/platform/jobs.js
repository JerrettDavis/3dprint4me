export function createPlatformJobs({env=process.env,drain,cleanup,expire,spoolman,now=()=>Date.now(),onError=()=>{}}) {
  const running=new Set();
  const next={push:-Infinity,expiry:-Infinity,cleanup:-Infinity,spoolman:-Infinity};
  const schedule=[['push',15000,drain],['expiry',60000,expire],['cleanup',6*3600000,cleanup],...(spoolman?[['spoolman',5000,spoolman]]:[])];
  return {async tick() {
    if(env.PLATFORM_JOBS_ENABLED!=='1')return;
    const started=[];
    for(const [name,interval,operation] of schedule) {
      if(running.has(name)||now()<next[name])continue;
      next[name]=now()+interval;running.add(name);
      started.push((async()=>{try{await operation();}catch{onError(name);}finally{running.delete(name);}})());
    }
    await Promise.all(started);
  }};
}
