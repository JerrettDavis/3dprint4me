import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { forbiddenBrowserSecrets, scanBrowserSecrets } from "../../scripts/browser-secret-scan.mjs";

const root = new URL("../../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

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
  assert.ok(forbiddenBrowserSecrets.includes("HOME_ASSISTANT_TOKEN"));
  for (const directory of ["public/", "operator/"]) {
    const files = await scanBrowserSecrets([new URL(directory, root)]);
    assert.deepEqual(files, []);
  }
});

test("browser secret scan catches deployable text and skips binary assets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "browser-secret-scan-"));
  try {
    await writeFile(join(directory, "robots.txt"), "HOME_ASSISTANT_TOKEN");
    await writeFile(join(directory, "sitemap.xml"), "<secret>HOME_ASSISTANT_TOKEN</secret>");
    await writeFile(join(directory, "image.png"), Buffer.from([0, 255, 0, ...Buffer.from("HOME_ASSISTANT_TOKEN")]));
    const findings = await scanBrowserSecrets([directory]);
    assert.deepEqual(findings.map(({ file, secret }) => [file.split(/[\\/]/).at(-1), secret]).sort(), [
      ["robots.txt", "HOME_ASSISTANT_TOKEN"],
      ["sitemap.xml", "HOME_ASSISTANT_TOKEN"]
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("optional phone alert links to the canonical work item on iOS and Android", async () => {
  const readme = await read("integrations/home-assistant/README.md");
  const mobileExample = readme.split("## Optional phone delivery")[1].split("## Operation and removal")[0];
  const canonicalWorkUrl = 'https://work.3dprint4.me/work/{{ trigger.to_state.state }}';
  assert.ok(mobileExample.includes(`url: "${canonicalWorkUrl}"`), "iOS URL must open the work item");
  assert.ok(mobileExample.includes(`clickAction: "${canonicalWorkUrl}"`), "Android clickAction must open the same work item");
});
