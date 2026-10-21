import * as sdk from '@vercel/blob';
import { exportObjects, restoreObjects, validateObjects, exportObjectStream } from '../lib/platform/blob-recovery.js';
import { once } from 'node:events';

async function* lines() {
  let pending=Buffer.alloc(0);
  for await(const chunk of process.stdin) {
    pending=Buffer.concat([pending,chunk]);
    if(pending.length>96*1024*1024)throw Error('Record bound');
    let index;
    while((index=pending.indexOf(10))!==-1){yield JSON.parse(pending.subarray(0,index).toString());pending=pending.subarray(index+1);}
  }
  if(pending.length)throw Error('Incomplete stream');
}

try {
  const mode=process.argv[2];
  if(mode==='export-stream') {
    if(!process.env.BLOB_READ_WRITE_TOKEN)throw Error('Private store required');
    const input=[];let size=0;
    for await(const chunk of process.stdin){size+=chunk.length;if(size>8*1024*1024)throw Error('Required paths bound');input.push(chunk);}
    const required=JSON.parse(Buffer.concat(input).toString());
    for await(const record of exportObjectStream(sdk,required))if(!process.stdout.write(JSON.stringify(record)+'\n'))await once(process.stdout,'drain');
  }else if(mode==='restore-stream'||mode==='verify-stream') {
    if(mode==='restore-stream'&&(process.argv[3]!=='--apply'||!process.env.BLOB_READ_WRITE_TOKEN))throw Error('Explicit private restore required');
    let header=false,footer=false,count=0;const seen=new Set();
    for await(const record of lines()) {
      if(!header){if(record.type!=='header'||record.version!==1)throw Error('Header required');header=true;continue;}
      if(footer)throw Error('Trailing records');
      if(record.type==='footer'){if(record.version!==1||record.objects!==count)throw Error('Footer mismatch');footer=true;continue;}
      if(record.type!=='object'||seen.has(record.pathname))throw Error('Unexpected object');
      seen.add(record.pathname);const archive={version:1,objects:[record]};validateObjects(archive);
      if(mode==='restore-stream')await restoreObjects(archive,sdk);
      count++;
    }
    if(!header||!footer)throw Error('Incomplete stream');
    console.log(JSON.stringify({verifiedObjects:count,restored:mode==='restore-stream'}));
  }else if(!['export','verify','restore'].includes(mode))throw Error('Mode required');
  else if(mode==='export') {
    if(!process.env.BLOB_READ_WRITE_TOKEN)throw Error('Private store required');
    process.stdout.write(JSON.stringify(await exportObjects(sdk)));
  }else {
    const chunks=[];let size=0;
    for await(const chunk of process.stdin){size+=chunk.length;if(size>96*1024*1024)throw Error('Archive bound');chunks.push(chunk);}
    const archive=JSON.parse(Buffer.concat(chunks).toString());
    if(mode==='restore') {
      if(process.argv[3]!=='--apply'||!process.env.BLOB_READ_WRITE_TOKEN)throw Error('Explicit restore required');
      console.log(JSON.stringify(await restoreObjects(archive,sdk)));
    }else console.log(JSON.stringify({verifiedObjects:validateObjects(archive).length}));
  }
}catch{console.error('Private object recovery failed; diagnostics suppressed.');process.exitCode=1;}
