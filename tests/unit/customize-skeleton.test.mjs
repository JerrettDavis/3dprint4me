import assert from "node:assert/strict";
import test from "node:test";
import { inflateRawSync } from "node:zlib";
import { loadEngine } from "../../customizer/framework/engine.js";
import { buildModel } from "../../customizer/framework/model.js";
import keychain from "../../public/assets/js/customize/generators/skull-keychain.js";
import figure from "../../public/assets/js/customize/generators/skeleton-figure.js";
import { clampParams, validateParams } from "../../public/assets/js/customize/schema.js";
import { figureLayout, threadSpec } from "../../public/assets/js/customize/skeleton.js";
import buildKeychain from "../../customizer/generators/skull-keychain/build.js";
import buildFigure from "../../customizer/generators/skeleton-figure/build.js";
import { jointLink, jointSpec, scope, screw, skull } from "../../customizer/generators/skeleton/geometry.js";
import { eyeDimensions, grinHeight, headHeight, headRadius, headSolid } from "../../customizer/generators/skeleton/head.js";
import { bow, hand, jacket, suitInlay, tailoredLimb } from "../../customizer/generators/skeleton/figure-parts.js";
import { analyzeModelBytes } from "../../public/assets/js/print-estimation/geometry.js";
import { trackLiveObjects } from "../support/manifold-live.mjs";

const wasm = await loadEngine();
function params(g, over = {}) {
  const r = validateParams(g, over);
  assert.ok(r.ok, r.errors.join("; "));
  return r.value;
}
const decomposeCount = solid => {
  const pieces = solid.decompose();
  try { return pieces.filter(p => Math.abs(p.volume()) > 1e-8).length; } finally { pieces.forEach(p => p.delete()); }
};
// The generated mesh uses float32 vertices; shared inlay boundaries have float32 roundoff.
const overlapTolerance = (a, b) => 2 ** -23 * Math.max(1, a.volume(), b.volume());
async function built(g, build, over, check) {
  const result = await build(params(g, over), { wasm });
  try { return await check(result); } finally { result.solids.forEach(p => p.solid.delete()); }
}

test("elbows and knees bend by the selected angle without changing segment lengths", () => {
  for (const over of [{}, { elbow_bend_deg: 0, knee_bend_deg: 0 }, { elbow_bend_deg: 40, knee_bend_deg: 16, thigh_mm: 22, shin_mm: 50, torso_width_mm: 14, limb_width_mm: 6 }]) {
    const o = params(figure, over), layout = figureLayout(o);
    const check = (a, b, c, firstLength, secondLength, bend) => {
      const u = b.map((v, i) => v - a[i]), v = c.map((x, i) => x - b[i]);
      assert.ok(Math.abs(Math.hypot(...u) - firstLength) < 1e-8);
      assert.ok(Math.abs(Math.hypot(...v) - secondLength) < 1e-8);
      const angle = Math.acos(Math.max(-1, Math.min(1, u.reduce((sum, x, i) => sum + x * v[i], 0) / firstLength / secondLength))) * 180 / Math.PI;
      assert.ok(Math.abs(angle - bend) < 1e-5);
    };
    for (const arm of layout.arms) check(arm.shoulder, arm.elbow, arm.wrist, o.upper_arm_mm, o.forearm_mm, o.elbow_bend_deg);
    for (const leg of layout.legs) {
      check(leg.hip, leg.knee, leg.ankle, o.thigh_mm, o.shin_mm, o.knee_bend_deg);
      assert.ok(leg.ankle[0] * leg.side >= leg.hip[0] * leg.side, "even an extreme knee bend keeps the ankles apart");
      const stance = Math.atan2((leg.ankle[0] - leg.hip[0]) * leg.side, leg.hip[1] - leg.ankle[1]) * 180 / Math.PI;
      assert.ok(Math.abs(stance - 2) < 1e-8, "knee bends do not splay the feet or change the overall stance");
    }
  }
});

test("tailored limbs have narrower joints, flat backs, conformal stripes and connected angled hands", () => {
  const o = params(figure), l = figureLayout(o), s = scope(wasm);
  try {
    for (const [kind, start, joint, end] of [["arm", l.arms[1].shoulder, l.arms[1].elbow, l.arms[1].wrist], ["leg", l.legs[1].hip, l.legs[1].knee, l.legs[1].ankle]]) {
      const limb = tailoredLimb(s, o, start, joint, end, kind);
      assert.equal(limb.solid.status(), "NoError");
      assert.equal(decomposeCount(limb.solid), 1);
      assert.equal(limb.solid.boundingBox().min[2], 0);
      const widthAt = y => {
        const slab = s.t(s.t(wasm.Manifold.cube([200, 0.02, 20], true)).translate([0, y, 10]));
        const b = s.t(limb.solid.intersect(slab)).boundingBox();
        return b.max[0] - b.min[0];
      };
      assert.ok(widthAt(joint[1]) < widthAt(start[1] - 1) * 0.8);
      assert.ok(limb.inlay.volume() > 0);
      assert.ok(Math.abs(s.t(limb.inlay.intersect(limb.solid)).volume() - limb.inlay.volume()) < overlapTolerance(limb.inlay, limb.solid));
      const skinDepth = s.t(limb.solid.translate([0, 0, -0.51]));
      assert.ok(s.t(limb.inlay.intersect(skinDepth)).volume() < overlapTolerance(limb.inlay, limb.solid));
    }
    for (const over of [{}, { finger_width_mm: 1.2, hand_width_mm: 12, hand_length_mm: 30 }, { finger_width_mm: 3, hand_width_mm: 5, hand_length_mm: 10 }]) {
      const fingers = hand(s, { ...o, ...over }, [0, 0], 1, [1, -2]);
      assert.equal(decomposeCount(fingers), 1);
      assert.equal(fingers.boundingBox().min[2], 0);
    }
    assert.equal(tailoredLimb(s, { ...o, pinstripes: false }, l.arms[0].shoulder, l.arms[0].elbow, l.arms[0].wrist, "arm").inlay, undefined);
  } finally { s.done(true); }
});

test("threaded and flexi assembly edits normalize required settings, and server validation refuses unsafe combinations", () => {
  const p = params(figure);
  assert.equal(clampParams(figure, { ...p, assembly: "threaded" }, "assembly").head_depth_mm, 33.5);
  assert.equal(clampParams(figure, { ...p, head_depth_mm: 6, assembly: "threaded" }, "assembly").head_depth_mm, 10);
  assert.equal(clampParams(figure, { ...p, assembly: "flex" }, "assembly").bow, "none");
  assert.match(validateParams(figure, { assembly: "threaded", head_depth_mm: 6 }).fieldErrors.head_depth_mm, /10 mm/);
  assert.match(validateParams(figure, { assembly: "flex" }).fieldErrors.bow, /moving neck joint/);
  assert.match(validateParams(keychain, { attachment: "hole", hole_diameter_mm: 7, loop_wall_mm: 5 }).fieldErrors.hole_diameter_mm, /more room/);
});

test("analytic head has a broad chin, generated cavities and a closed flat back", () => {
  const o = params(figure), s = scope(wasm);
  try {
    const solid = headSolid(s, o);
    assert.equal(solid.status(), "NoError");
    assert.equal(decomposeCount(solid), 1);
    const bounds = solid.boundingBox();
    assert.ok(Math.abs(bounds.max[0] - bounds.min[0] - o.head_width_mm) < 0.05);
    assert.equal(bounds.max[1] - bounds.min[1], o.head_height_mm);
    assert.equal(bounds.min[2], 0);
    const chinSlab = s.t(s.t(wasm.Manifold.cube([o.head_width_mm + 1, 0.02, o.head_depth_mm + 1], true)).translate([0, -o.head_height_mm * 0.4, o.head_depth_mm / 2]));
    const chin = s.t(solid.intersect(chinSlab)).boundingBox();
    assert.ok(chin.max[0] - chin.min[0] > o.head_width_mm * 0.7, "broad lower jaw rather than an egg-shaped skull");
    const frontZ = (x, y) => {
      const ray = s.t(s.t(wasm.Manifold.cylinder(o.head_depth_mm + 1, 0.02, 0.02, 16)).translate([x, y, 0]));
      return s.t(solid.intersect(ray)).boundingBox().max[2];
    };
    assert.ok(frontZ(0, 0) - frontZ(o.head_width_mm * 0.247, -o.head_height_mm * 0.028) > o.head_depth_mm * 0.12);
    const underside = s.t(s.t(wasm.Manifold.cube([o.head_width_mm + 1, 0.01, o.head_depth_mm + 1], true)).translate([0, -o.head_height_mm / 2 + 0.005, o.head_depth_mm / 2]));
    const edge = s.t(solid.intersect(underside)).boundingBox();
    assert.ok(edge.max[0] - edge.min[0] > o.head_width_mm * 0.09, "chin terminates in a printable edge, not a needle");
    assert.ok(edge.max[2] < o.head_depth_mm * 0.6, "chin underside rounds back toward the bed");
  } finally { s.done(true); }
});

test("chin, cavity depth and tooth count regenerate anatomy rather than scaling a stored surface", () => {
  const o = params(figure);
  assert.ok(headRadius(-0.4, { ...o, chin_fullness_pct: 115 }) > headRadius(-0.4, o));
  assert.ok(headHeight(0.247, -0.028, { ...o, eye_recess_pct: 25 }) < headHeight(0.247, -0.028, o) - 0.1);
  let changed = 0;
  for (let x = -0.3; x < 0.3; x += 0.003) {
    const y = grinHeight(x, o) - 0.0375;
    if (Math.abs(headHeight(x, y, o) - headHeight(x, y, { ...o, tooth_count: 12 })) > 0.025) changed++;
  }
  assert.ok(changed > 20, "different counts move the generated tooth crowns and gaps");
});

test("sculpted jacket narrows at the adjustable waist and its shirt follows the chest", () => {
  const o = params(figure), s = scope(wasm);
  try {
    const slim = jacket(s, { ...o, jacket_waist_pct: 40 }), broad = jacket(s, { ...o, jacket_waist_pct: 85 });
    const waistSlab = s.t(s.t(wasm.Manifold.cube([o.torso_width_mm + 1, 0.02, o.body_depth_mm + 2], true)).translate([0, -o.torso_length_mm * 0.12, o.body_depth_mm / 2]));
    const width = body => { const b = s.t(body.intersect(waistSlab)).boundingBox(); return b.max[0] - b.min[0]; };
    assert.ok(width(broad) - width(slim) > o.torso_width_mm * 0.25);
    const inlay = suitInlay(s, o, slim);
    assert.ok(inlay.volume() > 0);
    assert.ok(Math.abs(s.t(inlay.intersect(slim)).volume() - inlay.volume()) < overlapTolerance(inlay, slim));
    assert.ok(s.t(inlay.intersect(s.t(slim.translate([0, 0, -0.61])))).volume() < overlapTolerance(inlay, slim), "shirt stays in the conformal front skin");
    assert.ok(inlay.boundingBox().max[2] - inlay.boundingBox().min[2] > 1, "inlay is not a flat hovering panel");
  } finally { s.done(true); }
});

test("the coat has two separated side tails and the bow has thin bed-supported radiating tips", () => {
  const o = params(figure), s = scope(wasm);
  try {
    const coat = jacket(s, o), y = -o.torso_length_mm / 2 - o.coat_tail_mm * 0.5;
    const slab = s.t(s.t(wasm.Manifold.cube([100, 0.1, 20], true)).translate([0, y, 10]));
    assert.equal(decomposeCount(s.t(coat.intersect(slab))), 2);
    const noTail = jacket(s, { ...o, coat_tail_mm: 0 });
    assert.equal(noTail.boundingBox().min[1], -o.torso_length_mm / 2);
    for (const attached of [false, true]) {
      const tie = bow(s, o, attached);
      assert.equal(decomposeCount(tie), 1);
      assert.equal(tie.boundingBox().min[2], 0);
      const tipSlab = s.t(s.t(wasm.Manifold.cube([o.bow_width_mm * 0.05, 100, 30], true)).translate([o.bow_width_mm * 0.46, 0, 15]));
      const tips = s.t(tie.intersect(tipSlab));
      assert.ok(!tips.isEmpty());
      assert.ok(tips.boundingBox().max[2] < o.bow_depth_mm + 0.2, "outer rays are not solid jacket-depth blocks");
      assert.ok(tie.boundingBox().max[2] > tips.boundingBox().max[2] + 0.4, "knot has a sculpted front relief");
    }
  } finally { s.done(true); }
});

test("socket inlays cover the generated eye cavities, and there is no painted mouth stripe", async () => {
  const o = params(figure);
  await built(keychain, buildKeychain, { head_width_mm: o.head_width_mm, head_height_mm: o.head_height_mm, head_depth_mm: o.head_depth_mm, chin_fullness_pct: o.chin_fullness_pct, tooth_count: o.tooth_count, attachment: "none" }, ({ solids }) => {
    const s = scope(wasm), body = solids[0].solid, face = solids[1].solid;
    try {
      for (const side of [-1, 1]) {
        const eye = eyeDimensions(o, side), rotation = eye.angle * Math.PI / 180;
        for (let i = 0; i < 8; i++) {
          const angle = i * Math.PI / 4, dx = 0.92 * eye.rx * Math.cos(angle), dy = 0.92 * eye.ry * Math.sin(angle);
          const x = eye.x + dx * Math.cos(rotation) - dy * Math.sin(rotation);
          const y = eye.y + dx * Math.sin(rotation) + dy * Math.cos(rotation);
          const z = 2.4 + headHeight(x / o.head_width_mm, y / o.head_height_mm, o) * (o.head_depth_mm - 2.4) - 0.3;
          const probe = s.t(s.t(wasm.Manifold.cube([0.06, 0.06, 0.08], true)).translate([x, y, z]));
          assert.ok(s.t(face.intersect(probe)).volume() > probe.volume() * 0.5);
          assert.ok(s.t(body.intersect(probe)).volume() < 1e-8, "no white crescent inside the socket");
        }
      }
      const mouth = s.t(s.t(wasm.Manifold.cube([o.head_width_mm, o.head_height_mm * 0.1, o.head_depth_mm + 1], true)).translate([0, -o.head_height_mm * 0.36, o.head_depth_mm / 2]));
      assert.ok(s.t(face.intersect(mouth)).isEmpty(), "teeth are sculpted, not an added dark line");
    } finally { s.done(true); }
  });
});

test("keychain is connected, has a real through-hole and a flat back, and inlays never overlap its body", async () => {
  for (const attachment of ["loop", "hole", "none"]) {
    await built(keychain, buildKeychain, { attachment, head_width_mm: 44, head_height_mm: 38 }, ({ solids }) => {
      const body = solids[0].solid, face = solids[1].solid;
      assert.equal(body.boundingBox().min[2], 0);
      assert.equal(decomposeCount(body), 1);
      const overlap = body.intersect(face);
      try { assert.ok(overlap.volume() < overlapTolerance(body, face)); } finally { overlap.delete(); }
      const holeR = 2, outer = 5, cy = attachment === "loop" ? 19 + outer * 0.55 : 19 - outer;
      if (attachment !== "none") {
        const rawCylinder = wasm.Manifold.cylinder(15, holeR - 0.05, holeR - 0.05, 48);
        const cylinder = rawCylinder.translate([0, cy, -1]);
        const cut = body.intersect(cylinder);
        try { assert.ok(cut.isEmpty(), "hole stays open through the entire depth"); } finally { rawCylinder.delete(); cylinder.delete(); cut.delete(); }
      }
    });
  }
});

test("all figure modes export analyzer-clean 3MFs with the intended moving parts", async () => {
  let singleColorVolume;
  for (const over of [{}, { multicolor: false }, { assembly: "threaded", head_depth_mm: 11, bow: "separate" }, { assembly: "flex", bow: "none" }, { assembly: "flex", bow: "none", joint_coupon: true }, { assembly: "threaded", head_depth_mm: 11, fit_coupon: true }]) {
    const out = await buildModel({ ...figure, build: buildFigure }, params(figure, over), { wasm });
    const analysis = await analyzeModelBytes({ name: out.filename, bytes: out.data, inflateRaw: async (b, max) => new Uint8Array(inflateRawSync(b, { maxOutputLength: max })) });
    assert.deepEqual(analysis.warnings.filter(w => w !== "embedded_settings_ignored"), []);
    assert.ok(analysis.volumeMm3 > 0);
    if (!Object.keys(over).length) {
      const s = scope(wasm);
      try { singleColorVolume = analysis.volumeMm3 - skull(s, params(figure)).face.volume(); } finally { s.done(true); }
    }
    if (over.multicolor === false) assert.ok(Math.abs(analysis.volumeMm3 - singleColorVolume) < singleColorVolume * 2 ** -20, "single-color export engraves the face but retains the whole jacket, including its shirt surface");
    if (over.assembly === "flex" && !over.joint_coupon) {
      assert.deepEqual(out.parts.filter(p => /^(Body|Skull|Arm [12]|Leg [12])$/.test(p.name)).map(p => p.name).sort(), ["Arm 1", "Arm 2", "Body", "Leg 1", "Leg 2", "Skull"]);
    }
  }
});

test("fused colored figure unites into one printable piece without overlapping color volumes", async () => {
  await built(figure, buildFigure, {}, ({ solids }) => {
    for (let i = 0; i < solids.length; i++) for (let j = i + 1; j < solids.length; j++) {
      const overlap = solids[i].solid.intersect(solids[j].solid);
      try { assert.ok(overlap.volume() < overlapTolerance(solids[i].solid, solids[j].solid), `${solids[i].name}/${solids[j].name}`); } finally { overlap.delete(); }
    }
    const combined = wasm.Manifold.union(solids.map(p => p.solid));
    try { assert.equal(decomposeCount(combined), 1); } finally { combined.delete(); }
  });
});

test("flexi figure has six connected rigid pieces; every piece touches the bed and none collide", async () => {
  for (const over of [
    {},
    { joint_wall_mm: 3.2, joint_clearance_mm: 0.8, limb_width_mm: 8, torso_width_mm: 24, elbow_bend_deg: 40, knee_bend_deg: 16, upper_arm_mm: 20, forearm_mm: 40, thigh_mm: 22, shin_mm: 50 },
    { torso_length_mm: 30, torso_width_mm: 14, limb_width_mm: 6, joint_wall_mm: 2, joint_clearance_mm: 0.4, upper_arm_mm: 20, forearm_mm: 40, elbow_bend_deg: 40, hand_width_mm: 12, hand_length_mm: 30, finger_width_mm: 1.2 },
    { joint_wall_mm: 2, joint_clearance_mm: 0.4, limb_width_mm: 8, thigh_mm: 22, shin_mm: 22, knee_bend_deg: 0, foot_length_mm: 20 }
  ]) {
    const o = params(figure, { ...over, assembly: "flex", bow: "none" });
    await built(figure, buildFigure, o, ({ solids }) => {
      const groups = [/^(Body|Suit)/, /^(Skull|Face)/, /^(Arm 1|Hand 1)/, /^(Arm 2|Hand 2)/, /^Leg 1/, /^Leg 2/];
      const rigid = groups.map(re => ({ name: re.source, solid: wasm.Manifold.union(solids.filter(p => re.test(p.name)).map(p => p.solid)) }));
      try {
        assert.equal(rigid.length, 6);
        for (const part of rigid) {
          assert.ok(Math.abs(part.solid.boundingBox().min[2]) < 1e-6, `${part.name} touches bed`);
          assert.equal(decomposeCount(part.solid), 1, `${part.name} must not contain loose disconnected loops`);
        }
        for (let i = 0; i < rigid.length; i++) for (let j = i + 1; j < rigid.length; j++) {
          const overlap = rigid[i].solid.intersect(rigid[j].solid);
          try { assert.ok(overlap.volume() < 1e-5, `${rigid[i].name}/${rigid[j].name} fuse`); } finally { overlap.delete(); }
          assert.ok(rigid[i].solid.minGap(rigid[j].solid, o.joint_clearance_mm) >= o.joint_clearance_mm - 1e-5, `${rigid[i].name}/${rigid[j].name} violate joint clearance`);
        }
      } finally { rigid.forEach(p => p.solid.delete()); }
    });
  }
});

// Gauss linking integral on loop centerlines: separated rings alone are not proof of a joint.
function linkingNumber(radius, distance) {
  const n = 256, paths = [1, -1].map(sign => Array.from({ length: n }, (_, i) => {
    const a = i * 2 * Math.PI / n, x = radius * Math.cos(a);
    return [x / Math.sqrt(2), radius * Math.sin(a) + (sign === -1 ? distance : 0), -sign * x / Math.sqrt(2)];
  }));
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  let sum = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const a = paths[0][i], b = paths[0][(i + 1) % n], c = paths[1][j], d = paths[1][(j + 1) % n];
    const u = sub(b, a), v = sub(d, c), r = a.map((x, k) => (x + b[k] - c[k] - d[k]) / 2);
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    sum += cross.reduce((total, x, k) => total + x * r[k], 0) / Math.hypot(...r) ** 3;
  }
  return sum / (4 * Math.PI);
}

test("joint loops are topologically interlocked and have the selected clearance across the parameter range", () => {
  for (const wall of [2, 2.4, 3.2]) for (const clearance of [0.4, 0.5, 0.8]) {
    const o = params(figure, { assembly: "flex", bow: "none", joint_wall_mm: wall, joint_clearance_mm: clearance });
    const s = scope(wasm);
    try {
      const spec = jointSpec(o);
      assert.ok(Math.abs(Math.abs(linkingNumber(spec.radius - wall / 2, spec.distance)) - 1) < 0.002);
      const a = jointLink(s, o, 45, clearance / 2);
      const b = s.t(jointLink(s, o, -45, clearance / 2).translate([0, spec.distance, 0]));
      const overlap = s.t(a.intersect(b));
      assert.ok(overlap.isEmpty(), `wall ${wall}, clearance ${clearance}: inflated links collide`);
      const loop = jointLink(s, o, 45);
      assert.equal(decomposeCount(loop), 1);
      assert.equal(loop.boundingBox().min[2], 0);
      const slice = s.t(s.t(wasm.Manifold.cube([0.01, wall + 1, 0.01], true)).translate([0, spec.radius - wall / 2, spec.z]));
      const section = s.t(loop.intersect(slice)).boundingBox();
      assert.ok(section.max[1] - section.min[1] >= wall * 0.99, "compact loops retain the selected tube thickness");
    } finally { s.done(true); }
  }
});

test("the joint coupon is compact relative to the suit and limbs without thinning its walls", async () => {
  const o = params(figure, { assembly: "flex", bow: "none", joint_coupon: true });
  await built(figure, buildFigure, o, ({ solids }) => {
    const combined = wasm.Manifold.union(solids.map(p => p.solid));
    try {
      assert.equal(decomposeCount(combined), 2);
      const box = combined.boundingBox();
      assert.ok(box.max[0] - box.min[0] <= o.limb_width_mm * 1.25, "links do not dominate the limb silhouette");
      assert.ok(box.max[1] - box.min[1] <= o.torso_width_mm * 0.65, "the pair is not a long oversized chain");
      assert.ok(box.max[2] <= o.limb_depth_mm * 1.5, "joint relief stays close to the limb depth");
    } finally { combined.delete(); }
  });
});

test("matching helical threads clear each other when seated and while turning", () => {
  const o = params(figure, { assembly: "threaded", head_depth_mm: 11 });
  const s = scope(wasm);
  try {
    const female = screw(s, o, true), male = screw(s, o);
    const spec = threadSpec(o);
    for (const angle of [0, 45, 90, 180]) {
      const moved = s.t(s.t(male.rotate([0, 0, angle])).translate([0, 0, spec.pitch * angle / 360]));
      const slab = s.t(s.t(wasm.Manifold.cube([30, 30, spec.height], true)).translate([0, 0, spec.height / 2]));
      const seated = s.t(moved.intersect(slab));
      assert.ok(s.t(seated.subtract(female)).volume() < 1e-4, `thread clashes at ${angle} degrees`);
    }
  } finally { s.done(true); }
});

test("builders free their WASM temporaries, including the helical thread mesh and moving links", async () => {
  for (const [g, build, over] of [[keychain, buildKeychain, {}], [figure, buildFigure, { assembly: "threaded", head_depth_mm: 11 }], [figure, buildFigure, { assembly: "flex", bow: "none" }]]) {
    const guard = trackLiveObjects(wasm);
    try {
      const result = await build(params(g, over), { wasm: guard.ctxWasm });
      assert.equal(guard.live.size, result.solids.length);
      result.solids.forEach(p => p.solid.delete());
      assert.equal(guard.live.size, 0);
    } finally { guard.restore(); }
  }
});
