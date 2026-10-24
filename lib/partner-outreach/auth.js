import { scrypt as scryptCallback, randomBytes, randomUUID, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from '../http.js';
import { createPostgresPartnerRepository, digest, isUuid } from './postgres-repository.js';

const scrypt = promisify(scryptCallback), TOKEN = /^[A-Za-z0-9_-]{43}$/;
const DAY = 86400000, PASSWORD_PARAMETERS = { N:131072, r:8, p:1, maxmem:192*1024*1024 };
const DUMMY = `scrypt$131072$8$1$${Buffer.alloc(16).toString('base64url')}$${Buffer.alloc(32).toString('base64url')}`;
let activeDerivations = 0;
async function derive(password,salt) {
  if(activeDerivations>=2)throw new HttpError(503,'Sign-in is busy. Try again shortly.');
  activeDerivations++;
  try{return await scrypt(password,salt,32,PASSWORD_PARAMETERS);}finally{activeDerivations--;}
}
export async function hashPassword(password) {
  if(typeof password!=='string'||password.length<15||password.length>128||Buffer.byteLength(password)>512)throw new HttpError(400,'Use a passphrase between 15 and 128 characters.');
  const salt=randomBytes(16),hash=await derive(password,salt);
  return `scrypt$131072$8$1$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}
export async function verifyPassword(password,encoded) {
  if(typeof password!=='string'||password.length>128||Buffer.byteLength(password)>512)return false;
  const match=/^scrypt\$131072\$8\$1\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/.exec(encoded??'');
  const parsed=match??/^scrypt\$131072\$8\$1\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/.exec(DUMMY);
  const actual=await derive(password,Buffer.from(parsed[1],'base64url'));
  return timingSafeEqual(actual,Buffer.from(parsed[2],'base64url')) && !!match;
}
const csrfFor=token=>createHmac('sha256',token).update('3dprint4me-partner-csrf-v1').digest('base64url');
export function partnerCookie(token,{clear=false}={}) {
  if(!clear&&!TOKEN.test(token))throw new Error('Invalid session token.');
  return `__Host-3dp-partner=${clear?'':token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${clear?0:7*86400}`;
}
const denied=()=>new HttpError(401,'Sign-in could not be completed. Check your details or contact the owner.');
const safePartner=account=>({id:account.id,displayName:account.display_name,status:account.status});

export function createPartnerAuth({database,now=()=>new Date(),canEnroll=async()=>false}={}) {
  const repo=createPostgresPartnerRepository({database}),q=(...args)=>database.query(...args);
  async function throttle(clientKey,operation,accountId='') {
    const timestamp=now(),window=new Date(Math.floor(timestamp.getTime()/900000)*900000).toISOString();
    // Persist only opaque buckets, never IPs or supplied credentials. Separate
    // client and account buckets limit both guessing and distributed attacks.
    for(const [bucket,limit] of [[`${operation}:client:${clientKey}`,20],[`${operation}:account:${accountId}`,10]]){
      if(bucket.endsWith(':account:'))continue;
      const [row]=await q`INSERT INTO partner_rate_limits(bucket_hash,window_start,attempts,expires_at) VALUES(${digest(bucket)},${window},1,${new Date(timestamp.getTime()+DAY).toISOString()}) ON CONFLICT(bucket_hash) DO UPDATE SET attempts=CASE WHEN partner_rate_limits.window_start=EXCLUDED.window_start THEN partner_rate_limits.attempts+1 ELSE 1 END,window_start=EXCLUDED.window_start,expires_at=EXCLUDED.expires_at RETURNING attempts`;
      if(row.attempts>limit)throw new HttpError(429,'Too many attempts. Try again later.',undefined,{'Retry-After':'900'});
    }
  }
  async function createSession(tx,account) {
    const token=randomBytes(32).toString('base64url'),csrfToken=csrfFor(token),timestamp=now();
    await tx.query`INSERT INTO partner_sessions(id,partner_id,token_hash,csrf_hash,credential_version,expires_at,absolute_expires_at,created_at) VALUES(${randomUUID()},${account.id},${digest(token)},${digest(csrfToken)},${account.credential_version},${new Date(timestamp.getTime()+7*DAY).toISOString()},${new Date(timestamp.getTime()+30*DAY).toISOString()},${timestamp.toISOString()})`;
    return {token,csrfToken,partner:safePartner(account)};
  }
  async function issueInvite({actor,partnerId,purpose='enroll'}) {
    if(actor?.role!=='OWNER')throw new HttpError(403,'Owner access is required.');
    if(!isUuid(partnerId)||!['enroll','recover'].includes(purpose))throw new HttpError(400,'Invalid invitation request.');
    const token=randomBytes(32).toString('base64url'),timestamp=now(),expiresAt=new Date(timestamp.getTime()+30*60000).toISOString();
    await database.withTransaction(async tx=>{
      const [account]=await tx.query`SELECT * FROM partner_accounts WHERE id=${partnerId} FOR UPDATE`;
      if(!account)throw new HttpError(404,'Partner not found.');
      if(purpose==='enroll'&&(account.status!=='invited'||!await canEnroll(tx,account.program_id,timestamp)))throw new HttpError(409,'Partner enrollment is unavailable until program reviews are complete.');
      if(purpose==='recover'&&account.status!=='active')throw new HttpError(409,'Recovery requires an active partner account.');
      await tx.query`UPDATE partner_invites SET revoked_at=${timestamp.toISOString()} WHERE partner_id=${partnerId} AND consumed_at IS NULL AND revoked_at IS NULL`;
      await tx.query`INSERT INTO partner_invites(id,partner_id,token_hash,purpose,expires_at,created_at) VALUES(${randomUUID()},${partnerId},${digest(token)},${purpose},${expiresAt},${timestamp.toISOString()})`;
      await repo.audit(tx,{programId:account.program_id,actor,action:purpose==='recover'?'partner.recovery_issued':'partner.invited',entityKind:'partner',entityId:partnerId});
    });
    // Raw token is shown once to the authenticated owner for private handoff.
    // It is not retained in command receipts, audit, URLs, emails or logs.
    return {token,partnerId,purpose,expiresAt};
  }
  async function redeem({token,password,clientKey}) {
    await throttle(String(clientKey??'unknown').slice(0,200),'redeem');
    if(!TOKEN.test(token??''))throw denied();
    const hash=digest(token),[candidate]=await q`SELECT partner_id FROM partner_invites WHERE token_hash=${hash}`;
    if(!candidate)throw denied();
    const credential=await hashPassword(password);
    return database.withTransaction(async tx=>{
      const [account]=await tx.query`SELECT * FROM partner_accounts WHERE id=${candidate.partner_id} FOR UPDATE`;
      const [invite]=await tx.query`SELECT * FROM partner_invites WHERE token_hash=${hash} FOR UPDATE`;
      const timestamp=now();
      if(!invite||invite.consumed_at||invite.revoked_at||new Date(invite.expires_at)<=timestamp)throw denied();
      if(invite.purpose==='enroll'&&(account.status!=='invited'||!await canEnroll(tx,account.program_id,timestamp)))throw new HttpError(409,'Partner enrollment is currently unavailable.');
      if(invite.purpose==='recover'&&account.status!=='active')throw denied();
      await tx.query`UPDATE partner_sessions SET revoked_at=${timestamp.toISOString()} WHERE partner_id=${account.id} AND revoked_at IS NULL`;
      await tx.query`UPDATE partner_invites SET revoked_at=${timestamp.toISOString()} WHERE partner_id=${account.id} AND token_hash<>${hash} AND consumed_at IS NULL AND revoked_at IS NULL`;
      await tx.query`UPDATE partner_invites SET consumed_at=${timestamp.toISOString()} WHERE token_hash=${hash}`;
      const [updated]=await tx.query`UPDATE partner_accounts SET credential_hash=${credential},credential_version=credential_version+1,status='active',revision=revision+1 WHERE id=${account.id} RETURNING *`;
      await repo.audit(tx,{programId:account.program_id,actor:{role:'PARTNER',id:account.id},action:invite.purpose==='recover'?'partner.recovered':'partner.enrolled',entityKind:'partner',entityId:account.id});
      return createSession(tx,updated);
    });
  }
  async function login({accountId,password,clientKey}) {
    await throttle(String(clientKey??'unknown').slice(0,200),'login',isUuid(accountId)?accountId:'invalid');
    const [candidate]=isUuid(accountId)?await q`SELECT id,credential_hash,credential_version FROM partner_accounts WHERE id=${accountId}`:[];
    const valid=await verifyPassword(password,candidate?.credential_hash);
    if(!valid||!candidate)throw denied();
    return database.withTransaction(async tx=>{
      const [account]=await tx.query`SELECT * FROM partner_accounts WHERE id=${accountId} FOR UPDATE`;
      if(account.status!=='active'||account.credential_version!==candidate.credential_version)throw denied();
      const result=await createSession(tx,account);
      await repo.audit(tx,{programId:account.program_id,actor:{role:'PARTNER',id:account.id},action:'partner.signed_in',entityKind:'partner',entityId:account.id});
      return result;
    });
  }
  async function session(token) {
    if(!TOKEN.test(token??''))throw denied();
    const timestamp=now();
    const [row]=await q`SELECT s.id AS session_id,s.csrf_hash,s.absolute_expires_at,a.* FROM partner_sessions s JOIN partner_accounts a ON a.id=s.partner_id WHERE s.token_hash=${digest(token)} AND s.revoked_at IS NULL AND s.expires_at>${timestamp.toISOString()} AND s.absolute_expires_at>${timestamp.toISOString()} AND s.credential_version=a.credential_version AND a.status='active'`;
    if(!row)throw denied();
    const expiry=new Date(Math.min(timestamp.getTime()+7*DAY,new Date(row.absolute_expires_at).getTime())).toISOString();
    await q`UPDATE partner_sessions SET expires_at=${expiry} WHERE id=${row.session_id} AND revoked_at IS NULL`;
    return {actor:{role:'PARTNER',id:row.id},partner:safePartner(row),programId:row.program_id,csrfToken:csrfFor(token),csrfHash:row.csrf_hash,sessionId:row.session_id};
  }
  function requireCsrf(current,token) {
    const received=Buffer.from(digest(typeof token==='string'?token:''),'hex'),expected=Buffer.from(current.csrfHash,'hex');
    if(received.length!==expected.length||!timingSafeEqual(received,expected))throw new HttpError(403,'Refresh the page before submitting this action.');
  }
  async function logout(token) {
    if(TOKEN.test(token??''))await q`UPDATE partner_sessions SET revoked_at=${now().toISOString()} WHERE token_hash=${digest(token)} AND revoked_at IS NULL`;
    return {ok:true};
  }
  async function revoke({actor,partnerId,status='revoked'}) {
    if(actor?.role!=='OWNER')throw new HttpError(403,'Owner access is required.');
    if(!isUuid(partnerId)||!['revoked','suspended'].includes(status))throw new HttpError(400,'Invalid access change.');
    return database.withTransaction(async tx=>{
      const [account]=await tx.query`SELECT * FROM partner_accounts WHERE id=${partnerId} FOR UPDATE`;
      if(!account)throw new HttpError(404,'Partner not found.');
      const timestamp=now().toISOString();
      await tx.query`UPDATE partner_accounts SET status=${status},credential_version=credential_version+1,revision=revision+1 WHERE id=${partnerId}`;
      await tx.query`UPDATE partner_sessions SET revoked_at=${timestamp} WHERE partner_id=${partnerId} AND revoked_at IS NULL`;
      await tx.query`UPDATE partner_invites SET revoked_at=${timestamp} WHERE partner_id=${partnerId} AND consumed_at IS NULL AND revoked_at IS NULL`;
      await repo.audit(tx,{programId:account.program_id,actor,action:'partner.'+status,entityKind:'partner',entityId:partnerId});
      return {ok:true};
    });
  }
  return {issueInvite,redeem,login,session,requireCsrf,logout,revoke};
}
