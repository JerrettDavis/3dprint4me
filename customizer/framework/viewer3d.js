import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DUR, play, reducedMotion } from './motion.js';

// Everything lives in the printer's Z-up frame (millimetres), matching the 3MF.
const BED = 256; // Bambu Lab X1/P1/A1 Max-class 256 x 256 mm build plate

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .55, metalness: 0, ...extra });

function makeBenchy() {
  // Stylised 3DBenchy (60 x 31 x 48 mm), bow towards +X. Only meant as a size reference.
  const g = new THREE.Group();
  const plan = new THREE.Shape();
  plan.moveTo(-30, -11);
  plan.lineTo(14, -15.5);
  plan.quadraticCurveTo(30, -10, 30, 0);
  plan.quadraticCurveTo(30, 10, 14, 15.5);
  plan.lineTo(-30, 11);
  plan.closePath();
  const hull = new THREE.Mesh(new THREE.ExtrudeGeometry(plan, { depth: 19, bevelEnabled: false }), mat('#b7322c'));
  hull.scale.set(1, 1, 1);
  g.add(hull);
  const deck = new THREE.Mesh(new THREE.ExtrudeGeometry(plan, { depth: 2, bevelEnabled: false }), mat('#f2f2f2'));
  deck.position.z = 19;
  deck.scale.set(.96, .94, 1);
  g.add(deck);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(20, 20, 13), mat('#f2f2f2'));
  cabin.position.set(-9, 0, 21 + 6.5);
  g.add(cabin);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(24, 24, 2), mat('#b7322c'));
  roof.position.set(-9, 0, 34 + 1);
  g.add(roof);
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 12, 20), mat('#b7322c'));
  chimney.rotation.x = Math.PI / 2;
  chimney.position.set(-14, 0, 36 + 6);
  g.add(chimney);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(3.9, 3.9, 1.6, 20), mat('#222'));
  rim.rotation.x = Math.PI / 2;
  rim.position.set(-14, 0, 47.2);
  g.add(rim);
  return g;
}

function makeBanana() {
  // ~190 mm along the curve, ~35 mm thick at the belly. Lies on its side on the bed.
  const radius = 17.5;
  const pts = [];
  const arcR = 150, a0 = -.6, a1 = .6;
  for (let i = 0; i <= 24; i++) {
    const a = a0 + (a1 - a0) * i / 24;
    pts.push(new THREE.Vector3(arcR * Math.sin(a), arcR * (1 - Math.cos(a)) * -1, radius));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.Group();
  const segs = 48, radial = 5;
  const geo = new THREE.TubeGeometry(curve, segs, radius, radial, false);
  // Taper the ends and give the cross-section a slightly angular banana profile.
  const pos = geo.attributes.position;
  const ringLen = radial + 1;
  for (let i = 0; i < pos.count; i++) {
    const ring = Math.floor(i / ringLen);
    const t = ring / segs;
    const taper = Math.min(1, Math.sin(Math.PI * t) * 2.2 + .28);
    const c = curve.getPointAt(t);
    pos.setXYZ(i, c.x + (pos.getX(i) - c.x) * taper, c.y + (pos.getY(i) - c.y) * taper, c.z + (pos.getZ(i) - c.z) * taper);
  }
  geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, mat('#f4d03f', { flatShading: true })));
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 4.5, 14, 6), mat('#6b5a2a'));
  const end = curve.getPointAt(0), dir = curve.getTangentAt(0);
  stem.position.copy(end).addScaledVector(dir, -9);
  stem.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().negate());
  g.add(stem);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(3.2, 8, 6), mat('#3b2f1a'));
  tip.position.copy(curve.getPointAt(1));
  g.add(tip);
  return g;
}

function makeLabelSprite(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = '700 22px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#9fb8c9';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 32);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false, transparent: true }));
  s.scale.set(48, 12, 1);
  return s;
}

function makeBed() {
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.BoxGeometry(BED, BED, 3), mat('#1a2733', { roughness: .8 }));
  plate.position.z = -1.5;
  g.add(plate);
  const grid = new THREE.GridHelper(BED, BED / 10, 0x4b6a82, 0x2b4357);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = .05;
  g.add(grid);
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(BED, BED, 3)), new THREE.LineBasicMaterial({ color: 0x38a6d8 }));
  edge.position.z = -1.5;
  g.add(edge);
  const label = makeLabelSprite('Bambu bed · 256 mm');
  label.position.set(0, -BED / 2 - 10, 0);
  g.add(label);
  return g;
}

// Each solid becomes its own mesh, tagged with the solid's name (userData.name) so the preview can
// be hovered and clicked part by part. Polygon offset keeps the highlight outline in front of
// coplanar faces.
function makeBadgeMesh(parts) {
  const group = new THREE.Group();
  for (const p of parts) {
    const { vertices, triangles } = p.mesh;
    const positions = new Float32Array(triangles.length * 9);
    triangles.forEach((tri, i) => tri.forEach((vi, k) => {
      const v = vertices[vi];
      positions.set(v, i * 9 + k * 3);
    }));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat(p.color, { roughness: .5, flatShading: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
    mesh.userData.name = p.name;
    group.add(mesh);
  }
  return group;
}

const ACCENT = 0x38a6d8;
const EDGE = 0x8fe3ff;
const LEVEL = { hover: .3, selected: .5 };
const ease = t => 1 - Math.pow(1 - t, 3);

function setOpacity(object, value) {
  object.traverse(o => {
    if (!o.material || o.isLineSegments) return;
    o.material.transparent = value < 1;
    o.material.opacity = value;
    o.material.depthWrite = value >= 1;
  });
}

// One renderer serves every preview tab: "3d" orbits a perspective camera; "front" and
// "back" look straight down/up the Z axis through an orthographic camera (a flat 2D view of
// each face). Frames render on demand, and the short transitions (a model swap, a camera move,
// a pulse) run their own frame loop only while they last; under prefers-reduced-motion they
// are skipped and every change is instant.
//
// Picking: each part can map to a section (setPartResolver). Hovering reports
// onHover(sectionKey|null, partName|null, { x, y }); a tap or click (little movement, short,
// one pointer) reports onPick(sectionKey|null, partName|null, { x, y }, pointerType); dragging
// to orbit or pan never picks. The viewer draws what the page asks for with setHighlight.
export function createViewer(container, { label = '3D model preview' } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', label);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 1, 4000);
  camera.up.set(0, 0, 1);
  const ortho = new THREE.OrthographicCamera(-50, 50, 50, -50, -2000, 2000);
  ortho.up.set(0, 1, 0);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.maxPolarAngle = Math.PI;

  scene.add(new THREE.HemisphereLight(0xdfeeff, 0x1b2a38, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(-150, -250, 400);
  scene.add(sun);
  const under = new THREE.DirectionalLight(0xffffff, 1.2);
  under.position.set(120, 200, -400);
  scene.add(under);

  const bed = makeBed();
  const benchy = makeBenchy();
  const banana = makeBanana();
  // Slicers place objects relative to the plate; keep the reference objects clear of a typical badge.
  benchy.position.set(85, -88, 0);
  benchy.rotation.z = .35;
  banana.position.set(88, 36, 0);
  banana.rotation.z = Math.PI / 2 + .12;
  const refs = new THREE.Group();
  refs.add(benchy, banana);
  const stage = new THREE.Group();
  const floor = new THREE.GridHelper(300, 30, 0x3a566b, 0x24394a);
  floor.rotation.x = Math.PI / 2;
  stage.add(floor);
  scene.add(bed, refs, stage);

  let model = null;
  let dims = { w: 0, d: 0, h: 0 };
  let bedMode = false;
  let view = '3d';
  let queued = false;
  let inset = { left: 0, right: 0, top: 0, bottom: 0 };
  let resolver = () => null;
  let hoverCb = () => {};
  let pickCb = () => {};
  let hl = { hover: null, selected: null };
  let swap = null;
  let camTween = null;
  let pulseRun = null;

  function render() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      renderNow();
    });
  }
  function renderNow() { renderer.render(scene, view === '3d' ? camera : ortho); }
  controls.addEventListener('change', render);
  controls.addEventListener('start', () => camTween?.cancel());

  // A short frame loop for one transition. Resolves when done (at once under reduced motion).
  function run(ms, step) {
    if (reducedMotion() || ms <= 0) {
      step(1);
      renderNow();
      return { cancel() {}, done: Promise.resolve() };
    }
    let raf = 0;
    let cancelled = false;
    const start = performance.now();
    const done = new Promise(resolve => {
      const tick = now => {
        if (cancelled) { resolve(); return; }
        const t = Math.min(1, (now - start) / ms);
        step(ease(t));
        renderNow();
        if (t < 1) raf = requestAnimationFrame(tick); else resolve();
      };
      raf = requestAnimationFrame(tick);
    });
    return { cancel() { cancelled = true; cancelAnimationFrame(raf); }, done };
  }

  const size = () => ({ w: container.clientWidth || 1, h: container.clientHeight || 1 });
  const free = () => {
    const { w, h } = size();
    return { w, h, freeW: Math.max(120, w - inset.left - inset.right), freeH: Math.max(120, h - inset.top - inset.bottom) };
  };

  // Orbiting under the model is only blocked when the opaque bed is shown.
  function limitOrbit() { controls.maxPolarAngle = bedMode ? Math.PI / 2 - .02 : Math.PI; }

  // Floating tool windows cover part of the canvas: shift the projection so the model is
  // centred in the free space, without moving the camera.
  function applyViewOffset() {
    const { w, h } = size();
    const sx = (inset.left - inset.right) / 2;
    const sy = (inset.top - inset.bottom) / 2;
    if (sx || sy) camera.setViewOffset(w, h, -sx, -sy, w, h);
    else camera.clearViewOffset();
  }

  function frameTarget(side = 'front') {
    // Distance at which a bounding sphere of `radius` fits the free part of the canvas.
    const fit = radius => {
      const { h, freeW, freeH } = free();
      return radius * 1.15 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (Math.min(freeW, freeH) / h));
    };
    // Front face is +Z (up); the back face is the underside resting on the bed.
    const dir = new THREE.Vector3(.25, side === 'back' ? .75 : -.75, side === 'back' ? -.62 : .62).normalize();
    const target = new THREE.Vector3();
    const position = new THREE.Vector3();
    if (bedMode) {
      target.set(0, -5, 0);
      position.copy(target).addScaledVector(dir, fit(BED * .62));
    } else {
      const span = Math.max(dims.w, dims.d, dims.h, 40);
      target.set(0, 0, dims.h / 3);
      position.copy(target).addScaledVector(dir, fit(span * .7));
    }
    return { position, target };
  }

  function moveCamera({ position, target }, animate) {
    camTween?.cancel();
    camTween = null;
    if (!animate || reducedMotion() || view !== '3d') {
      camera.position.copy(position);
      controls.target.copy(target);
      controls.update();
      render();
      return;
    }
    const p0 = camera.position.clone();
    const t0 = controls.target.clone();
    camTween = run(DUR.slow + 60, t => {
      camera.position.lerpVectors(p0, position, t);
      controls.target.lerpVectors(t0, target, t);
      controls.update();
    });
  }
  const frame = (side = 'front', animate = false) => moveCamera(frameTarget(side), animate);

  function frameOrtho() {
    const { w, h, freeW, freeH } = free();
    // Units per pixel such that the model fits the free space; the frustum covers the whole
    // canvas and is shifted so the model sits in the middle of the free space.
    const half = Math.max(dims.w, dims.d, 20) * .58;
    const upp = (2 * half) / Math.min(freeW, freeH);
    const sx = (inset.left - inset.right) / 2;
    const sy = (inset.top - inset.bottom) / 2;
    Object.assign(ortho, {
      left: -w * upp / 2 - sx * upp,
      right: w * upp / 2 - sx * upp,
      top: h * upp / 2 + sy * upp,
      bottom: -h * upp / 2 + sy * upp
    });
    // Back: look up from below; the image is mirrored exactly as the turned-over part reads.
    ortho.position.set(0, 0, view === 'back' ? -1000 : 1000);
    ortho.up.set(0, 1, 0);
    ortho.lookAt(0, 0, 0);
    ortho.updateProjectionMatrix();
  }

  function layout() {
    limitOrbit();
    const flat = view !== '3d';
    bed.visible = refs.visible = bedMode && !flat;
    stage.visible = !bedMode && !flat;
    controls.enabled = !flat;
    if (!model) return;
    if (bedMode && !flat) model.position.set(-45, 0, 0);
    else model.position.set(0, 0, 0);
  }

  function resize() {
    const { clientWidth: w, clientHeight: h } = container;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    applyViewOffset();
    frameOrtho();
    render();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);

  // ---- Highlighting: emissive tint plus an edge outline, per mesh ----
  function edgesOf(mesh) {
    if (!mesh.userData.edges) {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 28), new THREE.LineBasicMaterial({ color: EDGE, transparent: true, opacity: 1, depthWrite: false }));
      edges.renderOrder = 2;
      edges.visible = false;
      mesh.add(edges);
      mesh.userData.edges = edges;
    }
    return mesh.userData.edges;
  }
  function paintHighlights() {
    if (!model) return;
    for (const mesh of model.children) {
      if (!mesh.isMesh) continue;
      const key = mesh.userData.section;
      const level = key && key === hl.selected ? 'selected' : key && key === hl.hover ? 'hover' : null;
      mesh.material.emissive.setHex(level ? ACCENT : 0x000000);
      mesh.material.emissiveIntensity = level ? LEVEL[level] : 0;
      if (level || mesh.userData.edges) {
        const edges = edgesOf(mesh);
        edges.visible = Boolean(level);
        edges.material.opacity = level === 'selected' ? 1 : .6;
      }
    }
    render();
  }
  function tagParts() {
    if (!model) return;
    for (const mesh of model.children) if (mesh.isMesh) mesh.userData.section = resolver(mesh.userData.name) ?? null;
  }

  // ---- Picking ----
  const dom = renderer.domElement;
  const ndc = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  function partAt(clientX, clientY) {
    if (!model) return null;
    const rect = dom.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, view === '3d' ? camera : ortho);
    model.updateMatrixWorld(true);
    return raycaster.intersectObjects(model.children.filter(c => c.isMesh), false)[0]?.object ?? null;
  }
  const pointOf = e => { const r = dom.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  let hoverEvent = null;
  let hoverFrame = 0;
  let hoverKey = null;
  function reportHover() {
    hoverFrame = 0;
    const e = hoverEvent;
    if (!e) return;
    const mesh = partAt(e.clientX, e.clientY);
    const key = mesh?.userData.section ?? null;
    dom.style.cursor = key ? 'pointer' : '';
    hoverKey = key;
    hoverCb(key, mesh?.userData.name ?? null, pointOf(e));
  }
  function clearHover() {
    hoverEvent = null;
    if (hoverKey !== null || dom.style.cursor) { hoverKey = null; dom.style.cursor = ''; hoverCb(null, null, null); }
  }
  const pointers = new Set();
  let press = null;
  dom.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.add(e.pointerId);
    if (pointers.size > 1) { if (press) press.multi = true; return; }
    press = { x: e.clientX, y: e.clientY, at: performance.now(), moved: false, multi: false };
  });
  dom.addEventListener('pointermove', e => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6) press.moved = true;
    // Hover only for a mouse or pen with no button down (a touch drag is an orbit).
    if (e.pointerType === 'touch' || e.buttons) return;
    hoverEvent = e;
    if (!hoverFrame) hoverFrame = requestAnimationFrame(reportHover);
  });
  dom.addEventListener('pointerup', e => {
    pointers.delete(e.pointerId);
    const p = press;
    if (pointers.size === 0) press = null;
    if (!p || p.moved || p.multi || performance.now() - p.at > 600) return;
    const mesh = partAt(e.clientX, e.clientY);
    pickCb(mesh?.userData.section ?? null, mesh?.userData.name ?? null, pointOf(e), e.pointerType);
  });
  dom.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); press = null; });
  dom.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch') clearHover(); });

  // ---- Model swap: the old model fades out while the new one fades and scales in ----
  function disposeObject(object) {
    object.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  }
  function finishSwap() {
    if (!swap) return;
    swap.run.cancel();
    const { old, next } = swap;
    swap = null;
    scene.remove(old);
    disposeObject(old);
    if (next) { setOpacity(next, 1); next.scale.setScalar(1); }
  }

  function setView(next, { animate = true } = {}) {
    const prev = view;
    view = next === 'front' || next === 'back' ? next : '3d';
    layout();
    frameOrtho();
    render();
    if (!animate || prev === view || reducedMotion()) return;
    // The two flat views flip, anything else eases in.
    const flip = prev !== '3d' && view !== '3d';
    play(dom, flip
      ? [{ opacity: 0, transform: `perspective(900px) rotateY(${view === 'back' ? '-' : ''}70deg) scale(.96)` }, { opacity: 1, transform: 'none' }]
      : [{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 280 });
  }

  return {
    setParts(parts) {
      const first = !model;
      finishSwap();
      const old = model;
      model = makeBadgeMesh(parts);
      // Centre XY on the origin, rest on Z=0.
      const box = new THREE.Box3().setFromObject(model);
      const c = box.getCenter(new THREE.Vector3());
      model.children.forEach(m => m.position.set(-c.x, -c.y, -box.min.z));
      scene.add(model);
      const size3 = box.getSize(new THREE.Vector3());
      dims = { w: size3.x, d: size3.y, h: size3.z };
      tagParts();
      layout();
      if (first) { resize(); frame(); }
      frameOrtho();
      paintHighlights();
      if (old) {
        if (first || reducedMotion()) { scene.remove(old); disposeObject(old); } else {
          setOpacity(old, 1);
          setOpacity(model, 0);
          const next = model;
          swap = { old, next, run: run(DUR.base + 40, t => {
            setOpacity(old, 1 - t);
            setOpacity(next, t);
            next.scale.setScalar(.94 + .06 * t);
          }) };
          const mine = swap;
          mine.run.done.then(() => { if (swap === mine) finishSwap(); });
        }
      }
      render();
      return dims;
    },
    setView,
    setBedMode(on) {
      finishSwap();
      bedMode = on;
      layout();
      resize();
      frame('front', true);
      render();
    },
    /** Which section (or null) a part belongs to: fn(partName) => key. */
    setPartResolver(fn) { resolver = typeof fn === 'function' ? fn : () => null; tagParts(); paintHighlights(); },
    onHover(fn) { hoverCb = typeof fn === 'function' ? fn : () => {}; },
    onPick(fn) { pickCb = typeof fn === 'function' ? fn : () => {}; },
    /** { hover, selected }: section keys to draw (tint + outline); null for none. */
    setHighlight(next) { hl = { hover: next?.hover ?? null, selected: next?.selected ?? null }; paintHighlights(); },
    /** A short glow on a section's parts (after it was selected). */
    pulse(key) {
      if (!model || !key || reducedMotion()) return;
      const meshes = model.children.filter(m => m.isMesh && m.userData.section === key);
      if (!meshes.length) return;
      pulseRun?.cancel();
      const run1 = run(650, t => { for (const m of meshes) m.material.emissiveIntensity = LEVEL.selected + (1 - t) * .8; });
      pulseRun = run1;
      run1.done.then(() => { if (pulseRun === run1) paintHighlights(); });
    },
    /** Pixels the floating panels cover on each side; the model is centred in what is left. */
    setInset(next) {
      inset = { left: next?.left ?? 0, right: next?.right ?? 0, top: next?.top ?? 0, bottom: next?.bottom ?? 0 };
      applyViewOffset();
      frameOrtho();
      render();
    },
    show() { resize(); render(); },
    hide() {},
    showSide(side) { if (bedMode) return false; frame(side, true); render(); return true; },
    resetCamera() { frame('front', true); render(); },
    dispose() {
      camTween?.cancel();
      pulseRun?.cancel();
      finishSwap();
      cancelAnimationFrame(hoverFrame);
      observer.disconnect();
      controls.dispose();
      scene.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose?.(); o.material?.dispose?.(); });
      renderer.dispose();
      renderer.domElement.remove();
    },
    get dims() { return dims; },
    BED
  };
}
