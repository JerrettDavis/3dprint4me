import { createHash, timingSafeEqual } from "node:crypto";

import { HttpError } from "./http.js";

const digest = value => createHash("sha256").update(value, "utf8").digest();

export function authorizeHomeAssistant(req, configuredToken = process.env.HOME_ASSISTANT_TOKEN) {
  if (typeof configuredToken !== "string" || configuredToken.length < 32) {
    throw new HttpError(503, "Home Assistant integration is unavailable.");
  }

  if (Array.isArray(req?.rawHeaders)) {
    let authorizationCount = 0;
    for (let index = 0; index < req.rawHeaders.length; index += 2) {
      if (String(req.rawHeaders[index]).toLowerCase() === "authorization") authorizationCount += 1;
    }
    if (req.rawHeaders.length % 2 !== 0 || authorizationCount !== 1) {
      throw new HttpError(401, "Authentication is required.");
    }
  }

  const headers = req?.headers;
  let header;
  if (typeof headers?.get === "function") {
    header = headers.get("authorization");
  } else {
    if (headers?.authorization !== undefined && headers?.Authorization !== undefined) {
      throw new HttpError(401, "Authentication is required.");
    }
    header = headers?.authorization ?? headers?.Authorization;
  }

  const match = typeof header === "string" ? /^Bearer ([^\s]+)$/.exec(header) : null;
  if (!match || !timingSafeEqual(digest(match[1]), digest(configuredToken))) {
    throw new HttpError(401, "Authentication is required.");
  }
}
