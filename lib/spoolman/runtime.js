import { createSpoolmanProvider } from './adapters/http-spoolman.js';
import { createSpoolmanSync } from './application.js';
export function createSpoolmanScheduledTask({ repository, env = process.env, now = () => new Date(), provider } = {}) {
  const source = provider ?? createSpoolmanProvider({ baseUrl: env.SPOOLMAN_BASE_URL, hostHeader: env.SPOOLMAN_HOST_HEADER });
  const sync = createSpoolmanSync({provider:source,repository,instanceId:env.SPOOLMAN_INSTANCE_ID,now});
  return async () => {
    if (!source.configured) return { configured:false };
    const state = await repository.getSpoolmanStatus();
    if (!state.requestedAt && state.lastAttemptAt && now().getTime()-Date.parse(state.lastAttemptAt)<60000) return { idle:true };
    const result=await sync.run();
    return result.available===false ? { errors:1 } : result;
  };
}
