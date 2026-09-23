import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

async function browserFiles(directory) {
  const result = [];
  for (const entry of await readdir(new URL(directory, root), { withFileTypes: true })) {
    const path = join(directory, entry.name).replaceAll("\\", "/");
    if (entry.isDirectory()) result.push(...await browserFiles(`${path}/`));
    else if ([".html", ".js", ".mjs", ".css", ".json", ".webmanifest", ".svg"].includes(extname(path))) result.push(path);
  }
  return result;
}

test("Home Assistant package polls the authenticated read-only snapshot", async () => {
  const packageYaml = await read("integrations/home-assistant/package.yaml");
  assert.match(packageYaml, /resource:\s*https:\/\/3dprint4\.me\/api\/home-assistant-work/);
  assert.match(packageYaml, /Authorization:\s*!secret three_d_print_work_authorization/);
  assert.match(packageYaml, /scan_interval:\s*60/);
  assert.match(packageYaml, /timeout:\s*10/);
  for (const attribute of ["generatedAt", "queueUrl", "counts", "latestCreatedId", "items"]) {
    assert.match(packageYaml, new RegExp(`- ${attribute}\\b`));
  }
  assert.match(packageYaml, /persistent_notification\.create/);
  assert.match(packageYaml, /https:\/\/work\.3dprint4\.me\/work\//);
  assert.match(packageYaml, /trigger\.from_state\.state/);
  assert.match(packageYaml, /trigger\.to_state\.state/);
  assert.match(packageYaml, /regex_match/);
});

test("Home Assistant dashboard offers only canonical work links", async () => {
  const packageYaml = await read("integrations/home-assistant/package.yaml");
  const dashboardYaml = await read("integrations/home-assistant/dashboard.yaml");
  assert.match(dashboardYaml, /https:\/\/work\.3dprint4\.me\//);
  assert.match(dashboardYaml, /item\.url/);
  assert.doesNotMatch(`${packageYaml}\n${dashboardYaml}`, /operator-work-update|\backnowledge\b|set-status|add-note/);
});

test("the machine token name stays out of browser assets and is blocked by validation", async () => {
  const validation = await read("scripts/validate.mjs");
  assert.match(validation, /forbiddenBrowserSecrets\s*=\s*\[[^\]]*HOME_ASSISTANT_TOKEN/s);
  for (const directory of ["public/", "operator/"]) {
    for (const path of await browserFiles(directory)) {
      assert.doesNotMatch(await read(path), /HOME_ASSISTANT_TOKEN/, path);
    }
  }
});
