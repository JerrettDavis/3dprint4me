import { HttpError } from "../http.js";
import { getGenerator as registryGetGenerator } from "../../public/assets/js/customize/registry.js";
import { redactSensitive, sensitiveKeys, validateParams } from "../../public/assets/js/customize/schema.js";

const MAX_JSON = 8000;
// A hand-off made before the generator changed (new version, removed field, narrower range)
// no longer validates. The customer can only fix that by making the design again; the code
// lets the order page show the hint next to the attached model. Never includes any value.
export const STALE_CUSTOMIZATION_HINT = "This design was made with an older version of the generator. Remove the attached model and open the customizer again.";
const stale = message => new HttpError(400, `${message} ${STALE_CUSTOMIZATION_HINT}`, { code: "customization-stale" });
const isPlainObject = value => value != null && typeof value === "object" && !Array.isArray(value);

/**
 * Re-validates browser-supplied generator provenance against the generator's own schema.
 * The uploaded model is the source of truth; these values are provenance only. Sensitive
 * fields are never kept: they are not validated and are replaced with the redaction marker.
 * `getGenerator` is a seam for tests (a sensitive-field double); production uses the registry.
 */
export function normalizeCustomization(input, { getGenerator = registryGetGenerator } = {}) {
  if (input == null) return null;
  if (!isPlainObject(input)) throw new HttpError(400, "Customization details are invalid.");
  const generator = typeof input.generatorId === "string" ? getGenerator(input.generatorId) : undefined;
  if (!generator) throw new HttpError(400, "The selected generator is not available.");
  const version = input.generatorVersion;
  if (!Number.isInteger(version) || version < 1 || version > (generator.version ?? 1)) throw stale("The generator version is not supported.");
  const params = input.params ?? {};
  if (!isPlainObject(params)) throw new HttpError(400, "Customization parameters are invalid.");
  if (JSON.stringify(params).length > MAX_JSON) throw new HttpError(400, "The customization parameters are too large.");
  const { ok, errors, value } = validateParams(generator, params, { skipSensitive: true });
  // Schema messages name the field and its limits, never the submitted value.
  if (!ok) throw stale(`Customization is invalid: ${errors[0]}`);
  return { generatorId: generator.id, generatorVersion: version, params: redactSensitive(generator, value), redacted: sensitiveKeys(generator) };
}
