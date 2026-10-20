import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { closeDatabase, nativePoolOptions } from '../database.js';
import { HttpError } from '../http.js';

export const BUSINESS_TABLES=Object.freeze(['filament_inventory','inquiry_rate_limits','notification_deliveries',
  'notification_outbox','operators','print_analysis_jobs','print_assets','print_estimate_rate_buckets',
  'print_estimate_sessions','print_estimates','print_runs','push_subscriptions','quick_inquiries',
  'service_requests','work_actions','work_events','work_items','work_notes']);
const failed=()=>new HttpError(503,'The recovered database could not be activated.');
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export function createDatabaseActivation({env=process.env,
  load=()=>readFile('/run/platform/database-target.private.json','utf8'),
  makePool=options=>new pg.Pool(options),closeBusiness=closeDatabase,
  getSelection=async()=>{throw failed();},persistSelection=async()=>{throw failed();}}={}) {
  function selectionOf(config,url) {return {generation:config.generation,databaseName:url.pathname.slice(1),sourceDumpSha256:config.sourceDumpSha256};}
  async function perform(config,{verifyCounts,persist}) {
    let pool;
    try {
      const url=new URL(config.databaseUrl);
      if(config.version!==1||config.phase!=='fenced-and-restored'||!uuid(config.generation)||!/^postgres(ql)?:$/.test(url.protocol)||
        url.hostname!=='postgres'||url.port!=='5432'||url.username!=='platform_app'||url.password.length<32||
        !/^\/platform_live_[a-z0-9_]{1,48}$/.test(url.pathname)||url.search||url.hash||
        !/^[a-f0-9]{64}$/.test(config.sourceDumpSha256??'')||!env.OPERATOR_OWNER_SUBJECT||!env.OIDC_ISSUER)throw failed();
      const expected=config.expectedCounts;
      if(verifyCounts&&(!expected||Object.keys(expected).length!==BUSINESS_TABLES.length||
        BUSINESS_TABLES.some(name=>!Number.isSafeInteger(expected[name])||expected[name]<0)||expected.operators<1))throw failed();
      pool=makePool({...nativePoolOptions(config.databaseUrl),max:2,application_name:'3dprint4me-activation'});
      const {rows:[role]}=await pool.query(`SELECT current_user AS "user",rolsuper AS superuser,rolbypassrls AS bypass,
        EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND tableowner=current_user) AS owns_tables,
        EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='platform_migration_readonly') AS source_fenced
        FROM pg_roles WHERE rolname=current_user`);
      if(role?.user!=='platform_app'||role.superuser!==false||role.bypass!==false||role.owns_tables!==false||role.source_fenced!==false)throw failed();
      if(verifyCounts) {
        // Identifiers come exclusively from the fixed source-schema allowlist.
        const {rows:[actual]}=await pool.query(`SELECT json_build_object(${BUSINESS_TABLES.map(name=>`'${name}',(SELECT count(*) FROM ${name})`).join(',')}) AS counts`);
        if(BUSINESS_TABLES.some(name=>actual?.counts?.[name]!==expected[name]))throw failed();
      }
      const {rows:[owner]}=await pool.query(`SELECT count(*)::int AS count FROM operator_identity_bindings b
        JOIN operators o ON o.id=b.operator_id WHERE b.issuer=$1 AND b.subject=$2 AND o.enabled AND o.role='owner'`,
        [env.OIDC_ISSUER,env.OPERATOR_OWNER_SUBJECT]);
      if(owner?.count!==1)throw failed();
      // The control DB is independent of this connection. Persist before opening
      // target traffic; restart recovery uses it even if api.env still names Neon.
      if(persist)await persistSelection(selectionOf(config,url));
      await closeBusiness();
      env.DATABASE_URL=config.databaseUrl;env.DATABASE_DRIVER='postgres';env.OPERATOR_AUTH_PROVIDER='authentik';
    }catch{throw failed();}
    finally{await pool?.end();}
  }
  async function activate() {
    try {
      const config=JSON.parse(await load()),existing=await getSelection();
      if(existing) {
        if(JSON.stringify(existing)!==JSON.stringify(selectionOf(config,new URL(config.databaseUrl))))throw failed();
        return await perform(config,{verifyCounts:false,persist:false});
      }
      return await perform(config,{verifyCounts:true,persist:true});
    }catch{throw failed();}
  }
  activate.restore=async selection=>{
    try {
      if(!selection||!uuid(selection.generation)||typeof selection.databaseName!=='string'||!/^platform_live_[a-z0-9_]{1,48}$/.test(selection.databaseName))throw failed();
      const url=new URL(env.PLATFORM_CONTROL_DATABASE_URL);url.pathname='/'+selection.databaseName;
      await perform({version:1,phase:'fenced-and-restored',generation:selection.generation,databaseUrl:url.href,sourceDumpSha256:selection.sourceDumpSha256},{verifyCounts:false,persist:false});
    }catch{throw failed();}
  };
  activate.bootstrap=async()=>{
    try {
      const selection=await getSelection();
      if(selection)return await activate.restore(selection);
      const config=JSON.parse(await load());
      if(config.version===1&&config.phase==='prepared')return;
      if(config.phase==='fenced-and-restored')return await activate();
      throw failed();
    }catch{throw failed();}
  };
  return activate;
}
