import { randomBytes } from 'node:crypto';
export function newProjectRequestId() {
  const date=new Date().toISOString().slice(0,10).replaceAll('-','');
  return `3DP-${date}-${randomBytes(10).toString('hex').toUpperCase()}`;
}
