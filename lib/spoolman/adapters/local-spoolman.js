import { randomUUID } from 'node:crypto';
import { HttpError } from '../../http.js';
const conflict = () => new HttpError(409, 'Filament data changed. Refresh before saving.');
export function createLocalSpoolmanRepository({ read, mutate }) {
  return {
    disableSpoolmanSync() { return mutate(state=>{ if(state.spoolman)Object.assign(state.spoolman,{configured:false,requestedAt:null,token:null,leaseUntil:null}); }); },
    async getSpoolmanStatus() { const { token, requestedBy, ...status } = (await read()).spoolman ?? { configured: false, lastSuccessAt: null }; return status; },
    claimSpoolmanSync({ instanceId, token, leaseUntil, attemptedAt }) {
      return mutate(state => {
        const old = state.spoolman;
        if (old?.instanceId && old.instanceId !== instanceId) throw new HttpError(409, 'Spoolman instance change requires reconciliation.');
        if (old?.token && Date.parse(old.leaseUntil) > Date.parse(attemptedAt)) return false;
        state.spoolman = { ...old, configured: true, instanceId, token, leaseUntil, lastAttemptAt: attemptedAt, requestedAt: null };
        return true;
      });
    },
    applySpoolmanSnapshot({ instanceId, token, snapshot, completedAt }) {
      return mutate(state => {
        if (state.spoolman?.token !== token || state.spoolman.instanceId !== instanceId || Date.parse(state.spoolman.leaseUntil) <= Date.parse(completedAt)) throw conflict();
        const seen = new Set();
        for (const incoming of snapshot.items) {
          seen.add(incoming.source.spoolId);
          let row = state.filament.find(r => r.source?.instanceId === instanceId && r.source.spoolId === incoming.source.spoolId);
          if (!row) {
            row = { id: `fil_${randomUUID().replaceAll('-', '')}`, revision: 1, freightFeeCents: 0, notes: null, estimateDefault: false, costOverrideCents: null, createdAt: completedAt, updatedAt: completedAt, ...incoming };
            state.filament.push(row);
          } else if (Object.keys(incoming).some(key => JSON.stringify(row[key]) !== JSON.stringify(incoming[key]))) {
            Object.assign(row, incoming, { revision: row.revision + 1, updatedAt: completedAt });
          }
        }
        for (const row of state.filament) if (row.source?.instanceId === instanceId && !seen.has(row.source.spoolId) && row.active) Object.assign(row, { active: false, revision: row.revision + 1, updatedAt: completedAt });
        state.spoolman = { ...state.spoolman, token: null, leaseUntil: null, lastSuccessAt: completedAt, failureCode: null, count: snapshot.items.length, currency: snapshot.currency };
        return state.spoolman;
      });
    },
    failSpoolmanSync({ token, code }) {
      return mutate(state => {
        if (state.spoolman?.token === token) Object.assign(state.spoolman, { token: null, leaseUntil: null, failureCode: code });
      });
    },
    requestSpoolmanSync({ operatorId }) { return mutate((state, stamp) => { if (!state.spoolman?.configured) throw new HttpError(503, 'Spoolman is not configured.'); state.spoolman.requestedAt = stamp; state.spoolman.requestedBy = operatorId; return { queued: true }; }); },
    saveImportedFilament({ id, revision, local }) {
      return mutate((state, stamp) => {
        const row = state.filament.find(r => r.id === id && r.source);
        if (!row || row.revision !== revision) throw conflict();
        Object.assign(row, local, { revision: row.revision + 1, updatedAt: stamp });
        return row;
      });
    }
  };
}
