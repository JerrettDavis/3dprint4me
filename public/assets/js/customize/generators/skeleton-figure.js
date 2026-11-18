import { choice, number, skullRules, skullSchema, threadSpec } from "../skeleton.js?v=8cfde5de2cda44f2";

const threaded = { assembly: "threaded" }, flex = { assembly: "flex" };
export default {
  id: "skeleton-figure", version: 6, title: "Skeleton figure",
  blurb: "An algorithmic skull, fitted pinstripe suit, smoothly bent limbs and articulated-looking fingers, designed for back printing or interlocked joints.",
  category: "seasonal", origin: "house",
  rights: { publishable: true, note: "Algorithmic house geometry with reference-informed proportions; no source mesh or sampled source surface is distributed. Reference artwork rights still apply." },
  initialView: "3d",
  sections: { body: "Body and assembly", suit: "Suit", head: "Head", face: "Face", arms: "Arms and hands", legs: "Legs", bow: "Bow", joints: "Joints" },
  focus: [{ part: "Body", section: "body" }, { part: "Suit", section: "suit" }, { part: "Skull", section: "head" }, { part: "Face", section: "face" }, { part: "Hand", section: "arms" }, { part: "Arm", section: "arms" }, { part: "Leg", section: "legs" }, { part: "Bow", section: "bow" }],
  schema: {
    ...skullSchema,
    head_width_mm: { ...skullSchema.head_width_mm, default: 64.5 },
    head_height_mm: { ...skullSchema.head_height_mm, default: 58.5 },
    head_depth_mm: { ...skullSchema.head_depth_mm, default: 33.5 },
    chin_fullness_pct: { ...skullSchema.chin_fullness_pct, default: 105 },
    tooth_count: { ...skullSchema.tooth_count, default: 16 },
    assembly: choice("Assembly", "fused", [["fused", "Fused flat-back figure"], ["threaded", "Separate screw-on head"], ["flex", "Interlocked flexi figure"]], "body"),
    torso_length_mm: number("Torso length", 44, 30, 65, 1, "body"),
    torso_width_mm: number("Torso width", 24, 14, 32, 1, "body"),
    body_depth_mm: number("Jacket depth", 7, 3, 8, 0.5, "body"),
    limb_depth_mm: number("Limb depth", 5, 2, 8, 0.5, "body"),
    limb_width_mm: number("Limb thickness", 7, 3, 8, 0.5, "body", { help: "Width in the bed plane. All long limbs print along the layers, not upright." }),
    neck_length_mm: number("Neck length", 10, 8, 20, 1, "head"),
    neck_width_mm: number("Neck thickness", 6, 4, 10, 0.5, "head"),
    upper_arm_mm: number("Upper arm length", 28, 20, 45, 1, "arms"),
    forearm_mm: number("Forearm length", 25, 18, 40, 1, "arms"),
    elbow_bend_deg: number("Elbow bend", 18, 0, 40, 1, "arms", { unit: "deg", help: "Bends the forearm in the bed plane. The back stays flat; the elbow is sculpted, not a moving joint." }),
    hand_length_mm: number("Hand length", 23, 10, 30, 1, "arms"),
    hand_width_mm: number("Hand width", 8, 5, 12, 0.5, "arms"),
    finger_width_mm: number("Finger thickness", 1.8, 1.2, 3, 0.2, "arms", { help: "Curved fingers and thumb are retained. Increase for less delicate handling." }),
    thigh_mm: number("Thigh length", 32, 22, 50, 1, "legs"),
    shin_mm: number("Shin length", 30, 22, 50, 1, "legs"),
    knee_bend_deg: number("Knee bend", 10, 0, 16, 1, "legs", { unit: "deg", help: "Shapes the knee in the bed plane while retaining separate legs and a flat back. Not a moving knee joint." }),
    foot_length_mm: number("Foot length", 14, 8, 20, 1, "legs"),
    bow: choice("Bow", "fused", [["fused", "Branched attached bow"], ["separate", "Separate flat glue-on bow"], ["none", "No bow"]], "bow"),
    bow_width_mm: number("Bow width", 44, 24, 60, 1, "bow", { visibleWhen: { bow: ["fused", "separate"] } }),
    bow_branch_mm: number("Bow branch thickness", 2, 1.5, 4, 0.5, "bow", { visibleWhen: { bow: ["fused", "separate"] } }),
    bow_depth_mm: number("Bow thickness", 2, 1.5, 3, 0.5, "bow", { visibleWhen: { bow: ["fused", "separate"] }, advanced: true }),
    joint_wall_mm: number("Joint loop wall", 2.4, 2, 3.2, 0.2, "joints", { visibleWhen: flex, help: "Round-section rigid interlocked loops, printed together at opposite 45-degree angles. Sets the tube thickness, not the loop diameter. No TPU needed." }),
    joint_clearance_mm: number("Joint clearance", 0.5, 0.4, 0.8, 0.05, "joints", { visibleWhen: flex, help: "Minimum separation between neighboring links. Test the joint coupon first; elephant foot can fuse gaps." }),
    joint_coupon: { type: "bool", label: "Export joint test coupon only", default: false, section: "joints", group: "layout", visibleWhen: flex },
    thread_diameter_mm: number("Neck screw diameter", 8, 7, 11, 0.5, "joints", { visibleWhen: threaded }),
    thread_clearance_mm: number("Thread radial clearance", 0.3, 0.2, 0.6, 0.05, "joints", { visibleWhen: threaded, help: "Per-side clearance. Start with a fit coupon before printing the full figure." }),
    fit_coupon: { type: "bool", label: "Export thread fit coupon only", default: false, section: "joints", group: "layout", visibleWhen: threaded },
    body_color: { type: "color", label: "Body color", default: "#20232a", section: "body", group: "colors" },
    coat_tail_mm: number("Coat tail length", 16, 0, 20, 1, "suit", { visibleWhen: { assembly: ["fused", "threaded"] }, advanced: true }),
    jacket_waist_pct: number("Jacket waist", 65, 40, 85, 5, "suit", { unit: "%", advanced: true }),
    pinstripes: { type: "bool", label: "Suit pinstripes", default: true, section: "suit", group: "layout" },
    stripe_spacing_mm: number("Pinstripe spacing", 2.5, 2, 5, 0.5, "suit", { visibleWhen: { pinstripes: true }, advanced: true }),
    stripe_width_mm: number("Pinstripe width", 0.5, 0.4, 0.8, 0.1, "suit", { visibleWhen: { pinstripes: true }, advanced: true }),
    shirt_color: { type: "color", label: "Shirt and pinstripe color", default: "#f2eee2", section: "suit", group: "colors", visibleWhen: { multicolor: true } },
    bow_color: { type: "color", label: "Bow color", default: "#20232a", section: "bow", group: "colors", visibleWhen: { bow: ["fused", "separate"] } }
  },
  rules(o) {
    const r = skullRules(o);
    const add = (key, msg) => { r.errors.push(msg); r.fieldErrors[key] = msg; };
    if (o.assembly === "threaded") {
      const t = threadSpec(o);
      if (t.height < t.pitch * 1.25) add("head_depth_mm", "A screw-on head needs at least 10 mm depth for 1.25 turns plus a solid face skin.");
      r.limits.head_depth_mm = [10, 40];
    }
    if (o.assembly === "flex") {
      if (o.bow === "fused") add("bow", "Choose a separate bow or no bow so it cannot bridge the moving neck joint.");
    }
    if (o.limb_width_mm > o.torso_width_mm * 0.45) add("limb_width_mm", "Limb thickness must be at most 45% of torso width to keep the legs apart.");
    return r;
  },
  onParamChange(key, o) {
    if (key === "assembly" && o.assembly === "threaded") return { head_depth_mm: Math.max(10, o.head_depth_mm) };
    if (key === "assembly" && o.assembly === "flex") return { bow: o.bow === "fused" ? "none" : o.bow };
    return {};
  },
  presets: { fused: {}, threaded: { assembly: "threaded" }, flex: { assembly: "flex", bow: "none" }, sturdy: { limb_width_mm: 8, body_depth_mm: 7, limb_depth_mm: 6, neck_width_mm: 8, hand_width_mm: 7, finger_width_mm: 2.4 } },
  defaultDesign: "fused",
  designs: [
    { id: "fused", label: "Flat-back skeleton", blurb: "Algorithmic skull, fitted suit and curved hands.", params: {} },
    { id: "threaded", label: "Screw-on head", blurb: "Separate algorithmic skull and a flat branched bow.", params: { assembly: "threaded", bow: "separate" } },
    { id: "flex", label: "Interlocked flexi skeleton", blurb: "Separate rigid pieces linked at the neck, shoulders and hips; no TPU.", params: { assembly: "flex", bow: "none" } },
    { id: "sturdy", label: "Chunky skeleton", blurb: "Thicker limbs, fingers and neck for less delicate handling.", params: { limb_width_mm: 8, body_depth_mm: 7, limb_depth_mm: 6, neck_width_mm: 8, hand_width_mm: 7, finger_width_mm: 2.4 } }
  ]
};
