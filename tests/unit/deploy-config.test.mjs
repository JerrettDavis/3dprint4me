// Vercel invokes the build command many times per deployment. Only the first may build: a later
// run would empty public/customize while Vercel is still reading the previous run's files
// (intermittent ENOENT on a font). Locally it always builds.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { shouldSkip, STEPS } from "../../scripts/vercel-build.mjs";

test("a repeat run on Vercel skips; the first run and local runs build", () => {
  assert.equal(shouldSkip({ VERCEL: "1" }, false), false, "first run on Vercel builds");
  assert.equal(shouldSkip({ VERCEL: "1" }, true), true, "later runs on Vercel skip");
  assert.equal(shouldSkip({}, true), false, "never skip off Vercel, even with a stale marker");
});

test("the build steps are the same ones npm test and the docs describe", async () => {
  assert.deepEqual(STEPS, ["customizer:build", "assets:version", "validate"]);
  const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["vercel-build"], "node scripts/vercel-build.mjs");
  for (const step of STEPS) assert.ok(pkg.scripts[step], step);
});
