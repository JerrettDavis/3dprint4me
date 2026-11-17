import { figureLayout, threadSpec } from "../../../public/assets/js/customize/skeleton.js";
import { beam, jointPair, jointSpec, scope, screw, skull } from "../skeleton/geometry.js";
import { bow, cuffCut, hand, jacket, roundedBeam, shoe, suitInlay, tailoredLimb } from "../skeleton/figure-parts.js";

export default async function build(o, { wasm }) {
  const s = scope(wasm), { t } = s, { Manifold, CrossSection } = wasm;
  let ok = false;
  try {
    const warnings = ["Print as exported, backs on the bed. The generated skull, shaped jacket, bent limbs and curled fingers still need careful handling. Elbows and knees are sculpted, not moving joints. Strength and support requirements need real test prints."];
    if (o.assembly === "flex") warnings.push("Rigid interlocked links, not TPU flexures. Test the joint coupon first. Keep supports out of the joint gaps; compensate for elephant foot and verify free movement before printing the full figure.");
    if (o.assembly === "threaded") warnings.push("The head screws onto a bed-normal neck stud, not an upright neck. Print the fit coupon first; the blind head bore needs a short bridge. Never force a tight thread.");
    const finish = () => { ok = true; return { solids: s.solids, warnings, title: "Skeleton figure" }; };
    const shifted = (solid, xy, z = 0) => t(solid.translate([...xy, z]));
    const union = items => t(Manifold.union(items));
    const roundPad = (r, depth) => t(t(CrossSection.circle(r, 64)).extrude(depth));
    if (o.assembly === "threaded" && o.fit_coupon) {
      const spec = threadSpec(o);
      s.add("Body thread coupon", o.body_color, union([roundPad(spec.radius + 3, 2), shifted(screw(s, o), [0, 0], 2)]));
      const socket = t(roundPad(spec.radius + 3, spec.height).subtract(screw(s, o, true)));
      s.add("Skull socket coupon", o.skull_color, shifted(socket, [2 * spec.radius + 12, 0]));
      return finish();
    }
    if (o.assembly === "flex" && o.joint_coupon) {
      const pair = jointPair(s, o, [0, 0], [0, 1]);
      s.add("Body joint coupon", o.body_color, pair.proximal);
      s.add("Limb joint coupon", o.body_color, pair.distal);
      return finish();
    }
    const l = figureLayout(o), depth = o.body_depth_mm, limbDepth = o.limb_depth_mm, width = o.limb_width_mm;
    const bodyParts = [jacket(s, o)];
    const hands = [], limbInlays = [];
    const coloredLimb = (name, solid, inlay, separate) => {
      if (inlay) {
        const ink = t(inlay.intersect(solid));
        if (separate) {
          solid = t(solid.subtract(ink));
          s.add(`${name} pinstripes`, o.shirt_color, ink);
        }
        else limbInlays.push(ink);
      }
      if (separate) s.add(name, o.body_color, solid);
      else bodyParts.push(solid);
    };
    const addArm = (name, sleeve, elbow, wrist, side, separate, inlay) => {
      sleeve = cuffCut(s, sleeve, elbow, wrist);
      const fingers = hand(s, o, wrist, side, [wrist[0] - elbow[0], wrist[1] - elbow[1]]);
      if (o.multicolor) {
        hands.push(fingers);
        s.add(name.replace("Arm", "Hand"), o.skull_color, fingers);
        const cut = t(sleeve.subtract(fingers));
        coloredLimb(name, cut, inlay, separate);
      } else {
        const whole = union([sleeve, fingers]);
        if (separate) s.add(name, o.body_color, whole);
        else bodyParts.push(whole);
      }
    };
    const addLeg = (name, leg, side, separate, connector) => {
      const limb = tailoredLimb(s, o, leg.hip, leg.knee, leg.ankle, "leg");
      const solid = union([limb.solid, shoe(s, o, leg.ankle, side), ...(connector ? [connector] : [])]);
      coloredLimb(name, solid, limb.inlay, separate);
    };
    const head = skull(s, o, { bore: o.assembly === "threaded" });
    let headPosition = [0, l.headY];
    let headBody = head.body, fusedNeck;
    if (o.assembly === "flex") {
      const js = jointSpec(o);
      const connectorDepth = Math.max(limbDepth, js.z + o.joint_wall_mm / 2);
      const connectorWidth = Math.min(width, o.joint_wall_mm + 1);
      const neckWidth = Math.min(o.neck_width_mm, o.joint_wall_mm + 1);
      const loopCenterRadius = js.radius - o.joint_wall_mm / 2;
      // Spread the hinge anchors beyond the torso, so links cannot collide with adjacent limbs.
      const neckA = [0, l.top + js.radius + 3];
      const neck = jointPair(s, o, neckA, [0, 1]);
      bodyParts.push(roundedBeam(s, [0, l.top - 1], [0, neckA[1] - loopCenterRadius], o.neck_width_mm, connectorDepth, neckWidth), neck.proximal);
      headPosition = [0, neck.end[1] + o.neck_length_mm + o.head_height_mm * 0.5];
      headBody = union([shifted(head.body, headPosition), neck.distal, roundedBeam(s, neck.end, [0, headPosition[1] - o.head_height_mm * 0.4], neckWidth, connectorDepth, o.neck_width_mm)]);
      const rightArm = l.arms[1], rightLeg = l.legs[1];
      const handBounds = hand(s, o, rightArm.wrist, 1, rightArm.wrist.map((v, i) => v - rightArm.elbow[i])).boundingBox();
      const armInner = Math.min(handBounds.min[0], ...[rightArm.shoulder, rightArm.elbow, rightArm.wrist].map(p => p[0] - width * 0.6));
      const legInner = Math.min(-width * 0.6,
        rightLeg.knee[0] - rightLeg.hip[0] - width * 0.6,
        rightLeg.ankle[0] - rightLeg.hip[0] + o.foot_length_mm * 0.3 - (o.foot_length_mm + width) / 2);
      const hipX = Math.max(js.radius + o.joint_clearance_mm + 1, o.joint_clearance_mm / 2 + 0.5 - legInner);
      const legOuter = hipX + Math.max(width * 0.6,
        rightLeg.knee[0] - rightLeg.hip[0] + width * 0.6,
        rightLeg.ankle[0] - rightLeg.hip[0] + o.foot_length_mm * 0.3 + (o.foot_length_mm + width) / 2);
      const childShoulder = o.torso_width_mm / 2 + 2 * js.radius + js.distance + 6 - o.joint_wall_mm / 2;
      // Large hands on short torsos can reach the hip links and legs at maximum elbow bend.
      const armSpread = Math.max(0, legOuter + o.joint_clearance_mm + 1 - (childShoulder - rightArm.shoulder[0] + armInner));
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -1 : 1, arm = l.arms[i], leg = l.legs[i];
        const armA = [side * (o.torso_width_mm / 2 + js.radius + 3 + armSpread), l.top - 3];
        const pair = jointPair(s, o, armA, [side, 0]);
        bodyParts.push(roundedBeam(s, arm.shoulder, [armA[0] - side * loopCenterRadius, armA[1]], width, connectorDepth, connectorWidth), pair.proximal);
        const shift = [pair.end[0] - arm.shoulder[0] + side * 3, pair.end[1] - arm.shoulder[1]];
        const move = p => [p[0] + shift[0], p[1] + shift[1]];
        const wrist = move(arm.wrist);
        const sleeve = tailoredLimb(s, o, move(arm.shoulder), move(arm.elbow), wrist, "arm");
        addArm(`Arm ${i + 1}`, union([pair.distal, roundedBeam(s, pair.end, move(arm.shoulder), connectorWidth, connectorDepth, width), sleeve.solid]), move(arm.elbow), wrist, side, true, sleeve.inlay);
        const hipA = [side * hipX, l.bottom - js.radius - 3];
        const hip = jointPair(s, o, hipA, [0, -1]);
        bodyParts.push(roundedBeam(s, leg.hip, [hipA[0], hipA[1] + loopCenterRadius], width, connectorDepth, connectorWidth), hip.proximal);
        const legShift = [hip.end[0] - leg.hip[0], hip.end[1] - leg.hip[1] - 3];
        const lm = p => [p[0] + legShift[0], p[1] + legShift[1]];
        addLeg(`Leg ${i + 1}`, { hip: lm(leg.hip), knee: lm(leg.knee), ankle: lm(leg.ankle) }, side, true, union([hip.distal, roundedBeam(s, hip.end, lm(leg.hip), connectorWidth, connectorDepth, width)]));
      }
    } else {
      for (let i = 0; i < l.arms.length; i++) {
        const arm = l.arms[i];
        const sleeve = tailoredLimb(s, o, arm.shoulder, arm.elbow, arm.wrist, "arm");
        addArm(`Arm ${i + 1}`, sleeve.solid, arm.elbow, arm.wrist, i === 0 ? -1 : 1, false, sleeve.inlay);
      }
      for (let i = 0; i < l.legs.length; i++) addLeg(`Leg ${i + 1}`, l.legs[i], l.legs[i].side, false);
      if (o.assembly === "threaded") {
        const spec = threadSpec(o);
        bodyParts.push(beam(s, [0, l.top - 1], headPosition, o.neck_width_mm, depth), shifted(roundPad(spec.radius + 2, depth), headPosition), shifted(screw(s, o), headPosition, depth));
        headPosition = [Math.max(...l.arms.map(a => Math.abs(a.wrist[0]))) + o.hand_width_mm * 1.2 + o.head_width_mm / 2 + width + 8, l.headY];
      } else {
        fusedNeck = roundedBeam(s, [0, l.top - 1], [0, l.headY - o.head_height_mm * 0.4], o.neck_width_mm, limbDepth);
        bodyParts.push(fusedNeck);
      }
      headBody = shifted(head.body, headPosition);
      if (fusedNeck && o.multicolor) headBody = union([headBody, fusedNeck]);
    }
    let body = union(bodyParts);
    if (hands.length) body = t(body.subtract(union(hands)));
    if (o.multicolor && o.assembly !== "threaded") body = t(body.subtract(headBody));
    if (o.bow !== "none") {
      const bowSolid = bow(s, o, o.bow === "fused");
      if (o.bow === "separate") {
        const right = Math.max(body.boundingBox().max[0], ...s.solids.filter(p => p.name.startsWith("Hand")).map(p => p.solid.boundingBox().max[0]));
        s.add("Bow glue-on", o.bow_color, shifted(bowSolid, [right + o.bow_width_mm / 2 + 8, l.bottom - 15]));
      }
      else {
        let placed = shifted(bowSolid, [0, l.top + 1]);
        if (o.assembly !== "threaded") placed = t(placed.subtract(headBody));
        if (o.multicolor) {
          body = t(body.subtract(placed));
          s.add("Bow", o.bow_color, placed);
        } else body = union([body, placed]);
      }
    }
    if (o.multicolor) {
      const suit = union([suitInlay(s, o, body), ...limbInlays.map(ink => t(ink.intersect(body)))]);
      body = t(body.subtract(suit));
      s.add("Suit shirt and pinstripes", o.shirt_color, suit);
    }
    if (!o.multicolor && o.assembly === "fused") {
      body = union([body, headBody]);
      s.add("Body and skull", o.body_color, body);
    } else {
      if (o.assembly !== "threaded") body = t(body.subtract(headBody));
      s.add("Body", o.body_color, body);
      s.add("Skull", o.multicolor ? o.skull_color : o.body_color, headBody);
    }
    if (o.multicolor) s.add("Face inlays", o.face_color, shifted(head.face, headPosition));
    return finish();
  } finally { s.done(ok); }
}
