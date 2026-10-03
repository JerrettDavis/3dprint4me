// "Continue to request" logic, kept pure so it can be tested in Node.
import { redactSensitive } from "../../public/assets/js/customize/schema.js";

export const ORDER_URL = "/order.html?service=print&from=customize";
/** Used when the browser refuses IndexedDB: the 3MF is downloaded and the order page explains. */
export const ORDER_FALLBACK_URL = `${ORDER_URL}&handoff=download`;

/** Button state: Continue is available only for a model that matches the settings shown. */
export function continueState({ status, hasResult }) {
  return { disabled: !(status === "ready" && hasResult), note: "" };
}

/** The hand-off record. Sensitive values are encoded in the model file only; this record carries the redaction marker. */
export function continuePayload(generator, params, result) {
  return {
    file: new Blob([result.data], { type: "model/3mf" }),
    filename: result.filename,
    generatorId: generator.id,
    generatorVersion: generator.version ?? 1,
    generatorTitle: generator.title ?? generator.id,
    params: redactSensitive(generator, params),
    warnings: [...(result.warnings ?? [])]
  };
}

/**
 * Hands the model to the order page through IndexedDB. If the browser blocks IndexedDB
 * (private window, storage disabled), the 3MF is downloaded instead and the order page is
 * opened with a note asking the customer to attach it. Returns "handoff" or "download".
 */
export async function continueToOrder(payload, { writeHandoff, download, navigate }) {
  const { warnings: _warnings, ...record } = payload;
  try {
    await writeHandoff(record);
  } catch {
    download(payload.file, payload.filename);
    navigate(ORDER_FALLBACK_URL);
    return "download";
  }
  navigate(ORDER_URL);
  return "handoff";
}
