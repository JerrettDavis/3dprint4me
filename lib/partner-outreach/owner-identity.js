import { HttpError } from '../http.js';
import { GITHUB_ISSUER } from '../operator-identity/github.js';
export async function verifyOwnerActor(tx,actor,{env=process.env,now=()=>new Date(),lock=false}={}) {
 const subject=env.OPERATOR_OWNER_SUBJECT;
 if(!actor?.ownerSessionHash||!/^\d{1,20}$/.test(subject??''))throw new HttpError(401,'Owner sign-in is required.');
 const rows=lock?await tx.query`SELECT s.operator_id FROM operator_sessions s JOIN operator_identity_bindings b ON b.operator_id=s.operator_id AND b.issuer=s.issuer AND b.subject=s.subject JOIN operators o ON o.id=s.operator_id WHERE s.token_hash=${actor.ownerSessionHash} AND s.expires_at>${now().toISOString()} AND s.issuer=${GITHUB_ISSUER} AND s.subject=${subject} AND o.role='owner' AND o.enabled=true FOR SHARE OF s,o`:await tx.query`SELECT s.operator_id FROM operator_sessions s JOIN operator_identity_bindings b ON b.operator_id=s.operator_id AND b.issuer=s.issuer AND b.subject=s.subject JOIN operators o ON o.id=s.operator_id WHERE s.token_hash=${actor.ownerSessionHash} AND s.expires_at>${now().toISOString()} AND s.issuer=${GITHUB_ISSUER} AND s.subject=${subject} AND o.role='owner' AND o.enabled=true`;
 if(rows[0]?.operator_id!==actor.id)throw new HttpError(403,'Owner access is required.');
}
