// What the page says when a build fails. Pure (tested in Node).
//
// - load-failed (WASM, builder module or a curated font didn't load) and worker-failed (the
//   worker script didn't start or crashed): the connection or the browser, never the settings.
// - timeout: the worker's own message (it suggests simpler settings or another try).
// - anything else is a genuine build error: the settings wording, and the error itself goes
//   next to the control it concerns (or into the Settings summary).
export const LOAD_FAILURE_MESSAGE = "We couldn't load the model builder. Check your connection and try again.";
export const SETTINGS_FAILURE_MESSAGE = "The model couldn't be built with these settings. See the note in Settings.";
const ENVIRONMENTAL = new Set(["load-failed", "worker-failed"]);

/** Returns { message, retryable, settings }: settings=true means the error belongs to the form. */
export function buildFailureStatus(error) {
  if (ENVIRONMENTAL.has(error?.code)) return { message: LOAD_FAILURE_MESSAGE, retryable: true, settings: false };
  if (error?.retryable) return { message: error.message || LOAD_FAILURE_MESSAGE, retryable: true, settings: false };
  return { message: SETTINGS_FAILURE_MESSAGE, retryable: false, settings: true };
}
