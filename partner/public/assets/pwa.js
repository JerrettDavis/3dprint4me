let registration,epoch=0;
export function registerPartnerShell(){if(!navigator.serviceWorker)return;registration??=navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'});registration.catch(()=>{});}
async function message(type,expected=epoch){
 if(!navigator.serviceWorker)return false;registerPartnerShell();let timer,channel,cancelled=false;
 try{return await Promise.race([(async()=>{const reg=await registration;if(cancelled||(type==='PREPARE_OFFLINE'&&expected!==epoch))return false;const worker=reg.active??reg.waiting??reg.installing;if(!worker)throw Error('Offline shell unavailable.');return await new Promise((resolve,reject)=>{channel=new MessageChannel();channel.port1.onmessage=event=>event.data?.ok?resolve(true):reject(Error('Offline shell unavailable.'));worker.postMessage({type},[channel.port2]);});})(),new Promise((_,reject)=>{timer=setTimeout(()=>{cancelled=true;reject(Error('Offline shell unavailable.'));},8000);})]);}finally{clearTimeout(timer);cancelled=true;channel?.port1.close();}
}
export const prepareOfflineShell=()=>message('PREPARE_OFFLINE');
export const clearOfflineShell=()=>{++epoch;return message('CLEAR_STATIC_CACHE');};
