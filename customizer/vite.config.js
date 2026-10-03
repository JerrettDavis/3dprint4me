import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { readdirSync, existsSync } from "node:fs";

const here = fileURLToPath(new URL(".", import.meta.url));
const generatorPages = existsSync(`${here}g`) ? readdirSync(`${here}g`).map(id => [`g-${id}`, `${here}g/${id}/index.html`]) : [];

export default defineConfig({
  root: here,
  base: "/customize/",
  publicDir: `${here}static`,
  build: {
    outDir: fileURLToPath(new URL("../public/customize", import.meta.url)),
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: { input: Object.fromEntries([["index", `${here}index.html`], ...generatorPages]) }
  },
  worker: { format: "es" }
});
