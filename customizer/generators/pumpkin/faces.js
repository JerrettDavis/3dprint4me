// Pumpkin faces as 2D shapes (mm, +Y up, centered on the face). Every shape is built from a width
// `W`; features are placed by fractions of it. The builder extrudes the result through the front of
// the pumpkin (cut through, inlaid or engraved). Temporaries go through `t` (freed by the caller).

// Eyes, nose and mouth per preset. Positions are fractions of the face width W; sizes too.
export const FACE_PRESETS = {
  traditional: { eye: "triangle", nose: "triangle", mouth: "jagged", eyeSize: 0.2, eyeX: 0.2, eyeY: 0.14, noseSize: 0.11, noseY: -0.04, mouthW: 0.62, mouthY: -0.22 },
  cute: { eye: "oval", nose: "none", mouth: "smile", eyeSize: 0.15, eyeX: 0.21, eyeY: 0.08, noseSize: 0.1, noseY: -0.04, mouthW: 0.24, mouthY: -0.08, cheeks: true },
  happy: { eye: "happy", nose: "none", mouth: "grin", eyeSize: 0.2, eyeX: 0.21, eyeY: 0.12, noseSize: 0.1, noseY: -0.04, mouthW: 0.5, mouthY: -0.16, cheeks: true },
  spooky: { eye: "angry", nose: "triangle", mouth: "jagged", eyeSize: 0.22, eyeX: 0.2, eyeY: 0.14, noseSize: 0.11, noseY: -0.05, mouthW: 0.8, mouthY: -0.24 },
  surprised: { eye: "circle", nose: "round", mouth: "round", eyeSize: 0.17, eyeX: 0.2, eyeY: 0.12, noseSize: 0.09, noseY: -0.04, mouthW: 0.3, mouthY: -0.2 },
  sleepy: { eye: "slit", nose: "none", mouth: "smile", eyeSize: 0.19, eyeX: 0.21, eyeY: 0.08, noseSize: 0.1, noseY: -0.04, mouthW: 0.3, mouthY: -0.12 },
  // The familiar faces: domed eyes with a small open mouth and blush; the wide-eyed epic grin;
  // sunglasses; a wink; heart and star eyes; tongue out; a cat; angry; scared.
  adorable: { eye: "dome", nose: "none", mouth: "open", eyeSize: 0.22, eyeX: 0.2, eyeY: 0.1, noseSize: 0.1, noseY: -0.04, mouthW: 0.26, mouthY: -0.1, cheeks: true },
  awesome: { eye: "oval", nose: "none", mouth: "open", eyeSize: 0.17, eyeX: 0.2, eyeY: 0.14, noseSize: 0.1, noseY: -0.04, mouthW: 0.66, mouthY: -0.1 },
  cool: { eye: "shades", nose: "none", mouth: "smile", eyeSize: 0.19, eyeX: 0.2, eyeY: 0.1, noseSize: 0.1, noseY: -0.04, mouthW: 0.34, mouthY: -0.16 },
  wink: { eye: "oval", eyeR: "happy", nose: "none", mouth: "open", eyeSize: 0.17, eyeX: 0.21, eyeY: 0.1, noseSize: 0.1, noseY: -0.04, mouthW: 0.3, mouthY: -0.1, cheeks: true },
  love: { eye: "heart", nose: "none", mouth: "smile", eyeSize: 0.2, eyeX: 0.2, eyeY: 0.1, noseSize: 0.1, noseY: -0.04, mouthW: 0.34, mouthY: -0.1, cheeks: true },
  starstruck: { eye: "star", nose: "none", mouth: "open", eyeSize: 0.23, eyeX: 0.21, eyeY: 0.12, noseSize: 0.1, noseY: -0.04, mouthW: 0.5, mouthY: -0.12 },
  tongue: { eye: "oval", eyeR: "happy", nose: "none", mouth: "tongue", eyeSize: 0.16, eyeX: 0.21, eyeY: 0.1, noseSize: 0.1, noseY: -0.04, mouthW: 0.44, mouthY: -0.1, cheeks: true },
  cat: { eye: "triangle", nose: "triangle", mouth: "cat", eyeSize: 0.17, eyeX: 0.21, eyeY: 0.1, noseSize: 0.08, noseY: -0.06, mouthW: 0.4, mouthY: -0.1 },
  angry: { eye: "angry", nose: "none", mouth: "zigzag", eyeSize: 0.2, eyeX: 0.2, eyeY: 0.12, noseSize: 0.1, noseY: -0.04, mouthW: 0.5, mouthY: -0.2 },
  scared: { eye: "circle", nose: "none", mouth: "wavy", eyeSize: 0.2, eyeX: 0.2, eyeY: 0.12, noseSize: 0.1, noseY: -0.04, mouthW: 0.52, mouthY: -0.2 }
};

/** The settings for a face (a preset, or the custom feature choices). */
export function faceSpec(p) {
  if (p.face === "custom") {
    return { eye: p.eye_shape, nose: p.nose_shape, mouth: p.mouth_shape, eyeSize: 0.17, eyeX: 0.21, eyeY: 0.12, noseSize: 0.1, noseY: -0.04, mouthW: 0.5, mouthY: -0.18, cheeks: Boolean(p.cheeks) };
  }
  return { ...FACE_PRESETS[p.face], cheeks: Boolean(FACE_PRESETS[p.face]?.cheeks && p.cheeks) };
}

const ccw = pts => {
  let area = 0;
  for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; area += x1 * y2 - x2 * y1; }
  return area < 0 ? [...pts].reverse() : pts;
};

export function buildFace(CrossSection, spec, W, t) {
  const poly = pts => t(CrossSection.ofPolygons([ccw(pts)]));
  const circle = r => t(CrossSection.circle(r, 40));
  const at = (cs, x, y) => t(cs.translate([x, y]));
  const union = list => t(CrossSection.union(list));
  const sub = (a, b) => t(a.subtract(b));
  const lowerHalf = r => poly([[-r * 2, -r * 2], [r * 2, -r * 2], [r * 2, 0], [-r * 2, 0]]);
  const sector = (centerDeg, halfDeg, R) => {
    const pts = [[0, 0]];
    for (let i = 0; i <= 16; i++) { const a = (centerDeg - halfDeg + (2 * halfDeg * i) / 16) * Math.PI / 180; pts.push([R * Math.cos(a), R * Math.sin(a)]); }
    return poly(pts);
  };
  // A bar from a to b with round ends.
  const bar = ([ax, ay], [bx, by], th) => {
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, nx = -dy / len * th / 2, ny = dx / len * th / 2;
    return union([poly([[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]]), at(circle(th / 2), ax, ay), at(circle(th / 2), bx, by)]);
  };

  const eyeShape = (kind, s, side) => {
    switch (kind) {
      case "circle": return circle(s / 2);
      case "oval": return t(circle(s / 2).scale([1, 1.3]));
      case "triangle": return poly([[-s * 0.55, -s * 0.4], [s * 0.55, -s * 0.4], [0, s * 0.6]]);
      case "angry": return poly(side < 0 ? [[-s * 0.5, -s * 0.3], [s * 0.5, -s * 0.3], [-s * 0.5, s * 0.45]] : [[-s * 0.5, -s * 0.3], [s * 0.5, -s * 0.3], [s * 0.5, s * 0.45]]);
      case "happy": return sub(sub(circle(s * 0.55), circle(s * 0.3)), at(lowerHalf(s), 0, -s * 0.05));
      case "slit": return t(t(CrossSection.square([s * 0.9, s * 0.1], true)).offset(s * 0.07, "Round", 2, 16));
      case "star": {
        const pts = [];
        for (let i = 0; i < 10; i++) { const r = (i % 2 ? 0.24 : 0.55) * s, a = Math.PI / 2 + i * Math.PI / 5; pts.push([r * Math.cos(a), r * Math.sin(a)]); }
        return poly(pts);
      }
      case "heart": {
        const pts = [];
        for (let i = 0; i < 48; i++) {
          const a = (i / 48) * Math.PI * 2;
          pts.push([(16 * Math.sin(a) ** 3) / 32 * s * 1.05, (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) / 32 * s * 1.05 + s * 0.05]);
        }
        return poly(pts);
      }
      case "diamond": return poly([[0, s * 0.6], [s * 0.45, 0], [0, -s * 0.6], [-s * 0.45, 0]]);
      // A dome: round on top, flat underneath.
      case "dome": return sub(circle(s * 0.55), at(lowerHalf(s), 0, -s * 0.15));
      // One sunglasses lens; the bridge joining the two is added with the eyes.
      case "shades": return t(poly([[-s * 0.6, s * 0.35], [s * 0.6, s * 0.35], [s * 0.5, -s * 0.4], [-s * 0.5, -s * 0.4]]).offset(s * 0.12, "Round", 2, 16));
      default: return circle(s / 2);
    }
  };

  const noseShape = (kind, s) => {
    switch (kind) {
      case "triangle": return poly([[-s * 0.5, -s * 0.4], [s * 0.5, -s * 0.4], [0, s * 0.55]]);
      case "round": return circle(s * 0.45);
      case "diamond": return poly([[0, s * 0.55], [s * 0.4, 0], [0, -s * 0.55], [-s * 0.4, 0]]);
      case "nostrils": return union([at(circle(s * 0.2), -s * 0.3, 0), at(circle(s * 0.2), s * 0.3, 0)]);
      default: return null;
    }
  };

  const arc = (w, up) => {
    const half = 55, R = w / (2 * Math.sin(half * Math.PI / 180)), th = Math.max(2.4, 0.22 * R);
    const ring = sub(circle(R), circle(R - th));
    const cut = t(ring.intersect(sector(up ? 90 : -90, half, R * 1.1)));
    return t(cut.translate([0, up ? -R * Math.cos(half * Math.PI / 180) : R * Math.cos(half * Math.PI / 180)]));
  };

  const mouthShape = (kind, w) => {
    const R = w / 2;
    switch (kind) {
      case "smile": return arc(w, false);
      case "grin": return t(t(circle(R).intersect(lowerHalf(R))).scale([1, 0.85]));
      case "round": return t(circle(w * 0.3).scale([0.85, 1.15]));
      // A small open mouth: flat across the top with softened corners, round below.
      case "open": {
        const d = t(t(circle(R).intersect(lowerHalf(R))).scale([1, 0.95])), r = R * 0.18;
        return t(t(d.offset(-r, "Round", 2, 16)).offset(r, "Round", 2, 16));
      }
      // A grin with the tongue sticking out at one corner.
      case "tongue": {
        const grin = t(t(circle(R).intersect(lowerHalf(R))).scale([1, 0.8]));
        return union([grin, at(t(circle(R * 0.36).scale([0.85, 1.15])), R * 0.3, -R * 0.62)]);
      }
      case "wavy": {
        const n = 16, th = Math.max(2.4, 0.13 * R), pts = [];
        for (let i = 0; i <= n; i++) pts.push([-R + (2 * R * i) / n, R * 0.16 * Math.sin((i / n) * Math.PI * 4)]);
        return union(pts.slice(1).map((pt, i) => bar(pts[i], pt, th)));
      }
      case "cat": {
        const small = arc(w / 2, false);
        return union([at(small, -w / 4, 0), at(small, w / 4, 0)]);
      }
      case "zigzag": {
        const n = 6, th = Math.max(2.4, 0.13 * R), bars = [];
        for (let i = 0; i < n; i++) bars.push(bar([-R + (2 * R * i) / n, i % 2 ? -R * 0.18 : R * 0.18], [-R + (2 * R * (i + 1)) / n, i % 2 ? R * 0.18 : -R * 0.18], th));
        return union(bars);
      }
      case "jagged": {
        const teeth = 5, pts = [];
        for (let i = 0; i <= 24; i++) { const a = Math.PI + (Math.PI * i) / 24; pts.push([R * Math.cos(a), R * 0.55 * Math.sin(a)]); }
        for (let k = 0; k <= 2 * teeth; k++) pts.push([R - (2 * R * k) / (2 * teeth), k % 2 ? R * 0.17 - R * 0.3 : R * 0.17]);
        return poly(pts);
      }
      default: return null;
    }
  };

  const main = [];
  const eyeS = spec.eyeSize * W;
  for (const side of [-1, 1]) {
    main.push(at(eyeShape(side > 0 && spec.eyeR ? spec.eyeR : spec.eye, eyeS, side), side * spec.eyeX * W, spec.eyeY * W));
  }
  if (spec.eye === "shades") main.push(bar([-spec.eyeX * W, (spec.eyeY + 0.03) * W], [spec.eyeX * W, (spec.eyeY + 0.03) * W], Math.max(2.4, 0.1 * eyeS)));
  const nose = noseShape(spec.nose, spec.noseSize * W);
  if (nose) main.push(at(nose, 0, spec.noseY * W));
  const mouth = mouthShape(spec.mouth, spec.mouthW * W);
  if (mouth) main.push(at(mouth, 0, spec.mouthY * W));
  const mainCs = main.length ? union(main) : null;
  let accent = null;
  if (spec.cheeks) {
    const cheek = t(circle(W * 0.07).scale([1.3, 0.85]));
    accent = union([at(cheek, -(spec.eyeX + 0.16) * W, (spec.eyeY - 0.13) * W), at(cheek, (spec.eyeX + 0.16) * W, (spec.eyeY - 0.13) * W)]);
    if (mainCs) accent = sub(accent, mainCs);
  }
  return { main: mainCs, accent };
}
