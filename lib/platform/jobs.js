export function createPlatformJobs({env=process.env,drain,cleanup,expire,now=()=>Date.now(),onError=()=>{}}) {
  let running=false;
  const next={push:-Infinity,expiry:-Infinity,cleanup:-Infinity};
  const schedule=[['push',15000,drain],['expiry',60000,expire],['cleanup',6*3600000,cleanup]];
  return {async tick() {
    if(env.PLATFORM_JOBS_ENABLED!=='1'||running)return;
    running=true;
    try {
      for(const [name,interval,operation] of schedule) {
        if(now()<next[name])continue;
        next[name]=now()+interval;
        try{await operation();}catch{onError(name);}
      }
    }finally{running=false;}
  }};
}
