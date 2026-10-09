// The Vercel build command. `vercel build` invokes it many times in one deployment (once for
// the static output and once per API function, 13 runs in the logs), and each run used to empty
// and rewrite public/customize while Vercel was still reading the previous run's output, which
// failed some deployments with ENOENT on a font. The first successful run leaves a marker; later
// runs in the same checkout skip. Outside Vercel it always builds (same steps as before:
// customizer:build, assets:version, validate).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const MARKER = resolve(ROOT, "node_modules/.cache/3dprint4me-vercel-build.done");
export const STEPS = ["customizer:build", "assets:version", "validate"];

/** True when this run can be skipped: on Vercel, after a run already finished in this checkout. */
export const shouldSkip = (env, markerExists) => Boolean(env.VERCEL) && markerExists;

function run() {
  if (shouldSkip(process.env, existsSync(MARKER))) {
    console.log("vercel-build: already built in this deployment, skipping.");
    return;
  }
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  for (const step of STEPS) execFileSync(npm, ["run", step], { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
  if (process.env.VERCEL) {
    mkdirSync(dirname(MARKER), { recursive: true });
    writeFileSync(MARKER, new Date().toISOString());
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
