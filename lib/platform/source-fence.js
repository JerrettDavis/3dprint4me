import { BUSINESS_TABLES } from './activation.js';

const fenceName='platform_migration_readonly';
const functionBody="BEGIN\n  RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='The source is read-only during database migration.';\nEND;";
async function verifySource(client) {
  const {rows:tables}=await client.query(`SELECT tablename,tableowner=current_user AS owned
    FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
  const expected=[...BUSINESS_TABLES].sort();
  if(tables.length!==expected.length||tables.some((t,index)=>t.tablename!==expected[index]||!t.owned))throw new Error('Source schema identity does not match.');
  const {rows:[identity]}=await client.query(`SELECT current_database() AS database,current_user AS role,rolsuper
    FROM pg_roles WHERE rolname=current_user`);
  if(!identity||identity.rolsuper)throw new Error('A non-superuser source owner is required.');
  const {rows:[definers]}=await client.query(`SELECT count(*)::int AS count FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef`);
  if(definers.count!==0)throw new Error('Source SECURITY DEFINER functions require separate review.');
  return {method:'always-statement-triggers-v1',database:identity.database,role:identity.role,tables:expected};
}
async function verifyFence(client) {
  const {rows:[fn]}=await client.query(`SELECT p.oid,p.prosrc,p.prosecdef,p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=$1 AND p.pronargs=0`,[fenceName]);
  if(!fn||fn.prosrc!==functionBody||fn.prosecdef||!fn.owned)throw new Error('Source fence function identity does not match.');
  const {rows:triggers}=await client.query(`SELECT c.relname,t.tgenabled,t.tgtype FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE t.tgfoid=$1 ORDER BY c.relname`,[fn.oid]);
  const expected=[...BUSINESS_TABLES].sort();
  if(triggers.length!==expected.length||triggers.some((t,i)=>t.relname!==expected[i]||t.tgenabled!=='A'||t.tgtype!==62))throw new Error('The source write fence is incomplete.');
}
export async function fenceSource(client) {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout='5s'");
    const proof=await verifySource(client);
    await client.query(`LOCK TABLE ${[...BUSINESS_TABLES].sort().map(name=>`public.${name}`).join(',')} IN ACCESS EXCLUSIVE MODE`);
    // Owner ACL revocation cannot fence pg_write_all_data. ALWAYS statement
    // triggers also cover other granted roles, COPY and replica-mode sessions.
    await client.query(`CREATE FUNCTION public.${fenceName}() RETURNS trigger LANGUAGE plpgsql AS $$${functionBody}$$`);
    await client.query(`REVOKE ALL ON FUNCTION public.${fenceName}() FROM PUBLIC`);
    for(const name of [...BUSINESS_TABLES].sort()) {
      await client.query(`CREATE TRIGGER ${fenceName} BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.${name} FOR EACH STATEMENT EXECUTE FUNCTION public.${fenceName}()`);
      await client.query(`ALTER TABLE public.${name} ENABLE ALWAYS TRIGGER ${fenceName}`);
    }
    await verifyFence(client);
    await client.query('SAVEPOINT platform_fence_probe');
    let blocked=false;
    try{await client.query('UPDATE public.service_requests SET id=id WHERE false');}
    catch(error){if(error.code!=='55000')throw error;blocked=true;}
    await client.query('ROLLBACK TO SAVEPOINT platform_fence_probe');await client.query('RELEASE SAVEPOINT platform_fence_probe');
    if(!blocked)throw new Error('The source still accepts writes.');
    const {rows:[result]}=await client.query(`SELECT json_build_object(${BUSINESS_TABLES.map(name=>`'${name}',(SELECT count(*) FROM public.${name})`).join(',')}) AS counts`);
    await client.query('COMMIT');return {counts:result.counts,proof};
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
}
export async function restoreSourceWrites(client,{targetAcceptedWrites,proof,getTargetSelection}={}) {
  if(targetAcceptedWrites!==false||!proof||typeof getTargetSelection!=='function'||await getTargetSelection())throw new Error('Reopening the source requires proof that target selection and writes have not started.');
  await client.query('BEGIN');
  try {
    const identity=await verifySource(client);
    if(JSON.stringify(identity)!==JSON.stringify(proof))throw new Error('The source fence proof does not match.');
    await verifyFence(client);
    for(const name of [...BUSINESS_TABLES].sort())await client.query(`DROP TRIGGER ${fenceName} ON public.${name}`);
    await client.query(`DROP FUNCTION public.${fenceName}()`);
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
}

// pg_dump includes the temporary fence. Remove it only in the separately named
// restored target, before applying new migrations or opening application writes.
export async function releaseRestoredSourceFence(client,{proof}={}) {
  await client.query('BEGIN');
  try {
    const identity=await verifySource(client);
    if(!proof||proof.method!==identity.method||identity.role!=='platform_owner'||
      !/^platform_live_[a-z0-9_]{1,48}$/.test(identity.database)||identity.database===proof.database||
      JSON.stringify(identity.tables)!==JSON.stringify(proof.tables))throw new Error('Only a separately restored target can release this fence.');
    await verifyFence(client);
    for(const name of [...BUSINESS_TABLES].sort())await client.query(`DROP TRIGGER ${fenceName} ON public.${name}`);
    await client.query(`DROP FUNCTION public.${fenceName}()`);
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
}
