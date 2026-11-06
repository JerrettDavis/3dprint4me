import { loft, tools } from './shapes.js';

export default function santa(wasm, t) {
  const { union, ball, line } = tools(wasm, t);
  const fabric = loft(wasm, [[0,27,13.7],[0,32,13],[0,35,11.8],[1,39,9.5,12],[3,42,7,28],[5.7,44,4.8,48],[8.5,44,2.9,85],[11,42.8,1.6,125],[12,41,0.5,150]], t, { ripple: .025, waves: 10 });
  const cuff = loft(wasm, [[0,27,13.8],[0,29.5,15],[0,32,14.5],[0,33,13]], t);
  const puffs = Array.from({ length: 26 }, (_, i) => {
    const a = i / 26 * Math.PI * 2;
    return ball(1.5, [14 * Math.cos(a), 14 * Math.sin(a), 30.6], 20);
  });
  const pom = ball(3.5, [12,0,40.2], 40);
  // Joined tufts instead of disconnected decorative beads.
  const tufts = Array.from({ length: 18 }, (_, i) => {
    const a = i * Math.PI * (3 - Math.sqrt(5)), z = 1 - 2 * (i + .5) / 18;
    const r = Math.sqrt(1 - z*z) * 3.25;
    return ball(.65, [12 + r * Math.cos(a), r * Math.sin(a), 40.2 + z * 3.25], 12);
  });
  const fold = line([[-7.3,-8.7,34],[-5.5,-7.5,37],[-2.8,-5.4,40],[.5,-4.2,43]], .45);
  return union([fabric,cuff,...puffs,pom,...tufts,fold]);
}
