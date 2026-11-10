export function chamferedBlock(wasm,size,chamfer,t) {
  const {Manifold:M}=wasm;
  let shape=t(M.cube(size,true));
  if(chamfer>0) for(const [a,b] of [[0,1],[0,2],[1,2]]) for(const sa of [-1,1]) for(const sb of [-1,1]) {
    const n=[0,0,0];n[a]=sa;n[b]=sb;
    // Manifold normalizes the normal but treats originOffset as a distance.
    // Convert the edge-coordinate setback to that unit-normal distance too.
    shape=t(shape.trimByPlane(n,(-(size[a]+size[b])/2+chamfer)/Math.SQRT2));
  }
  return t(shape.translate(size.map(v=>v/2)));
}

export function bodyShape(wasm,g,t,inset=0) {
  const size=[g.sx,g.sy,g.sz].map(v=>v-2*inset);
  const box=t(chamferedBlock(wasm,size,Math.max(0,g.chamfer-inset),t).translate([inset,inset,inset]));
  if(g.shape==='triangle') {
    const x=g.triangleX??1,y=g.triangleY??-1;
    const offset=(x>0?g.sx:0)+(y>0?g.sy:0)+g.sz-g.size;
    return t(box.trimByPlane([-x,-y,-1],-offset/Math.sqrt(3)+inset));
  }
  if(g.shape!=='spherical') return box;
  // Slightly truncate the poles for bed contact and robust bearing mount lands.
  const sphere=t(t(wasm.Manifold.sphere(g.size*0.53-inset,64)).translate([g.sx/2,g.sy/2,g.sz/2]));
  return t(sphere.intersect(box));
}

function pattern(wasm,g,width,height,t) {
  const {CrossSection:C}=wasm;
  const clip=t(C.square([width,height],true)),parts=[];
  const reach=Math.hypot(width,height)+g.texturePitch;
  const line=(x,angle,wide)=>parts.push(t(t(t(C.square([wide,2*reach],true)).translate([x,0])).rotate(angle)));
  if(g.texture==='hexagons') {
    const radius=g.texturePitch/2,inner=radius-0.5;
    const hex=r=>Array.from({length:6},(_,i)=>[r*Math.cos(i*Math.PI/3),r*Math.sin(i*Math.PI/3)]);
    const ring=t(C.ofPolygons([hex(radius),hex(inner)],'EvenOdd'));
    for(let col=-Math.ceil(width/(1.5*radius));col<=Math.ceil(width/(1.5*radius));col++) {
      for(let row=-Math.ceil(height/(Math.sqrt(3)*radius));row<=Math.ceil(height/(Math.sqrt(3)*radius));row++) {
        const x=col*radius*1.5,y=(row+(Math.abs(col)%2)*0.5)*Math.sqrt(3)*radius;
        if(Math.abs(x)<=width/2+radius&&Math.abs(y)<=height/2+radius) parts.push(t(ring.translate([x,y])));
      }
    }
  }else {
    const angles=g.texture==='knurled'?[-45,45]:[g.texture==='ridged'?90:0];
    for(const angle of angles) for(let x=-reach;x<=reach;x+=g.texturePitch) line(x,angle,g.texture==='ridged'?0.8:0.55);
  }
  const joined=t(C.union(parts));
  return t(joined.intersect(clip));
}

// Engrave five faces; retain a plain bottom for bed adhesion. The skin follows
// the selected body shape, so spherical grooves follow its actual curved surface.
export function textureTools(wasm,g,outer,t) {
  if(g.texture==='smooth') return null;
  const {Manifold:M}=wasm,margin=g.radius+g.clearance+g.pinRadius*0.5+0.6;
  // Cross the outer surface rather than ending the cutter exactly coplanar with
  // it. A coincident cutter can otherwise leave an enclosed zero-thickness cap.
  const expanded=bodyShape(wasm,g,t,-0.02);
  const inner=bodyShape(wasm,g,t,g.textureDepth),skin=t(expanded.subtract(inner));
  const masks=[];
  const widths=[g.sx-2*margin,g.sy-2*margin,g.sz-2*margin];
  if(widths.some(w=>w<2.4)) throw new RangeError('This connector leaves too little surface for the texture. Increase block size or reduce connector thickness.');
  const top=pattern(wasm,g,widths[0],widths[1],t);
  masks.push(t(t(top.extrude(g.sz/2+1)).translate([g.sx/2,g.sy/2,g.sz/2])));
  const front=pattern(wasm,g,widths[0],widths[2],t);
  masks.push(t(t(t(t(front.extrude(g.sy+2)).translate([0,0,-(g.sy+2)/2])).rotate([90,0,0])).translate([g.sx/2,g.sy/2,g.sz/2])));
  const side=pattern(wasm,g,widths[1],widths[2],t);
  masks.push(t(t(t(t(side.extrude(g.sx+2)).translate([0,0,-(g.sx+2)/2])).rotate([90,0,90])).translate([g.sx/2,g.sy/2,g.sz/2])));
  return t(t(M.union(masks)).intersect(skin));
}
