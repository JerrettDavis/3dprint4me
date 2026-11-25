import { withPlatformProxy } from "../lib/platform/proxy.js";
import { authorizeHomeAssistant } from "../lib/home-assistant-auth.js";
import { handleApiError, HttpError, requireMethod, sendJson } from "../lib/http.js";
import { resolveWorkManagementRuntime } from "../lib/work-management/runtime.js";
import { createInvoiceTrackingRuntime } from '../lib/invoicing/tracking-runtime.js';

export function createHomeAssistantWorkHandler({ runtime, tracking, token = process.env.HOME_ASSISTANT_TOKEN } = {}) {
  return async function homeAssistantWorkHandler(req, res) {
    try {
      requireMethod(req, "GET");
      authorizeHomeAssistant(req, token);
    } catch (error) {
      if (error instanceof HttpError) {
        handleApiError(res, error);
        return;
      }
      console.error("Home Assistant work snapshot failed.");
      sendJson(res, 503, { error: "Home Assistant integration is temporarily unavailable." });
      return;
    }

    try {
      const resource = new URL(req.url ?? '/api/home-assistant-work', 'https://api.invalid').searchParams.get('resource');
      if (resource === 'billing') {
        sendJson(res, 200, await (tracking ?? createInvoiceTrackingRuntime()).service.machineSnapshot());
        return;
      }
      const work = resolveWorkManagementRuntime({ runtime });
      sendJson(res, 200, await work.service.homeAssistantSnapshot());
    } catch {
      console.error("Home Assistant work snapshot failed.");
      sendJson(res, 503, { error: "Home Assistant integration is temporarily unavailable." });
    }
  };
}

async function handler(req, res) {
  return createHomeAssistantWorkHandler()(req, res);
}

export default withPlatformProxy(handler);
