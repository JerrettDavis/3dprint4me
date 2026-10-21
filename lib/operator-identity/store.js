import { queryDatabase as sql } from '../database.js';

export function createSessionStore({query=sql}={}) {
  return {
    async saveFlow(flow) {
      await query`DELETE FROM operator_login_flows WHERE expires_at<=now()`;
      const rows=await query`INSERT INTO operator_login_flows(cookie_hash,state_hash,state,nonce,verifier,expires_at)
        SELECT ${flow.cookieHash},${flow.stateHash},${flow.state},${flow.nonce},${flow.verifier},to_timestamp(${flow.expiresAt}/1000.0)
        WHERE (SELECT count(*) FROM operator_login_flows)<1000 RETURNING cookie_hash`;
      return rows.length===1;
    },
    async consumeFlow(hash,stateHash) {
      const rows=await query`DELETE FROM operator_login_flows WHERE cookie_hash=${hash} AND state_hash=${stateHash}
        AND expires_at>now() RETURNING state,nonce,verifier,expires_at`;
      const flow=rows[0];return flow?{state:flow.state,nonce:flow.nonce,verifier:flow.verifier,expiresAt:new Date(flow.expires_at).getTime()}:null;
    },
    async findBinding(issuer,subject) {
      const rows=await query`SELECT o.id,o.auth_user_id FROM operator_identity_bindings b
        JOIN operators o ON o.id=b.operator_id WHERE b.issuer=${issuer} AND b.subject=${subject} AND o.enabled=true LIMIT 1`;
      return rows[0]?{operatorId:rows[0].id,authUserId:rows[0].auth_user_id}:null;
    },
    async saveSession(session) {
      await query`INSERT INTO operator_sessions(token_hash,operator_id,issuer,subject,expires_at)
        VALUES(${session.tokenHash},${session.operatorId},${session.issuer},${session.subject},to_timestamp(${session.expiresAt}/1000.0))`;
    },
    async findSession(hash) {
      const rows=await query`SELECT o.auth_user_id FROM operator_sessions s JOIN operators o ON o.id=s.operator_id
        JOIN operator_identity_bindings b ON b.operator_id=s.operator_id AND b.issuer=s.issuer AND b.subject=s.subject
        WHERE s.token_hash=${hash} AND s.expires_at>now() AND o.enabled=true LIMIT 1`;
      return rows[0]?{authUserId:rows[0].auth_user_id}:null;
    },
    async deleteSession(hash) {await query`DELETE FROM operator_sessions WHERE token_hash=${hash}`;}
  };
}
