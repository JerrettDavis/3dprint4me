// "Continue to request" logic, kept pure so it can be tested in Node.
import { redactSensitive } from "../../public/assets/js/customize/schema.js";

export const HANDOFF_PENDING_NOTE = "Request hand-off arrives with the next update.";

/**
 * Button state. In a production build with no hand-off handler registered yet the button
 * stays disabled with an honest note instead of silently doing nothing.
 */
export function continueState({ status, hasResult, handlerSet, production }) {
  if (!handlerSet && production) return { disabled: true, note: HANDOFF_PENDING_NOTE };
  return { disabled: !(status === "ready" && hasResult), note: "" };
}

/** The hand-off record. Sensitive values live only inside the model file, never here. */
export function continuePayload(generator, params, result) {
  return {
    file: new Blob([result.data], { type: "model/3mf" }),
    filename: result.filename,
    generatorId: generator.id,
    generatorVersion: generator.version ?? 1,
    params: redactSensitive(generator, params),
    warnings: [...(result.warnings ?? [])]
  };
}
