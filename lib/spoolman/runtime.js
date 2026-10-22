import { createSpoolmanProvider } from './adapters/http-spoolman.js';
import { createSpoolmanSync } from './application.js';
export function createSpoolmanScheduledTask({ repository, env = process.env, now = () => new Date(), provider } = {}) {
  const source = provider ?? createSpoolmanProvider({ baseUrl: env.SPOOLMAN_BASE_URL, hostHeader: env.SPOOLMAN_HOST_HEADER });
  const sync = createSpoolmanSync({provider:source,repository,instanceId:env.SPOOLMAN_INSTANCE_ID,now});
  let disabledChecked=false;
  return async () => {
    if (!source.configured) { if(!disabledChecked) { await repository.disableSpoolmanSync(); disabledChecked=true; } return { configured:false, claimed:0 }; }
    const state = await repository.getSpoolmanStatus();
    if (!state.requestedAt && state.lastAttemptAt && now().getTime()-Date.parse(state.lastAttemptAt)<60000) return { idle:true, claimed:0 };
    const result=await sync.run();
    return result.available===false ? { errors:1, claimed:1 } : result.busy ? {claimed:0} : {...result,claimed:1};
  };
}
