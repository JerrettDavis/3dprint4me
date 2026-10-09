// Pumpkin geometry. The body is a closed parametric surface (pumpkin-shape.js); hollow shells
// subtract a scaled-in copy of the smooth shape; faces, a lattice, the stem pocket and a bowl's
// tongue-and-recess joint are booleans on top of that. Every temporary goes through `t` and is
// freed in `finally`; only the returned solids stay alive (buildModel frees those).
import { baseCut, cavityScale, faceBox, geometry, openCut, resolution, splitCut, surfaceMesh, tealightFit, TEALIGHT_OPENING_MM } from "../../../public/assets/js/customize/pumpkin-shape.js";
import { safeName } from "../../framework/model.js";
import { buildFace, faceSpec } from "./faces.js";
import { latticeCutter } from "./lattice.js";
import { solidFromMesh } from "./mesh.js";
import { pegHole, stemBody, stemSizes } from "./stem.js";

const FLOOR_MIN = 1.2;      // closed floor of a hollow shell (mm)
const LIP = 3.5;            // height of a bowl's tongue (mm)
const JOINT_GAP = 0.25;     // clearance between a bowl's tongue and its lid recess (mm)
const BED_GAP = 8;          // space between laid-out parts (mm)
const BED_WARN = 250;       // widest layout before we mention the printer bed (mm)
// Booleans along a face outline leave vertices a few millionths of a millimetre apart (float32
// noise), which the site's analyzer counts as zero-area triangles. Collapsing edges this short
// moves a surface by at most this much, far below anything printable.
const CLEAN_MM = 0.0005;

const free = o => { try { o?.delete?.(); } catch { /* best effort */ } };
const STYLE_TITLE = { solid: "solid", hollow: "hollow", vase: "vase", bowl: "bowl" };

export default async function build(p, ctx) {
  const { wasm } = ctx;
  const { Manifold, CrossSection } = wasm;
  const temps = [];
  const t = o => { if (o) temps.push(o); return o; };
  // An output solid is no longer a temporary.
  const keep = o => { const i = temps.indexOf(o); if (i >= 0) temps.splice(i, 1); return o; };
  const solids = [];
  const warnings = [];
  let ok = false;
  try {
    const g = geometry(p);
    const hollow = p.style === "hollow" || p.style === "bowl";
    const vase = p.style === "vase";
    const bowl = p.style === "bowl";
    const wall = p.wall_mm;
    const multi = p.multicolor;
    const color = c => (multi ? c : p.body_color);
    const topOpen = vase || (p.style === "hollow" && p.opening === "top");
    const stemMode = topOpen ? "none" : p.stem;

    let faceStyle = p.face === "none" || vase ? "none" : p.face_style;
    if (faceStyle === "cutout" && !hollow) throw new Error("A cut-through face needs a hollow shell or a bowl.");
    if (faceStyle === "inlay" && !multi) {
      faceStyle = "engraved";
      warnings.push("Single-color printing: the face is engraved instead of inlaid. Turn on Multi-color for a colored inlay.");
    }
    if (p.decoration === "lattice" && p.style !== "hollow") throw new Error("A lattice needs a hollow shell.");

    // ---- Outer surface, flat base and (vase / open top) the top cut ----
    const res = resolution(p);
    const rough = t(solidFromMesh(wasm, surfaceMesh(g, res, { withTexture: true })));
    const smooth = g.tex > 0 ? t(solidFromMesh(wasm, surfaceMesh(g, res, { withTexture: false }))) : rough;
    const base = baseCut(p, g);
    const zBase = base.z;
    let outer = t(rough.trimByPlane([0, 0, 1], zBase));
    if (topOpen) outer = t(outer.trimByPlane([0, 0, -1], -openCut(p, g).z));
    const shrunk = w => t(smooth.scale(cavityScale({ ...p, wall_mm: w }, g)));

    // ---- Hollow: subtract a scaled-in copy. The scaled copy must stay inside the real surface. ----
    let cavity = null, c0 = null;
    if (hollow) {
      c0 = shrunk(wall);
      const stray = t(c0.subtract(rough));
      if (stray.volume() > 1e-3) throw new Error("The wall doesn't fit inside this shape. Make the wall thinner or the shape milder.");
      if (p.style === "hollow" && p.opening === "bottom") {
        const floorLevel = Math.max(zBase, -g.b * cavityScale(p, g)[2]) + 0.6;
        const section = t(c0.slice(floorLevel));
        const column = t(t(section.extrude(floorLevel - zBase + 1.6)).translate([0, 0, zBase - 1]));
        cavity = t(Manifold.union([c0, column]));
      } else {
        cavity = t(c0.trimByPlane([0, 0, 1], zBase + Math.max(FLOOR_MIN, wall)));
      }
    }
    let shell = hollow ? t(outer.subtract(cavity)) : outer;
    const onePiece = (m, message) => {
      const parts = m.decompose();
      const n = parts.length;
      for (const x of parts) free(x);
      if (n !== 1) throw new Error(message);
    };

    // ---- Lattice ----
    if (p.decoration === "lattice") {
      const cutter = latticeCutter(wasm, p, g, zBase, wall, t);
      if (!cutter) throw new Error("The lattice has no room at this size. Use fewer rows, or make the pumpkin larger.");
      t(cutter);
      shell = t(shell.subtract(cutter));
      onePiece(shell, "The lattice holes would cut the pumpkin into pieces. Use fewer or smaller holes.");
    }

    // ---- Face ----
    const faceSolids = [];
    if (faceStyle !== "none") {
      const fb = faceBox(p, g);
      if (fb.top > g.b * 0.8) throw new Error("The face reaches the top of the pumpkin. Move the face lower or make it smaller.");
      if (fb.bottom < zBase + 2) throw new Error("The face reaches the base. Move the face higher or make it smaller.");
      const parts = buildFace(CrossSection, faceSpec(p), fb.width, t);
      const reach = g.a * (1 + g.ob) + 5;
      const prism = cs => t(t(t(cs.extrude(reach)).rotate([90, 0, 0])).translate([0, 0, fb.centerZ]));
      if (faceStyle === "cutout") {
        if (parts.main) shell = t(shell.subtract(prism(parts.main)));
        onePiece(shell, "The cut-through face would separate part of the pumpkin. Make the face smaller or use an inlay.");
      } else {
        const depth = Math.min(p.face_depth_mm, hollow ? (faceStyle === "engraved" ? Math.max(0.4, wall - 0.8) : wall) : Infinity);
        const skin = hollow && depth >= wall - 1e-9 ? c0 : shrunk(depth);
        const region = cs => t(t(prism(cs).intersect(outer)).subtract(skin));
        for (const [name, cs, c] of [["Face", parts.main, p.face_color], ["Cheeks", parts.accent, p.cheek_color]]) {
          if (!cs) continue;
          const inlay = region(cs);
          shell = t(shell.subtract(inlay));
          if (faceStyle === "inlay") faceSolids.push({ name, solid: inlay, color: color(c) });
        }
      }
    }

    // ---- Stem fitting (on the shell, or on the lid for a bowl) ----
    const pocketDepth = hollow ? Math.max(0.4, Math.min(1, wall - 0.8)) : 2;
    const sizes = stemSizes(p, pocketDepth);
    const zPole = g.profile(Math.PI).z;
    const zFloor = zPole - pocketDepth;
    let stem = null;               // { solid, loose }
    const fitStem = top => {
      if (stemMode === "none") return top;
      const pocketR = sizes.flangeR + (stemMode === "peg" ? 0.2 : 0);
      let body = top;
      if (stemMode === "peg") {
        if (hollow) {
          const tubeR = p.peg_diameter_mm / 2 + p.peg_clearance_mm + 1.6;
          const height = p.peg_length_mm + 1.8;
          const tube = t(t(t(CrossSection.circle(tubeR, 40)).extrude(height)).translate([0, 0, zFloor + 0.3 - height]));
          body = t(Manifold.union([body, tube]));
        }
        const hole = t(t(pegHole(wasm, p, p.peg_length_mm + 0.8, t)).translate([0, 0, zFloor]));
        body = t(body.subtract(hole));
      }
      if (stemMode === "peg" || multi) {
        const pocket = t(t(t(CrossSection.circle(pocketR, 48)).extrude(pocketDepth + 12)).translate([0, 0, zFloor]));
        body = t(body.subtract(pocket));
      }
      const whole = t(stemBody(wasm, p, pocketDepth, stemMode === "peg"));
      stem = { solid: whole, loose: stemMode === "peg" };
      if (stemMode === "fused" && !multi) { body = t(Manifold.union([body, t(whole.translate([0, 0, zFloor]))])); stem = null; }
      return body;
    };

    // ---- Bowl: split, tongue on the bowl, recess in the lid ----
    let bowlSolid = null, lidSolid = null;
    let bodySolid = shell;
    if (bowl) {
      const zs = splitCut(p, g).z;
      bowlSolid = t(shell.trimByPlane([0, 0, -1], -zs));
      let lid = t(shell.trimByPlane([0, 0, 1], zs));
      const section = t(c0.slice(zs));
      const column = (cs, h, z) => t(t(cs.extrude(h)).translate([0, 0, z]));
      const half = wall / 2;
      const tongue = t(t(column(t(section.offset(half - JOINT_GAP, "Round", 2, 48)), LIP + 0.4, zs - 0.4).intersect(shrunk(half + JOINT_GAP))).subtract(c0));
      bowlSolid = t(Manifold.union([bowlSolid, tongue]));
      const recess = t(column(t(section.offset(half + 0.1, "Round", 2, 48)), LIP + 0.6, zs - 0.4).intersect(shrunk(half)));
      lid = t(lid.subtract(recess));
      lidSolid = fitStem(lid);
      bodySolid = bowlSolid;
      onePiece(lidSolid, "The lid would come out in pieces. Move the lid split or change the stem settings.");
    } else {
      bodySolid = fitStem(shell);
    }

    // ---- Lay out on the bed (z = 0) ----
    const dz = -zBase;
    const finish = m => keep(t(t(m).simplify(CLEAN_MM)));
    const bodyFinal = finish(bodySolid.translate([0, 0, dz]));
    solids.push({ name: bowl ? "Bowl" : "Pumpkin", solid: bodyFinal, color: p.body_color });
    for (const f of faceSolids) solids.push({ name: f.name, solid: finish(f.solid.translate([0, 0, dz])), color: f.color });
    let right = bodyFinal.boundingBox().max[0];
    let stemAnchor = null;     // the stem's fused/loose placement for a lid
    if (bowl) {
      const zs = splitCut(p, g).z;
      const lidBox = lidSolid.boundingBox();
      const dx = right + BED_GAP - lidBox.min[0];
      const lidFinal = finish(lidSolid.translate([dx, 0, -zs]));
      solids.push({ name: "Lid", solid: lidFinal, color: p.body_color });
      right = lidFinal.boundingBox().max[0];
      stemAnchor = { dx, dz: -zs };
    }
    if (stem && stemMode !== "none") {
      const anchor = stemAnchor ?? { dx: 0, dz };
      let placed;
      if (stem.loose) {
        const flipped = t(stem.solid.rotate([180, 0, 0]));
        const box = flipped.boundingBox();
        placed = finish(flipped.translate([right + BED_GAP + sizes.flangeR - (box.min[0] + box.max[0]) / 2, 0, -box.min[2]]));
        right = placed.boundingBox().max[0];
      } else {
        placed = finish(stem.solid.translate([anchor.dx, 0, zFloor + anchor.dz]));
      }
      solids.push({ name: "Stem", solid: placed, color: color(p.stem_color) });
    }

    // ---- Notes for the customer ----
    const tall = bodyFinal.boundingBox();
    if (vase) warnings.push("Slice with your slicer's Spiral vase (single wall) mode: it prints the outline and leaves the top open. Use at least 3 solid bottom layers.");
    if (hollow && !topOpen) {
      if (p.style === "hollow" && p.opening === "closed" && faceStyle !== "cutout" && p.decoration !== "lattice") warnings.push("A sealed hollow pumpkin traps its print supports inside. Choose Open bottom, or cut the face through, so they can come out.");
      else warnings.push("Print with supports: the inside of the dome needs them." + (bowl ? " Print the lid on its flat rim." : ""));
    }
    if (p.style === "hollow" && p.opening === "bottom") {
      const fit = tealightFit(p);
      warnings.push(fit.opening >= TEALIGHT_OPENING_MM ? `Inside: about ${fit.opening.toFixed(0)} mm wide and ${fit.height.toFixed(0)} mm tall, enough for a standard tealight.` : `Inside: about ${fit.opening.toFixed(0)} mm wide, narrower than a standard 38 mm tealight. Turn on "Fit a tealight" or make the pumpkin larger.`);
    }
    if (stem?.loose) warnings.push("The stem prints on its own, upside down; its D-shaped peg goes into the hole in the top, flat side matched.");
    if (res.nu * res.rows > 60000) warnings.push("This pumpkin has a lot of surface detail and may take a moment to preview.");
    const span = Math.max(right - tall.min[0], tall.max[1] - tall.min[1]);
    if (span > BED_WARN) warnings.push(`The parts laid out side by side are about ${Math.round(span)} mm wide; check that they fit your printer's bed or split them in the slicer.`);

    ok = true;
    const label = p.face !== "none" && !vase ? ` ${p.face}` : "";
    return { solids, warnings, title: `Pumpkin (${STYLE_TITLE[p.style]}${label})`, filenameBase: safeName(`pumpkin-${p.style}-${Math.round(p.diameter_mm)}mm`) };
  } finally {
    for (const o of temps) free(o);
    if (!ok) for (const s of solids) free(s.solid);
  }
}
