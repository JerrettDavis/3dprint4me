import { build } from "esbuild";
import { resolve } from "node:path";

await build({
  entryPoints: [resolve("scripts/operator-auth-entry.mjs")],
  outfile: resolve("operator/assets/neon-auth.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  legalComments: "none"
});
