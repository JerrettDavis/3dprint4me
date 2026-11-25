// Hold at most one bounded record; fragmented input is copied only once per line.
export async function* readJsonRecords(input,{maxRecordBytes=96*1024*1024}={}) {
  let fragments=[],length=0;
  for await(const value of input) {
    const chunk=Buffer.isBuffer(value)?value:Buffer.from(value);
    let offset=0;
    while(offset<chunk.length) {
      const newline=chunk.indexOf(10,offset);
      const end=newline===-1?chunk.length:newline;
      const piece=chunk.subarray(offset,end);
      length+=piece.length;
      if(length>maxRecordBytes)throw Error('Record bound');
      if(piece.length)fragments.push(piece);
      if(newline===-1)break;
      const record=JSON.parse(Buffer.concat(fragments,length).toString());
      fragments=[];length=0;
      yield record;
      offset=newline+1;
    }
  }
  if(length)throw Error('Incomplete stream');
}
