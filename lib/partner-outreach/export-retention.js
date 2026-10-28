export const OWN_EXPORT_LIFETIME_MS=24*3600000;
export async function invalidateOwnExports(tx,partnerId,instant=new Date()){
 await tx.query`UPDATE partner_export_payloads SET payload='{}'::jsonb,invalidated_at=${instant.toISOString()} WHERE partner_id=${partnerId} AND invalidated_at IS NULL`;
}
export async function purgeExpiredPartnerExports(database,{instant=new Date(),limit=100}={}){
 if(!Number.isInteger(limit)||limit<1||limit>1000)throw new Error('Invalid export cleanup batch size.');
 return database.withTransaction(async tx=>{
  const rows=await tx.query`WITH expired AS (SELECT batch_id FROM partner_export_payloads WHERE invalidated_at IS NULL AND expires_at<=${instant.toISOString()} ORDER BY expires_at,batch_id LIMIT ${limit} FOR UPDATE SKIP LOCKED) UPDATE partner_export_payloads p SET payload='{}'::jsonb,invalidated_at=${instant.toISOString()} FROM expired WHERE p.batch_id=expired.batch_id RETURNING p.batch_id`;
  return {purged:rows.length};
 });
}
