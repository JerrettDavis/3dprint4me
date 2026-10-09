// The Vercel build command. `vercel build` invokes it many times in one deployment (once for
// the static output and once per API function, 13 runs in the logs), and each run used to empty
// and rewrite public/customize while Vercel was still reading the previous run's output, which
// failed some deployments with ENOENT on a font. The first successful run leaves a marker; later
// runs in the same deployment skip.
//
// The marker is keyed to the deployment and lives in the OS temp directory, never in
// node_modules/.cache: Vercel restores that directory between deployments, and a marker restored
// from an earlier deployment made every build skip and shipped a site without /customize/. A skip
// also requires the built output to exist. Outside Vercel it always builds (the same steps as
// before: customizer:build, assets:version, validate).
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const OUTPUT_MARKER = resolve(ROOT, "public/customize/index.html");
export const STEPS = ["customizer:build", "assets:version", "validate"];

/** The marker file for this deployment, or null when the deployment can't be identified. */
export function markerPath(env, dir = tmpdir()) {
  const id = env.VERCEL_DEPLOYMENT_ID || env.VERCEL_GIT_COMMIT_SHA;
  return env.VERCEL && id ? join(dir, `3dprint4me-vercel-build-${String(id).replace(/[^A-Za-z0-9_-]/g, "_")}.done`) : null;
}

/**
 * True when this run can be skipped: on Vercel, in a deployment that already finished a run, with
 * the built output still there. Anything else builds.
 */
export const shouldSkip = ({ markerExists, outputExists }) => Boolean(markerExists && outputExists);

function run() {
  const marker = markerPath(process.env);
  if (marker && shouldSkip({ markerExists: existsSync(marker), outputExists: existsSync(OUTPUT_MARKER) })) {
    console.log("vercel-build: already built in this deployment, skipping.");
    return;
  }
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  for (const step of STEPS) execFileSync(npm, ["run", step], { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
  if (marker) writeFileSync(marker, new Date().toISOString());
}

/** Whether the deployment has what it must ship: fail loudly instead of publishing a site without it. */
export function assertBuilt(outputExists) {
  if (!outputExists) throw new Error("vercel-build: public/customize/index.html is missing, so the Customize section was not built. Failing the deployment instead of shipping without it.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run();
  assertBuilt(existsSync(OUTPUT_MARKER));
}
