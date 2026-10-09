// Vercel invokes the build command many times per deployment. Only the first may build: a later
// run would empty public/customize while Vercel is still reading the previous run's files
// (intermittent ENOENT on a font). But a skip must never happen without a build in THIS
// deployment: a marker restored from an earlier deployment's cache once skipped every build and
// shipped a site with no /customize/ pages.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { assertBuilt, markerPath, shouldSkip, STEPS } from "../../scripts/vercel-build.mjs";

test("only a deployment that already built, with its output present, skips", () => {
  assert.equal(shouldSkip({ markerExists: false, outputExists: false }), false, "first run builds");
  assert.equal(shouldSkip({ markerExists: false, outputExists: true }), false, "output from elsewhere is not a build");
  assert.equal(shouldSkip({ markerExists: true, outputExists: false }), false, "a stale marker with no output must build (the production regression)");
  assert.equal(shouldSkip({ markerExists: true, outputExists: true }), true, "a repeat run in the same deployment skips");
});

test("the marker is per deployment, in the temp directory, and only on Vercel", () => {
  const a = markerPath({ VERCEL: "1", VERCEL_DEPLOYMENT_ID: "dpl_A" });
  const b = markerPath({ VERCEL: "1", VERCEL_DEPLOYMENT_ID: "dpl_B" });
  assert.ok(a && b && a !== b, "a new deployment never sees the previous deployment's marker");
  assert.ok(a.startsWith(tmpdir()), "not under node_modules/.cache, which Vercel restores between deployments");
  assert.doesNotMatch(a, /node_modules/);
  assert.equal(markerPath({ VERCEL: "1", VERCEL_GIT_COMMIT_SHA: "abc123" })?.includes("abc123"), true, "falls back to the commit");
  assert.equal(markerPath({ VERCEL: "1" }), null, "no deployment id: never skip");
  assert.equal(markerPath({ VERCEL_DEPLOYMENT_ID: "dpl_A" }), null, "off Vercel: always build");
  assert.equal(markerPath({}), null);
});

test("the build steps are the same ones npm test and the docs describe", async () => {
  assert.deepEqual(STEPS, ["customizer:build", "assets:version", "validate"]);
  const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["vercel-build"], "node scripts/vercel-build.mjs");
  for (const step of STEPS) assert.ok(pkg.scripts[step], step);
});

test("a deployment without the built Customize output fails instead of shipping", () => {
  assert.throws(() => assertBuilt(false), /not built/);
  assert.doesNotThrow(() => assertBuilt(true));
});
