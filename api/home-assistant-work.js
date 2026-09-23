import { authorizeHomeAssistant } from "../lib/home-assistant-auth.js";
import { handleApiError, HttpError, requireMethod, sendJson } from "../lib/http.js";
import { resolveWorkManagementRuntime } from "../lib/work-management/runtime.js";

export function createHomeAssistantWorkHandler({ runtime, token = process.env.HOME_ASSISTANT_TOKEN } = {}) {
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
      const work = resolveWorkManagementRuntime({ runtime });
      sendJson(res, 200, await work.service.homeAssistantSnapshot());
    } catch {
      console.error("Home Assistant work snapshot failed.");
      sendJson(res, 503, { error: "Home Assistant integration is temporarily unavailable." });
    }
  };
}

export default async function handler(req, res) {
  return createHomeAssistantWorkHandler()(req, res);
}
