import { spawn } from "node:child_process";
import webpush from "web-push";

const host = "127.0.0.1";
const storefrontPort = Number(process.env.STOREFRONT_PORT ?? 4173);
const operatorPort = Number(process.env.OPERATOR_PORT ?? 4180);
const keys = webpush.generateVAPIDKeys();
const shared = { ...process.env, LOCAL_DEV: "1", OPERATOR_DEV_AUTH: "1", HOST: host, PORT: String(storefrontPort), OPERATOR_HOST: host, OPERATOR_PORT: String(operatorPort), OPERATOR_ALLOWED_ORIGINS: `http://${host}:${operatorPort}`, OPERATOR_API_BASE: `http://${host}:${storefrontPort}`, SITE_URL: `http://${host}:${storefrontPort}`, VAPID_SUBJECT: "mailto:local@3dprint4.me", VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey };
const options = { env: shared, stdio: "inherit", windowsHide: true };
const children = [spawn(process.execPath, ["scripts/dev-server.mjs"], options), spawn(process.execPath, ["scripts/operator-server.mjs"], options)];
console.log(`Storefront: http://${host}:${storefrontPort}`); console.log(`Operator inbox: http://${host}:${operatorPort}`);
let stopping = false; function stop(code = 0) { if (stopping) return; stopping = true; for (const child of children) if (!child.killed) child.kill(); setTimeout(() => process.exit(code), 250).unref(); }
for (const child of children) child.on("exit", code => { if (!stopping) stop(code ?? 1); });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop(0));
