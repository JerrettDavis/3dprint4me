import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// A procedural studio: no downloaded HDRIs, textures or customer data.
export function createStudio(renderer) {
  const room = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(room, .04);
  room.dispose();
  pmrem.dispose();
  const grain = document.createElement('canvas');
  grain.width = grain.height = 512;
  const ctx = grain.getContext('2d');
  ctx.fillStyle = '#d4c4aa';
  ctx.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 512; y++) {
    ctx.strokeStyle = `rgba(102,74,44,${.018 + .018 * Math.sin(y * 1.73) ** 2})`;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(180, y + Math.sin(y) * 3, 340, y - 2, 512, y);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(grain);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(12, 12);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ map: texture, roughness: .86, metalness: 0 }));
  floor.position.z = -.06;
  floor.receiveShadow = true;
  floor.visible = false;
  return { floor, environment: environment.texture, dispose() { environment.dispose(); texture.dispose(); } };
}

export function finishMaterial(material, realistic) {
  material.roughness = realistic ? .42 : .5;
  material.envMapIntensity = realistic ? .35 : 1;
  material.flatShading = !realistic && !material.userData.smoothShading;
  material.needsUpdate = true;
}
