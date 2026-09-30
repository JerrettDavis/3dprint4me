// Loopback development adapter for the print-estimation repository port. It stores
// JSON beside the local operator queue and is never used by deployed functions.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { HttpError } from "../../http.js";

const emptyState = () => ({ version: 1, filament: [] });
const clone = value => structuredClone(value);
const makeId = prefix => `${prefix}_${randomBytes(16).toString("hex")}`;

async function readState(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (parsed?.version !== 1) throw new Error("Unsupported local print-estimation state.");
    return { ...emptyState(), ...parsed };
  } catch (error) {
    if (error?.code === "ENOENT") return emptyState();
    throw error;
  }
}

async function writeState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

export function createLocalPrintRepository({ path, now = () => new Date() }) {
  if (!path) throw new TypeError("A local print-estimation store path is required.");
  let pending = Promise.resolve();
  const exclusive = operation => {
    const result = pending.then(operation, operation);
    pending = result.catch(() => {});
    return result;
  };
  const read = async () => { await pending; return readState(path); };
  return {
    path,
    async listFilament() {
      const state = await read();
      return clone(state.filament).sort((a, b) => a.material.localeCompare(b.material) || Number(b.active) - Number(a.active) || b.updatedAt.localeCompare(a.updatedAt));
    },
    async filamentForMaterial(material) {
      const state = await read();
      return clone(state.filament.filter(row => row.material === material && row.active));
    },
    saveFilament(input) {
      return exclusive(async () => {
        const state = await readState(path);
        const stamp = now().toISOString();
        if (input.id) {
          const existing = state.filament.find(row => row.id === input.id);
          if (!existing) throw new HttpError(404, "Filament was not found.");
          Object.assign(existing, { ...input, updatedAt: stamp });
          await writeState(path, state);
          return clone(existing);
        }
        const row = { ...input, id: makeId("fil"), createdAt: stamp, updatedAt: stamp };
        state.filament.push(row);
        await writeState(path, state);
        return clone(row);
      });
    },
    async snapshot() { return clone(await read()); }
  };
}
