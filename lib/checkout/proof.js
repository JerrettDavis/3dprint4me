import { createHmac, timingSafeEqual } from "node:crypto";

const lifetimeMs = 24 * 60 * 60 * 1000;
const signatureFor = (secret, id, email, title, expires) => createHmac("sha256", secret)
  .update(JSON.stringify([id, email, title, expires]))
  .digest("hex");

export function issueCheckoutToken(id, email, title, { secret = process.env.STRIPE_SECRET_KEY, now = Date.now } = {}) {
  if (!secret) return null;
  const expires = now() + lifetimeMs;
  return `${expires}.${signatureFor(secret, id, email, title, expires)}`;
}

export function validCheckoutToken(token, id, email, title, { secret = process.env.STRIPE_SECRET_KEY, now = Date.now } = {}) {
  if (!secret || typeof token !== "string") return false;
  const match = /^(\d{13})\.([a-f0-9]{64})$/.exec(token);
  if (!match) return false;
  const expires = Number(match[1]);
  const currentTime = now();
  if (expires <= currentTime || expires > currentTime + lifetimeMs) return false;
  const expected = Buffer.from(signatureFor(secret, id, email, title, expires), "hex");
  const received = Buffer.from(match[2], "hex");
  return timingSafeEqual(expected, received);
}
