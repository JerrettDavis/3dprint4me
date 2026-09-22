import { createNeonWorkStore } from "../../lib/work-store.js";
import { createWebPushTransport, drainPushOutbox } from "../../lib/push-delivery.js";
import { createPushWorkerHandler } from "../../lib/push-worker.js";

const store = createNeonWorkStore();
const transport = createWebPushTransport();

export default createPushWorkerHandler({
  drain: options => drainPushOutbox({ store, transport, ...options })
});
