import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pages = ["/", "/services.html", "/portfolio.html", "/about.html", "/order.html", "/privacy.html", "/terms.html"];
const assets = ["/assets/css/site.css", "/assets/js/order.js", "/robots.txt", "/sitemap.xml"];
const privatePaths = ["/.env", "/lib/notifications.js", "/data/dev-requests.ndjson"];

export async function smokeLive(origin, { fetchImpl = fetch, requiredIntegrations = ["neon", "privateFiles", "email"] } = {}) {
  const base = new URL(origin);
  if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
    throw new Error("Use an HTTPS origin without a path, query, or credentials.");
  }
  const failures = [];
  const checked = [];
  const get = async path => {
    try {
      const response = await fetchImpl(new URL(path, base), { signal: AbortSignal.timeout(10_000) });
      if (response.url && new URL(response.url).origin !== base.origin) failures.push(`${path}: redirected away from ${base.origin}`);
      return response;
    } catch (error) {
      failures.push(`${path}: ${error?.name === "TimeoutError" ? "timed out" : "could not connect"}`);
      return null;
    }
  };
  const inspect = async path => {
    const response = await get(path);
    if (!response) return;
    checked.push(path);
    if (response.status !== 200) failures.push(`${path}: expected HTTP 200, got ${response.status}`);
    if (response.headers.get("x-content-type-options") !== "nosniff") failures.push(`${path}: missing MIME protection`);
    if (response.headers.get("x-frame-options") !== "DENY") failures.push(`${path}: missing frame denial`);
    if (pages.includes(path)) {
      if (!response.headers.get("content-type")?.includes("text/html")) failures.push(`${path}: wrong HTML content type`);
      if (!response.headers.get("content-security-policy")) failures.push(`${path}: missing CSP`);
      if (!response.headers.get("strict-transport-security")) failures.push(`${path}: missing HSTS`);
      const body = await response.text();
      if (!body.includes("3dprint4.me") || !body.includes("<main")) failures.push(`${path}: unexpected page content`);
    }
  };
  await Promise.all([...pages, ...assets].map(inspect));

  const health = await get("/api/health");
  if (health) {
    checked.push("/api/health");
    if (health.status !== 200) failures.push(`/api/health: expected HTTP 200, got ${health.status}`);
    if (!health.headers.get("cache-control")?.includes("no-store")) failures.push("/api/health: missing no-store cache control");
    try {
      const payload = await health.json();
      if (payload.ok !== true || payload.service !== "3dprint4.me") failures.push("/api/health: unexpected service response");
      for (const name of requiredIntegrations) {
        if (payload.integrations?.[name] !== true) failures.push(`/api/health: ${name} is not configured`);
      }
    } catch { failures.push("/api/health: invalid JSON response"); }
  }

  await Promise.all(privatePaths.map(async path => {
    const response = await get(path);
    if (!response) return;
    checked.push(path);
    if (![403, 404].includes(response.status)) failures.push(`${path}: private source path returned HTTP ${response.status}`);
  }));
  return { checked, failures };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const origin = process.argv[2] || "https://3dprint4.me";
    const requiredIntegrations = (process.argv[3] || "neon,privateFiles,email").split(",").filter(Boolean);
  try {
    const { checked, failures } = await smokeLive(origin, { requiredIntegrations });
    for (const failure of failures) console.error(`FAIL ${failure}`);
    console.log(`${failures.length ? "FAIL" : "PASS"} live smoke: ${checked.length} responses checked, ${failures.length} failures`);
    if (failures.length) process.exitCode = 1;
  } catch (error) {
    console.error(`FAIL live smoke: ${error.message}`);
    process.exitCode = 1;
  }
}
