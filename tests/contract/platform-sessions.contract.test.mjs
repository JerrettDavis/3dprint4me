import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createSessionStore } from '../../lib/operator-identity/store.js';

test('private session storage consumes flows atomically and rechecks disabled and removed bindings',async()=>{
  const db=new PGlite();
  try {
    await db.exec("CREATE ROLE platform_backend NOLOGIN; CREATE TABLE operators(id text PRIMARY KEY,auth_user_id text NOT NULL,enabled boolean NOT NULL,last_seen_at timestamptz,updated_at timestamptz); INSERT INTO operators VALUES('op_owner','legacy-id',true,null,null)");
    await db.exec(await readFile(new URL('../../neon/migrations/008_platform.sql',import.meta.url),'utf8'));
    await db.exec("INSERT INTO operator_identity_bindings(issuer,subject,operator_id) VALUES('https://auth.example/','owner-sub','op_owner')");
    const query=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
    const store=createSessionStore({query}),hash='a'.repeat(64),stateHash='b'.repeat(64);
    await store.saveFlow({cookieHash:hash,stateHash,state:'s'.repeat(32),nonce:'n'.repeat(32),verifier:'v'.repeat(43),expiresAt:Date.now()+600000});
    assert.equal(await store.consumeFlow(hash,'c'.repeat(64)),null);
    assert.equal((await store.consumeFlow(hash,stateHash)).verifier,'v'.repeat(43));assert.equal(await store.consumeFlow(hash,stateHash),null);
    await store.saveSession({tokenHash:hash,operatorId:'op_owner',issuer:'https://auth.example/',subject:'owner-sub',expiresAt:Date.now()+600000});
    assert.deepEqual(await store.findSession(hash),{authUserId:'legacy-id'});
    await db.exec("UPDATE operators SET enabled=false");assert.equal(await store.findSession(hash),null);
    await db.exec("UPDATE operators SET enabled=true; DELETE FROM operator_identity_bindings");assert.equal(await store.findSession(hash),null);
    await db.exec('SET ROLE platform_backend');
    assert.equal((await db.query('SELECT * FROM operators')).rows.length,1);
    await assert.rejects(db.exec("UPDATE operators SET enabled=true"));
    await assert.rejects(db.exec("INSERT INTO operator_identity_bindings(issuer,subject,operator_id) VALUES('https://auth.example/','attacker','op_owner')"));
    await assert.rejects(db.exec('CREATE TABLE public.should_be_denied(id text)'));
  }finally{await db.close();}
});
