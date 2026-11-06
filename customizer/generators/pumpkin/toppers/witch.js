import { loft, tools } from './shapes.js';

export default function witch(wasm, t) {
  const { union, front, star, line } = tools(wasm, t);
  const { CrossSection } = wasm;
  const brim = loft(wasm, [[0,25.5,18],[0,26,20],[0,27.2,20.5],[0,28.5,16],[0,30.5,10]], t, { ripple: 0.025, waves: 3 });
  const cone = loft(wasm, [[0,28,10.8],[0,34,10],[0,40,8.3],[0.8,47,6.2],[2.5,53,4.2],[5,57,2.8,25],[8,59,1.6,60],[11,59,0.3,100]], t, { ripple: 0.025, waves: 7 });
  const band = loft(wasm, [[0,30,11.2],[0,34.2,10.6],[0,35,10.2]], t);
  const outer = t(CrossSection.square([7,5], true));
  const inner = t(CrossSection.square([4.5,2.6], true));
  const buckle = front(t(outer.subtract(inner)), 1.5, -9.5, 32.8);
  const tongue = line([[0,-10.6,30.5],[0,-11,35]], .48);
  const accent = front(star(2.6, 1.25), 1.1, -7.1, 42);
  // A raised seam curls up one side; the deep embossed star and buckle remain legible in PLA.
  const seam = line([[-5.2,-6.7,39],[-3.6,-5.7,45],[-1.4,-4.3,50],[1,-2.7,54],[5,-1.5,58]], .38);
  return union([brim, cone, band, buckle, tongue, accent, seam]);
}
