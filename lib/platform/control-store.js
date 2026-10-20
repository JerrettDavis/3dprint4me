import pg from 'pg';
import { createNativeDatabase, nativePoolOptions } from '../database.js';

export function createControlStore({env=process.env,query,pool}={}) {
  if(!query) {
    const url=new URL(env.PLATFORM_CONTROL_DATABASE_URL);
    if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='postgres'||url.port!=='5432'||url.username!=='platform_app')throw new Error('Private control storage is required.');
    pool??=new pg.Pool({...nativePoolOptions(url.href),max:2,application_name:'3dprint4me-control'});
    pool.on('error',()=>console.error('Private control storage unavailable.'));
    query=createNativeDatabase({pool}).query;
  }
  const getSelection=async()=>{
      const rows=await query`SELECT generation,database_name,source_dump_sha256 FROM platform_deployment_state WHERE singleton=true`;
      const row=rows[0];return row?{generation:row.generation,databaseName:row.database_name,sourceDumpSha256:row.source_dump_sha256}:null;
    };
  return {
    getSelection,
    async persistSelection(selection) {
      await query`INSERT INTO platform_deployment_state(singleton,generation,database_name,source_dump_sha256)
        VALUES(true,${selection.generation}::uuid,${selection.databaseName},${selection.sourceDumpSha256}) ON CONFLICT DO NOTHING`;
      const actual=await getSelection();
      if(!actual||actual.generation!==selection.generation||actual.databaseName!==selection.databaseName||actual.sourceDumpSha256!==selection.sourceDumpSha256)throw new Error('A different database generation is already active.');
    },
    async consumeNonce(nonce,expiresAt) {
      // Control storage remains local during the Neon-to-native business handover.
      // Prune here as well as scheduled maintenance, so delivery stalls or disabled
      // candidate jobs cannot exhaust replay storage with expired entries.
      await query`DELETE FROM platform_proxy_nonces WHERE expires_at<now()`;
      const rows=await query`INSERT INTO platform_proxy_nonces(nonce,expires_at)
        VALUES(${nonce},to_timestamp(${expiresAt}/1000.0)) ON CONFLICT DO NOTHING RETURNING nonce`;
      return rows.length===1;
    },
    close:async()=>{await pool?.end();}
  };
}
