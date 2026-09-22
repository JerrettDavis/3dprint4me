import assert from "node:assert/strict";
import test from "node:test";

import { authorizeOperator, createDevelopmentIdentityProvider, createIdentityProvider, createNeonIdentityProvider } from "../../lib/operator-auth.js";

const request = { headers: { authorization: "Bearer session-fixture" }, socket: { remoteAddress: "127.0.0.1" } };

test("provider-neutral identity maps a verified Neon session without exposing provider tokens", async () => {
  const provider = createIdentityProvider({
    verifySession: async req => {
      assert.equal(req, request);
      return { user: { id: "auth-user-123", name: "Jerrett", email: "owner@example.com" }, session: { token: "must-not-leak" }, provider: "github" };
    }
  });
  assert.deepEqual(await provider.getIdentity(request), {
    authUserId: "auth-user-123",
    name: "Jerrett",
    email: "owner@example.com",
    provider: "github"
  });
});

test("Neon identity resolves an active opaque session when the managed client cannot expose its JWT", async () => {
  const tokens = [];
  const provider = createNeonIdentityProvider({
    jwksUrl: "https://auth.example.test/.well-known/jwks.json",
    issuer: "https://auth.example.test",
    findOpaqueSession: async token => {
      tokens.push(token);
      return { user: { id: "auth-user-123", name: "Jerrett", email: "owner@example.com" }, provider: "neon" };
    }
  });
  const opaqueRequest = { headers: { authorization: "Bearer AbCdEf0123456789_opaque-session" } };

  assert.deepEqual(await provider.getIdentity(opaqueRequest), {
    authUserId: "auth-user-123",
    name: "Jerrett",
    email: "owner@example.com",
    provider: "neon"
  });
  assert.deepEqual(tokens, ["AbCdEf0123456789_opaque-session"]);
});

test("Neon identity rejects malformed opaque tokens without querying session storage", async () => {
  let lookups = 0;
  const provider = createNeonIdentityProvider({
    jwksUrl: "https://auth.example.test/.well-known/jwks.json",
    findOpaqueSession: async () => { lookups += 1; }
  });

  assert.equal(await provider.getIdentity({ headers: { authorization: "Bearer too-short" } }), null);
  assert.equal(await provider.getIdentity({ headers: { authorization: "Bearer invalid/token/value/123456" } }), null);
  assert.equal(lookups, 0);
});

test("authorization distinguishes missing identity, unapproved identity and disabled operator", async () => {
  const missing = { getIdentity: async () => null };
  await assert.rejects(authorizeOperator(request, { findOperatorByAuthUserId: async () => null }, missing), error => error.status === 401);

  const identity = { getIdentity: async () => ({ authUserId: "auth-user-123", name: "Owner", email: null, provider: "github" }) };
  await assert.rejects(authorizeOperator(request, { findOperatorByAuthUserId: async () => null }, identity), error => error.status === 403);
  await assert.rejects(authorizeOperator(request, {
    findOperatorByAuthUserId: async () => ({ id: "op_12345678", authUserId: "auth-user-123", displayName: "Owner", role: "owner", enabled: false })
  }, identity), error => error.status === 403);
});

test("authorization returns only approved operator fields and records safe last-seen activity", async () => {
  const seen = [];
  const store = {
    findOperatorByAuthUserId: async id => ({ id: "op_12345678", authUserId: id, displayName: "Jerrett", role: "owner", enabled: true, privateFlag: "no" }),
    touchOperator: async id => seen.push(id)
  };
  const identity = { getIdentity: async () => ({ authUserId: "auth-user-123", name: "Owner", email: "owner@example.com", provider: "github" }) };
  assert.deepEqual(await authorizeOperator(request, store, identity), {
    id: "op_12345678",
    authUserId: "auth-user-123",
    displayName: "Jerrett",
    role: "owner"
  });
  assert.deepEqual(seen, ["op_12345678"]);
});

test("development identity requires every explicit loopback safeguard", async () => {
  const provider = createDevelopmentIdentityProvider({ enabled: true, localDev: true, host: "127.0.0.1", allowedOrigin: "http://127.0.0.1:4180" });
  const valid = { headers: { origin: "http://127.0.0.1:4180" }, socket: { remoteAddress: "127.0.0.1" } };
  assert.equal((await provider.getIdentity(valid)).authUserId, "local-development-owner");
  assert.equal(await provider.getIdentity({ ...valid, headers: { origin: "http://evil.example" } }), null);
  assert.throws(() => createDevelopmentIdentityProvider({ enabled: true, localDev: true, host: "0.0.0.0", allowedOrigin: "http://127.0.0.1:4180" }), /loopback/i);
  assert.throws(() => createDevelopmentIdentityProvider({ enabled: true, localDev: false, host: "127.0.0.1", allowedOrigin: "http://127.0.0.1:4180" }), /development/i);
});
