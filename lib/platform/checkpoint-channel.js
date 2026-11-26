import {createInterface} from 'node:readline';

// A pipe write is not a durable host checkpoint. The host must fsync the exact
// state and send an acknowledgment before this process performs another effect.
export function createCheckpointChannel({input=process.stdin,output=process.stdout,ackTimeoutMs=5000}={}) {
 const lines=createInterface({input,crlfDelay:Infinity}),iterator=lines[Symbol.asyncIterator]();
 let failed=false,busy=false;
 const next=async()=>{
  if(failed)throw Error('Checkpoint channel unavailable.');
  let timer;
  try{
   const line=await Promise.race([iterator.next(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Checkpoint acknowledgment unavailable.')),ackTimeoutMs);})]);
   if(line.done)throw Error('Checkpoint channel closed.');
   return line.value;
  }catch(error){failed=true;throw error;}
  finally{clearTimeout(timer);}
 };
 return {
  async readInitial(){const line=await next();if(Buffer.byteLength(line)>32768)throw Error('State bound.');return JSON.parse(line);},
  async checkpoint(state){
   if(failed||busy)throw Error('Checkpoint channel unavailable.');
   const line=JSON.stringify(state);if(Buffer.byteLength(line)>32768)throw Error('State bound.');
   busy=true;
   try{
    output.write(line+'\n');
    if(await next()!=='checkpoint-ok'){failed=true;throw Error('Checkpoint was not persisted.');}
   }finally{busy=false;}
  },
  close(){failed=true;lines.close();input.pause();}
 };
}
