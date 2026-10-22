import { randomUUID } from 'node:crypto';
import { normalizeSpoolmanSnapshot } from './domain.js';

export function createSpoolmanSync({ provider, repository, instanceId, now = () => new Date() }) {
  return {
    async status() { return repository.getSpoolmanStatus(); },
    async run() {
      if (!provider.configured) return { configured: false };
      const token = randomUUID(), started = now();
      if (!await repository.claimSpoolmanSync({ instanceId, token, attemptedAt: started.toISOString(), leaseUntil: new Date(started.getTime() + 120000).toISOString() })) return { busy: true };
      try {
        const snapshot = normalizeSpoolmanSnapshot({ instanceId, ...await provider.snapshot() });
        return await repository.applySpoolmanSnapshot({ instanceId, token, snapshot, completedAt: now().toISOString() });
      } catch {
        await repository.failSpoolmanSync({ instanceId, token, code: 'spoolman_unavailable', attemptedAt: started.toISOString() });
        return { available: false, failureCode: 'spoolman_unavailable' };
      }
    }
  };
}
