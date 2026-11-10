import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { finishMaterial } from '../../customizer/framework/studio.js';

test('smooth vase shading survives presentation toggles while other models retain their defaults', () => {
  const smooth = new THREE.MeshStandardMaterial();
  smooth.userData.smoothShading = true;
  const normal = new THREE.MeshStandardMaterial();
  try {
    for (const realistic of [false, true, false]) {
      finishMaterial(smooth, realistic);
      finishMaterial(normal, realistic);
      assert.equal(smooth.flatShading, false);
      assert.equal(normal.flatShading, !realistic);
    }
  } finally { smooth.dispose(); normal.dispose(); }
});
