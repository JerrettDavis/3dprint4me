import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const names=new Set(['push','expiry','cleanup','slicer']);
async function record(name,ok,{env,now},result) {
  if(!env.PLATFORM_JOB_HEALTH_DIR)return;
  if(!names.has(name))throw new Error('Unknown job.');
  try{
    const directory=env.PLATFORM_JOB_HEALTH_DIR;
    await mkdir(directory,{recursive:true,mode:0o750});
    const target=join(directory,name+'.json'),temporary=join(directory,'.'+name+'.tmp');
    const counts={};
    for(const key of ['claimed','ready','delivered','failed','retrying','errors'])if(Number.isSafeInteger(result?.[key])&&result[key]>=0)counts[key]=result[key];
    if(['failed','retrying','errors'].some(key=>counts[key]>0))ok=false;
    // An idle poll does not demonstrate recovery from failed processing.
    if(ok&&counts.claimed===0) {
      try{const previous=JSON.parse(await readFile(target,'utf8'));if(previous.ok===false)ok=false;}catch{/* No prior evidence. */}
    }
    await writeFile(temporary,JSON.stringify({name,ok,observedAt:now(),counts}),{mode:0o640});
    await rename(temporary,target);
  }catch{console.error('Job health evidence could not be recorded.');}
}
export async function observeJob(name,operation,{env=process.env,now=()=>Date.now()}={}) {
  try{const result=await operation();await record(name,true,{env,now},result);return result;}
  catch(error){await record(name,false,{env,now});throw error;}
}
export async function readJobHealth(name,{directory,now=Date.now(),maxAge}={}) {
  try{
    if(!names.has(name)||!directory)return {ok:false};
    const text=await readFile(join(directory,name+'.json'),'utf8');if(text.length>512)return {ok:false};
    const data=JSON.parse(text);
    return {ok:data.name===name&&data.ok===true&&Number.isSafeInteger(data.observedAt)&&now-data.observedAt<=maxAge&&data.observedAt<=now+30000};
  }catch{return {ok:false};}
}
