import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

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
    group.add(new THREE.Mesh(geo, mat(p.color, { roughness: .5, flatShading: true })));
  }
  return group;
}

export function createViewer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', '3D model preview');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 1, 4000);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI;

  scene.add(new THREE.HemisphereLight(0xdfeeff, 0x1b2a38, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(-150, -250, 400);
  scene.add(sun);

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
  let running = false;

  // Orbiting under the model is only blocked when the opaque bed is shown.
  function limitOrbit() { controls.maxPolarAngle = bedMode ? Math.PI / 2 - .02 : Math.PI; }

  function frame(side = 'front') {
    // Distance at which a bounding sphere of `radius` fits the narrower viewport axis.
    const fit = radius => radius * 1.15 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(1, camera.aspect));
    // Front face is +Z (up); the back face is the underside resting on the bed.
    const dir = new THREE.Vector3(.25, side === 'back' ? .75 : -.75, side === 'back' ? -.62 : .62).normalize();
    if (bedMode) {
      controls.target.set(0, -5, 0);
      camera.position.copy(controls.target).addScaledVector(dir, fit(BED * .62));
    } else {
      const span = Math.max(dims.w, dims.d, dims.h, 40);
      controls.target.set(0, 0, dims.h / 3);
      camera.position.copy(controls.target).addScaledVector(dir, fit(span * .7));
    }
    controls.update();
  }

  function layout() {
    limitOrbit();
    bed.visible = refs.visible = bedMode;
    stage.visible = !bedMode;
    if (!model) return;
    if (bedMode) model.position.set(-45, 0, 0);
    else model.position.set(0, 0, 0);
  }

  function resize() {
    const { clientWidth: w, clientHeight: h } = container;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);

  function loop() {
    if (!running) return;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }

  return {
    setParts(parts) {
      const first = !model;
      if (model) {
        scene.remove(model);
        model.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
      }
      model = makeBadgeMesh(parts);
      // Centre XY on the origin, rest on Z=0.
      const box = new THREE.Box3().setFromObject(model);
      const c = box.getCenter(new THREE.Vector3());
      model.children.forEach(m => m.position.set(-c.x, -c.y, -box.min.z));
      scene.add(model);
      const size = box.getSize(new THREE.Vector3());
      dims = { w: size.x, d: size.y, h: size.z };
      layout();
      if (first) { resize(); frame(); }
      return dims;
    },
    setBedMode(on) {
      bedMode = on;
      layout();
      resize();
      frame();
    },
    show() { resize(); if (!running) { running = true; loop(); } },
    hide() { running = false; },
    showSide(side) { if (bedMode) return false; frame(side); return true; },
    get dims() { return dims; },
    BED
  };
}
