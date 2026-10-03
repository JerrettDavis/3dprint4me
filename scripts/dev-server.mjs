import { createServer } from "node:http";
import { stat, readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { GLOBAL_CSP, CUSTOMIZE_CSP } from "./csp.mjs";
import requestHandler from "../api/request.js";
import uploadHandler from "../api/upload-url.js";
import checkoutHandler from "../api/checkout.js";
import healthHandler from "../api/health.js";
import inquiryHandler from "../api/inquiry.js";
import printEstimateHandler from "../api/print-estimate.js";
import { LOCAL_FILE_ROUTE } from "../lib/print-estimation/adapters/local-file-store.js";
import { localPrivateFileHandler } from "../lib/print-estimation/runtime.js";
import { createSessionHandler } from "../api/operator-session.js";
import { createWorkHandler } from "../api/operator-work.js";
import { createWorkUpdateHandler } from "../api/operator-work-update.js";
import { createPushHandler } from "../api/operator-push.js";
import { createOperatorPrintHandler } from "../api/operator-print.js";
import { configuredOperatorOrigins } from "../lib/operator-api.js";
import { getLocalIdentityProvider, getLocalOperatorStore, localOperatorEnabled } from "../lib/local-operator.js";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const root = resolve(projectRoot, "public");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
process.env.LOCAL_DEV ||= "1";
const apiRoutes = new Map([["/api/request", requestHandler], ["/api/upload-url", uploadHandler], ["/api/checkout", checkoutHandler], ["/api/health", healthHandler]]);
apiRoutes.set("/api/inquiry", inquiryHandler);
apiRoutes.set("/api/print-estimate", printEstimateHandler);
if (localOperatorEnabled()) {
  const store = getLocalOperatorStore();
  const identityProvider = getLocalIdentityProvider();
  const allowedOrigins = configuredOperatorOrigins();
  apiRoutes.set("/api/operator-session", createSessionHandler({ store, identityProvider, allowedOrigins }));
  apiRoutes.set("/api/operator-work", createWorkHandler({ store, identityProvider, allowedOrigins }));
  apiRoutes.set("/api/operator-work-update", createWorkUpdateHandler({ store, identityProvider, allowedOrigins }));
  apiRoutes.set("/api/operator-push", createPushHandler({ store, identityProvider, allowedOrigins }));
  apiRoutes.set("/api/operator-print", createOperatorPrintHandler({ store, identityProvider, allowedOrigins }));
  const privateFiles = localPrivateFileHandler();
  apiRoutes.set(LOCAL_FILE_ROUTE, (req, res) => privateFiles.handle(req, res));
}
const mime = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".mjs":"text/javascript; charset=utf-8", ".json":"application/json; charset=utf-8", ".webmanifest":"application/manifest+json; charset=utf-8", ".svg":"image/svg+xml", ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".webp":"image/webp", ".xml":"application/xml; charset=utf-8", ".txt":"text/plain; charset=utf-8" };
function securityHeaders(res, url) { res.setHeader("Content-Security-Policy", url?.pathname.startsWith("/customize/") ? CUSTOMIZE_CSP : GLOBAL_CSP); res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin"); res.setHeader("X-Frame-Options", "DENY"); res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(self)"); }
async function fileExists(path) { try { return (await stat(path)).isFile(); } catch { return false; } }
async function serveFile(req, res, path, statusCode = 200, url) { const body = await readFile(path); res.statusCode = statusCode; securityHeaders(res, url); res.setHeader("Content-Type", mime[extname(path).toLowerCase()] || "application/octet-stream"); res.setHeader("Cache-Control", extname(path) === ".html" ? "no-cache" : "public, max-age=60"); res.setHeader("Content-Length", body.length); if (req.method === "HEAD") res.end(); else res.end(body); }
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);
    const apiHandler = apiRoutes.get(url.pathname);
    if (apiHandler) { securityHeaders(res, url); await apiHandler(req, res); return; }
    if (!["GET", "HEAD"].includes(req.method || "GET")) { res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8", Allow: "GET, HEAD" }); res.end("Method not allowed"); return; }
    let pathname; try { pathname = decodeURIComponent(url.pathname); } catch { pathname = "/404.html"; }
    if (pathname.endsWith("/")) pathname += "index.html";
    if (!extname(pathname)) { const htmlCandidate = resolve(root, `.${pathname}.html`); if (await fileExists(htmlCandidate)) pathname = `${pathname}.html`; }
    const target = resolve(root, `.${pathname}`);
    if (!(target === root || target.startsWith(`${root}${sep}`)) || !(await fileExists(target))) { await serveFile(req, res, resolve(root, "404.html"), 404, url); return; }
    await serveFile(req, res, target, 200, url);
  } catch (error) { console.error(error); if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Internal server error"); }
});
server.listen(port, host, () => console.log(`3dprint4.me running at http://${host}:${port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
