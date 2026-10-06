import assert from "node:assert/strict";
import test from "node:test";

import { orderPack } from "../../operator/assets/print-detail.js";

const ids = list => orderPack(list).map(asset => asset.id);

test("pack parts are grouped directly under their ZIP", () => {
  const list = [{ id: "zip1" }, { id: "solo" }, { id: "a", parentAssetId: "zip1" }, { id: "b", parentAssetId: "zip1" }];
  assert.deepEqual(ids(list), ["zip1", "a", "b", "solo"]);
});

test("a part whose ZIP is missing is still returned", () => {
  const list = [{ id: "solo" }, { id: "orphan", parentAssetId: "gone" }];
  assert.deepEqual(ids(list), ["solo", "orphan"]);
});

test("a plain single-model list keeps its order", () => {
  assert.deepEqual(ids([{ id: "x" }, { id: "y" }, { id: "z" }]), ["x", "y", "z"]);
});

test("an empty list stays empty", () => {
  assert.deepEqual(orderPack([]), []);
});
