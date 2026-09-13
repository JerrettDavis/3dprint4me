import { createHmac, timingSafeEqual } from "node:crypto";

const lifetimeMs = 24 * 60 * 60 * 1000;
const signatureFor = (id, email, title, expires) => createHmac("sha256", process.env.STRIPE_SECRET_KEY)
  .update(JSON.stringify([id, email, title, expires]))
  .digest("hex");

export function issueCheckoutToken(id, email, title) {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  const expires = Date.now() + lifetimeMs;
  return `${expires}.${signatureFor(id, email, title, expires)}`;
}

export function validCheckoutToken(token, id, email, title) {
  if (!process.env.STRIPE_SECRET_KEY || typeof token !== "string") return false;
  const match = /^(\d{13})\.([a-f0-9]{64})$/.exec(token);
  if (!match) return false;
  const expires = Number(match[1]);
  if (expires <= Date.now() || expires > Date.now() + lifetimeMs) return false;
  const expected = Buffer.from(signatureFor(id, email, title, expires), "hex");
  const received = Buffer.from(match[2], "hex");
  return timingSafeEqual(expected, received);
}
