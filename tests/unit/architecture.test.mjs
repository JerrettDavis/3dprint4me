import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { checkArchitecture } from "../../scripts/check-architecture.mjs";

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), "3dp-architecture-"));
  for (const [path, source] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, source, "utf8");
  }
  return root;
}

async function violations(files) {
  const root = await fixture(files);
  try { return (await checkArchitecture({ root })).violations; }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("Given public code, when it imports a server module, then the public boundary rejects it", async () => {
  const found = await violations({
    "public/assets/js/client.js": 'import "../../../lib/http.js";\n',
    "lib/http.js": "export const ok = true;\n"
  });
  assert.deepEqual(found.map(item => item.rule), ["public-server-import"]);
});

test("Given a feature domain, when it imports a provider SDK, then the domain boundary rejects it", async () => {
  const found = await violations({
    "lib/project-request/domain.js": 'import { neon } from "@neondatabase/serverless";\n'
  });
  assert.deepEqual(found.map(item => item.rule), ["domain-provider-import"]);
});

test("Given a use case, when it imports the HTTP transport, then inward dependency rules reject it", async () => {
  const found = await violations({
    "lib/project-request/create-project-request.js": 'import handler from "../../api/request.js";\n',
    "api/request.js": "export default function handler() {}\n"
  });
  assert.deepEqual(found.map(item => item.rule), ["feature-transport-import"]);
});

test("Given an API transport, when it imports provider SDKs directly, then the composition boundary rejects it", async () => {
  const found = await violations({
    "api/request.js": 'import { neon } from "@neondatabase/serverless";\nimport { put } from "@vercel/blob";\n'
  });
  assert.deepEqual(found.map(item => item.rule), ["transport-provider-import", "transport-provider-import"]);
});

test("Given inward dependencies, when architecture is checked, then no violation is reported", async () => {
  const found = await violations({
    "api/request.js": 'import handler from "../lib/project-request/handler.js";\nexport default handler;\n',
    "lib/project-request/handler.js": 'import { createProjectRequest } from "./create-project-request.js";\nexport default createProjectRequest;\n',
    "lib/project-request/create-project-request.js": 'import { normalizeRequest } from "./domain.js";\nexport const createProjectRequest = normalizeRequest;\n',
    "lib/project-request/domain.js": "export const normalizeRequest = value => value;\n"
  });
  assert.deepEqual(found, []);
});

test("Given the repository, when architecture is checked, then every current dependency follows the boundary rules", async () => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const result = await checkArchitecture({ root });
  assert.deepEqual(result.violations, []);
});
