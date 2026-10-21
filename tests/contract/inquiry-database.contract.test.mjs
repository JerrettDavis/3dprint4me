import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createNativeDatabase } from '../../lib/database.js';
import { createInquiryStore } from '../../lib/inquiry-store.js';
import { createInquiryHandler } from '../../lib/quick-inquiry/handler.js';

test('quick inquiries use parameterized native SQL and separate authenticated client rate buckets',async()=>{
  const db=new PGlite();
  try {
    for(const migration of ['001_service_requests.sql','002_quick_inquiries.sql','003_work_queue.sql','009_inquiry_workflow.sql'])
      await db.exec(await readFile(new URL('../../neon/migrations/'+migration,import.meta.url),'utf8'));
    const native=createNativeDatabase({pool:{query:(text,values)=>db.query(text,values)}});
    const store=createInquiryStore({query:native.query});
    const handler=createInquiryHandler({store,configured:()=>true,blobConfigured:()=>false,hasDelivery:()=>false});
    for(const [index,ip] of ['192.0.2.1','192.0.2.2'].entries()) {
      const res={setHeader(){},end(body){this.body=JSON.parse(body);}};
      await handler({method:'POST',headers:{'content-type':'application/json','x-forwarded-for':ip},body:{submissionKey:String(index+1).repeat(64),inquiry:{replyEmail:'test@example.com',message:'Native database inquiry'},files:[]}},res);
      assert.equal(res.statusCode,201);assert.equal(res.body.live,false);
      const completed={setHeader(){},end(body){this.body=JSON.parse(body);}};
      await handler({method:'PATCH',headers:{'content-type':'application/json','x-forwarded-for':ip},body:{id:res.body.id,submissionKey:String(index+1).repeat(64)}},completed);
      assert.equal(completed.statusCode,200);assert.equal(completed.body.live,true);
    }
    assert.equal((await db.query('SELECT count(*)::int AS count FROM quick_inquiries')).rows[0].count,2);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM inquiry_rate_limits')).rows[0].count,2);
  }finally{await db.close();}
});
