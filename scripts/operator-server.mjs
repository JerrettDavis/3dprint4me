import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const root = resolve(projectRoot, "operator");
const host = process.env.OPERATOR_HOST ?? "127.0.0.1";
const port = Number(process.env.OPERATOR_PORT ?? 4180);
const apiBase = process.env.OPERATOR_API_BASE ?? "http://127.0.0.1:4173";
const authBase = process.env.NEON_AUTH_BASE_URL ?? null;
if (!["127.0.0.1", "::1", "localhost"].includes(host)) throw new Error("The operator development host must be loopback.");
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8", ".svg": "image/svg+xml" };
const exists = path => stat(path).then(value => value.isFile()).catch(() => false);
function headers(res) { res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("X-Frame-Options", "DENY"); res.setHeader("Referrer-Policy", "no-referrer"); res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()"); }
async function send(req, res, path) { const body = await readFile(path); res.writeHead(200, { "Content-Type": mime[extname(path)] ?? "application/octet-stream", "Cache-Control": extname(path) === ".html" ? "no-store" : "public, max-age=60", "Content-Length": body.length }); if (req.method === "HEAD") res.end(); else res.end(body); }
const server = createServer(async (req, res) => {
  headers(res); const url = new URL(req.url ?? "/", `http://${host}:${port}`);
  if (url.pathname === "/config.json") { const body = JSON.stringify({ apiBase, authBase }); res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(body) }); res.end(body); return; }
  if (!["GET", "HEAD"].includes(req.method ?? "GET")) { res.writeHead(405, { Allow: "GET, HEAD" }); res.end(); return; }
  let target = resolve(root, `.${decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)}`);
  if (!(target === root || target.startsWith(`${root}${sep}`)) || !(await exists(target))) target = resolve(root, "index.html");
  await send(req, res, target);
});
server.listen(port, host, () => console.log(`Operator inbox running at http://${host}:${port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
