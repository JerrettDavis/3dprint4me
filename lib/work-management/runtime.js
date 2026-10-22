import { createLocalWorkRepository } from "./adapters/local-work-repository.js";
import { createNeonWorkRepository } from "./adapters/neon-work-repository.js";
import { createWorkManagementService } from "./service.js";

export function createNeonWorkManagementRuntime(options = {}) {
  const repository = createNeonWorkRepository(options);
  return { repository, service: createWorkManagementService({ repository }) };
}

export function createLocalWorkManagementRuntime({ path }) {
  const repository = createLocalWorkRepository({ path });
  return { repository, service: createWorkManagementService({ repository }) };
}

export function resolveWorkManagementRuntime({ runtime, repository, printEstimates = null, filamentMatching = null } = {}) {
  if (runtime) return runtime;
  if (repository) return { repository, service: createWorkManagementService({ repository, printEstimates, filamentMatching }) };
  const neon = createNeonWorkManagementRuntime();
  return printEstimates || filamentMatching ? { repository: neon.repository, service: createWorkManagementService({ repository: neon.repository, printEstimates, filamentMatching }) } : neon;
}
