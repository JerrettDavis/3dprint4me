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
      reply(data) { for (const fn of [...listeners.message]) fn({ data }); },
      crash() { for (const fn of [...listeners.error]) fn({ preventDefault() {} }); }
    };
    workers.push(worker);
    return worker;
  };
  return { create, workers };
}

// Manual clock: timers fire only when advance() passes their due time.
function fakeClock() {
  let now = 0;
  const timers = new Map();
  let nextHandle = 0;
  return {
    setTimer(fn, ms) { const handle = ++nextHandle; timers.set(handle, { fn, due: now + ms }); return handle; },
    clearTimer(handle) { timers.delete(handle); },
    advance(ms) {
      now += ms;
      for (const [handle, timer] of [...timers]) if (timer.due <= now && timers.has(handle)) { timers.delete(handle); timer.fn(); }
    },
    get pending() { return timers.size; }
  };
}

const settled = promise => promise.then(value => ({ value }), error => ({ error }));

test("resolves with the worker result for the matching request id", async () => {
  const { create, workers } = fakeWorkerFactory();
  const client = createWorkerClient({ createWorker: create });
  const promise = client.build("route-shield", { a: 1 });
  const [message] = workers[0].posted;
  assert.equal(message.generatorId, "route-shield");
  workers[0].reply({ id: message.id, ok: true, result: { filename: "x.3mf" } });
  assert.deepEqual(await promise, { filename: "x.3mf" });
  client.terminate();
});

test("five rapid builds while one is in flight post exactly two requests: the first and the last", async () => {
  const { create, workers } = fakeWorkerFactory();
  const clock = fakeClock();
  const client = createWorkerClient({ createWorker: create, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  const calls = [1, 2, 3, 4, 5].map(n => settled(client.build("route-shield", { n })));
  assert.equal(workers[0].posted.length, 1, "only the first is posted while it runs");
  workers[0].reply({ id: workers[0].posted[0].id, ok: true, result: "stale" });
  assert.equal(workers[0].posted.length, 2, "the latest queued request is posted when the worker is free");
  assert.deepEqual(workers[0].posted.map(m => m.params.n), [1, 5]);
  workers[0].reply({ id: workers[0].posted[1].id, ok: true, result: "fresh" });
  const results = await Promise.all(calls);
  for (const index of [1, 2, 3]) assert.ok(results[index].error instanceof SupersededError, `call ${index + 1} superseded`);
  assert.ok(results[0].error instanceof SupersededError, "the in-flight first call is superseded too; its reply is discarded");
  assert.equal(results[4].value, "fresh");
  assert.equal(workers.length, 1);
  assert.equal(clock.pending, 0, "no timers left behind");
});

test("custom font bytes are posted only for requests that actually run", () => {
  const { create, workers } = fakeWorkerFactory();
  const client = createWorkerClient({ createWorker: create });
  const fontBytes = new Uint8Array([1, 2, 3]);
  for (let i = 0; i < 4; i++) client.build("route-shield", { i }, { fontBytes, fontKey: "k" }).catch(() => {});
  assert.equal(workers[0].posted.length, 1);
  assert.equal(workers[0].posted[0].fontBytes, fontBytes, "passed through, not copied per call");
  client.terminate();
});

test("the timeout runs from post time, not queue time", async () => {
  const { create, workers } = fakeWorkerFactory();
  const clock = fakeClock();
  const client = createWorkerClient({ createWorker: create, timeoutMs: 1000, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  client.build("route-shield", { n: 1 }).catch(() => {});
  clock.advance(900);
  const latest = settled(client.build("route-shield", { n: 2 }));
  clock.advance(50);
  workers[0].reply({ id: workers[0].posted[0].id, ok: true, result: "old" }); // posts n=2 at t=950
  clock.advance(900); // t=1850: 900 ms after posting, 1850 ms after the first request
  assert.equal(workers[0].terminated, false, "queued time does not count");
  clock.advance(200); // t=2050: 1100 ms after posting
  const outcome = await latest;
  assert.match(outcome.error.message, /took too long/);
  assert.equal(outcome.error.retryable, true);
  assert.equal(workers[0].terminated, true);
});

test("worker errors reject with a readable Error message", async () => {
  const { create, workers } = fakeWorkerFactory();
  const client = createWorkerClient({ createWorker: create });
  const promise = client.build("route-shield", {});
  workers[0].reply({ id: workers[0].posted[0].id, ok: false, error: "Text doesn't fit." });
  await assert.rejects(promise, { message: "Text doesn't fit." });
  client.terminate();
});

test("a timeout terminates the worker; a queued request survives and runs on a fresh worker", async () => {
  const { create, workers } = fakeWorkerFactory();
  const clock = fakeClock();
  const client = createWorkerClient({ createWorker: create, timeoutMs: 20, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  const first = settled(client.build("route-shield", { n: 1 }));
  const second = client.build("route-shield", { n: 2 });
  clock.advance(25);
  assert.ok((await first).error instanceof SupersededError, "the older request was already superseded");
  assert.equal(workers[0].terminated, true);
  assert.equal(workers.length, 2, "recreated");
  assert.equal(workers[1].posted[0].params.n, 2);
  workers[1].reply({ id: workers[1].posted[0].id, ok: true, result: "ok" });
  assert.equal(await second, "ok");
  client.terminate();
});

test("a crash rejects the in-flight build as retryable, recreates the worker, and runs the queued one", async () => {
  const { create, workers } = fakeWorkerFactory();
  const client = createWorkerClient({ createWorker: create });
  const only = settled(client.build("route-shield", {}));
  workers[0].crash();
  const outcome = await only;
  assert.match(outcome.error.message, /stopped unexpectedly/);
  assert.equal(outcome.error.retryable, true);
  assert.equal(workers[0].terminated, true);

  client.build("route-shield", { n: 1 }).catch(() => {});
  const queued = client.build("route-shield", { n: 2 });
  workers[1].crash();
  assert.equal(workers.length, 3);
  assert.equal(workers[2].posted[0].params.n, 2, "queued request survives a crash");
  workers[2].reply({ id: workers[2].posted[0].id, ok: true, result: "after crash" });
  assert.equal(await queued, "after crash");
  client.terminate();
});
