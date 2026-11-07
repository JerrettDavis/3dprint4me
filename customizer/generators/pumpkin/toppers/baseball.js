import { loft, tools } from './shapes.js';

export default function baseball(wasm, t, { crownDiameter = 36 } = {}) {
  const { union, ball, line, front, star } = tools(wasm, t);
  const { CrossSection } = wasm;
  const legacy = crownDiameter === 30, r = crownDiameter/2;
  const billHalfWidth = legacy ? 16 : Math.min(16,Math.sqrt((r-.7)**2-25)-.4);
  const profile = legacy ? [[14.65,30],[14.25,33],[12.65,36],[9.8,39],[5.6,41],[.3,41.9]] : [[r,30],[r,33],[r-.6,36],[r-2.7,39],[r-6,42],[r-11.5,44],[.3,44.8]];
  const crown = loft(wasm, legacy ? [[0,26.5,14.7],[0,30,14.7],[0,33,14.2],[0,36,12.6],[0,39,9.7],[0,41,5.5],[0,41.8,.2]] : [[0,26.5,r],...profile.map(([rad,z])=>[0,z,rad-.05])], t);
  const band = loft(wasm, [[0,27.5,legacy?14.8:r-.5],[0,29.3,legacy?15:r],[0,30,legacy?14.7:r]], t);
  // Wide curved visor, with a rounded lip and two embossed stitch rows.
  const outline = [];
  for (let i=0; i<=48; i++) {
    const a = Math.PI + i / 48 * Math.PI;
    outline.push([Math.cos(a)*billHalfWidth, (legacy ? -7 : -5) + Math.sin(a)*18]);
  }
  const visor = t(t(t(new CrossSection([outline])).extrude(2)).translate([0,0,26.5]));
  const seams = [];
  for (let i=0; i<6; i++) {
    const a = i / 6 * Math.PI * 2;
    const points = profile
      .map(([r,z])=>[r*Math.cos(a),r*Math.sin(a),z]);
    seams.push(line(points,.3));
    // Actual annular vent eyelets, tangent to the sloping panel.
    const th = a + Math.PI / 6, ventR=legacy?12.8:r-.7, pos = [ventR*Math.cos(th),ventR*Math.sin(th),35.5];
    const ring = t(t(CrossSection.circle(legacy?.95:.7,24)).subtract(t(CrossSection.circle(legacy?.42:.32,24))));
    const eyelet = t(t(ring.extrude(legacy?.65:.25)).rotate(legacy?[38,-th*180/Math.PI+90,0]:[0,75,th*180/Math.PI]));
    seams.push(t(eyelet.translate(pos)));
  }
  const stitches=[];
  for (const inset of [1.8,3.6]) for(let i=0;i<26;i++) {
    const a = Math.PI + .12 + i/25*(Math.PI-.24);
    const r=billHalfWidth-inset, ry=18-inset;
    stitches.push(line([[r*Math.cos(a-.016),(legacy?-7:-5)+ry*Math.sin(a-.016),legacy?28.53:28.58],[r*Math.cos(a+.016),(legacy?-7:-5)+ry*Math.sin(a+.016),legacy?28.53:28.58]],legacy?.32:.28));
  }
  const badge=front(star(2.4,1.2),1.3,legacy?-13.1:-r+.65,34.6);
  return union([crown,band,visor,ball(1.4,[0,0,legacy?42:44.8],28),...seams,...stitches,badge]);
}
