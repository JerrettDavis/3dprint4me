import { presentHomeAssistantSnapshot } from "./home-assistant-snapshot.js";

// `printEstimates` is an optional private read model for work *detail* only.
async function withPrintEstimation(detail, printEstimates) {
  if (!printEstimates) return detail;
  try { return { ...detail, printEstimation: await printEstimates.forWork(detail) }; }
  catch { return { ...detail, printEstimation: { available: false } }; }
}

export function createWorkManagementService({ repository, printEstimates = null }) {
  return {
    homeAssistantSnapshot: async () => presentHomeAssistantSnapshot(await repository.getHomeAssistantSnapshot()),
    list: (query, operator) => repository.listWork(query, operator),
    detail: async (id, operator) => withPrintEstimation(await repository.getWork(id, operator), printEstimates),
    events: (after, limit, operator) => repository.listEvents(after, limit, operator),
    command: (id, command, operator, idempotencyKey) => repository.applyWorkCommand(id, command, operator, idempotencyKey),
    findOperator: authUserId => repository.findOperatorByAuthUserId(authUserId),
    touchOperator: operatorId => repository.touchOperator(operatorId),
    hasPushSubscription: operator => repository.hasPushSubscription(operator),
    savePushSubscription: (operator, subscription, userAgent) => repository.savePushSubscription(operator, subscription, userAgent),
    disablePushSubscription: (operator, endpoint) => repository.disablePushSubscription(operator, endpoint),
    queueTestNotification: operator => repository.queueTestNotification(operator),
    claimPushOutbox: options => repository.claimPushOutbox(options),
    listPushSubscriptions: entry => repository.listPushSubscriptions(entry),
    recordPushOutcome: outcome => repository.recordPushOutcome(outcome),
    finishPushOutbox: (id, summary) => repository.finishPushOutbox(id, summary),
    completeRequest: (id, request, files) => repository.completeRequestWithWork(id, request, files)
  };
}
