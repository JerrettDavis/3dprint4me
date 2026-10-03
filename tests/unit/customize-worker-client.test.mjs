import assert from "node:assert/strict";
import test from "node:test";
import { createWorkerClient, SupersededError } from "../../customizer/framework/worker-client.js";

function fakeWorkerFactory() {
  const workers = [];
  const create = () => {
    const listeners = { message: new Set(), error: new Set() };
    const worker = {
      posted: [], terminated: false,
      addEventListener: (type, fn) => listeners[type].add(fn),
      removeEventListener: (type, fn) => listeners[type].delete(fn),
      postMessage(message) { this.posted.push(message); },
      terminate() { this.terminated = true; },
      reply(data) { for (const fn of listeners.message) fn({ data }); },
      crash() { for (const fn of listeners.error) fn({ preventDefault() {} }); }
    };
    workers.push(worker);
    return worker;
  };
  return { create, workers };
}

test("resolves with the worker result for the matching request id", async () => {
  const { create, workers } = fakeWorkerFactory();
  const client = createWorkerClient({ createWorker: create });
  const promise = client.build("route-shield", { a: 1 });
  const [message] = workers[0].posted;
  assert.equal(message.generatorId, "route-shield");
  workers[0].reply({ id: message.id, ok: true, result: { filename: "x.3mf" } });
  assert.deepEqual(await promise, { filename: "x.3mf" });
});

test("latest wins: a newer build supersedes the older one and stale replies are ignored", async () => {
  const { create, workers } = fakeWorkerFactory();
  const client = createWorkerClient({ createWorker: create });
  const first = client.build("route-shield", { n: 1 });
  const second = client.build("route-shield", { n: 2 });
  await assert.rejects(first, error => error instanceof SupersededError);
  const [old, latest] = workers[0].posted;
  assert.ok(latest.id > old.id, "ids increase");
  workers[0].reply({ id: old.id, ok: true, result: "stale" });
  workers[0].reply({ id: latest.id, ok: true, result: "fresh" });
  assert.equal(await second, "fresh");
  assert.equal(workers.length, 1, "one worker is reused");
});

test("worker errors reject with a readable Error message", async () => {
  const { create, workers } = fakeWorkerFactory();
  const client = createWorkerClient({ createWorker: create });
  const promise = client.build("route-shield", {});
  workers[0].reply({ id: workers[0].posted[0].id, ok: false, error: "Text doesn't fit." });
  await assert.rejects(promise, { message: "Text doesn't fit." });
});

test("a timeout terminates the worker and the next build uses a fresh one", async () => {
  const { create, workers } = fakeWorkerFactory();
  const client = createWorkerClient({ createWorker: create, timeoutMs: 20 });
  await assert.rejects(client.build("route-shield", {}), /took too long/);
  assert.equal(workers[0].terminated, true);
  const next = client.build("route-shield", {});
  assert.equal(workers.length, 2);
  workers[1].reply({ id: workers[1].posted[0].id, ok: true, result: "ok" });
  assert.equal(await next, "ok");
});

test("a crashed worker rejects the pending build and is recreated", async () => {
  const { create, workers } = fakeWorkerFactory();
  const client = createWorkerClient({ createWorker: create });
  const promise = client.build("route-shield", {});
  workers[0].crash();
  await assert.rejects(promise, /stopped unexpectedly/);
  assert.equal(workers[0].terminated, true);
  client.build("route-shield", {}).catch(() => {});
  assert.equal(workers.length, 2);
  client.terminate();
});
