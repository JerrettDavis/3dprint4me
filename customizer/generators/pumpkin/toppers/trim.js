// Printable color regions: partition one connected hat, with exact shared boundaries.
// No painted-on material or overlapping color solids enters the export.
import { tools } from './shapes.js';
export function trimMask(wasm, style) {
  const temps = [], t = o => { temps.push(o); return o; };
  const slab = (z,h) => t(t(wasm.Manifold.cube([70,70,h])).translate([-35,-35,z]));
  const sphere = (r,at) => t(t(wasm.Manifold.sphere(r,40)).translate(at));
  try {
    if (style === 'santa') {
      const ring = t(slab(27,6).subtract(t(wasm.Manifold.cylinder(40,8,8,64))));
      return wasm.Manifold.union([ring,sphere(4.1,[12,0,40.2])]);
    }
    if (style === 'baseball') return wasm.Manifold.union([slab(27.5,3.15),sphere(1.6,[0,0,42])]);
    const { front, star, line } = tools(wasm,t);
    const frame = t(t(wasm.CrossSection.square([7,5],true)).subtract(t(wasm.CrossSection.square([4.5,2.6],true))));
    const buckle = front(frame,1.5,-9.5,32.8);
    const tongue = line([[0,-10.6,30.5],[0,-11,35]],.48);
    const badge = front(star(2.6,1.25),1.1,-7.1,42);
    return wasm.Manifold.union([buckle,tongue,badge]);
  } finally { temps.forEach(o=>o.delete()); }
}
