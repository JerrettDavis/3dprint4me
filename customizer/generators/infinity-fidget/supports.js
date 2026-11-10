// Parametric versions of the sacrificial strips/posts in Jan Pieper's MIT model.
// They are part of the printed geometry, not a request for automatic slicer support.
export function topSupportPosts(wasm,g,j,t) {
  const r=g.radius;
  // Touch the flat bridge underside: a vertical gap creates a wholly floating
  // first island. A one-extrusion-wide contact is intentionally broken afterward.
  const top=g.sz-2*r;
  const centerX=j.origin[0]+g.width/2;
  const a=g.sy-1,b=g.sy+g.gap+1;
  return [a,b].map(y=>t(t(wasm.Manifold.cube([r/2,0.8,2])).translate([centerX-r/4,y-0.4,top-2])));
}

export function sideSupportStrip(wasm,g,j,t) {
  const x=j.origin[0]-g.radius-1;
  const y=j.origin[1]===0?g.radius:2*g.sy+g.gap-g.radius;
  const z=g.sz*(g.shape==='triangle'?0.3:0.5)-g.width/2+g.clearance;
  return t(t(wasm.Manifold.cube([g.pivotSpacing+2*g.radius+2,0.8,0.2])).translate([x,y-0.4,z]));
}

export function sideBearingTipSupports(wasm,g,j,t) {
  const y=j.origin[1]===0?g.radius:2*g.sy+g.gap-g.radius;
  const tip=g.sz*(g.shape==='triangle'?0.3:0.5)+g.width/2-g.pinDepth;
  // Upper side pins point downward. Their first 1 mm-radius disk would otherwise
  // begin in air inside the tapered cavity. A coaxial 0.8 mm sacrificial stalk
  // touches that disk and roots in the link web below the cavity floor.
  return [0,g.pivotSpacing].map(dx=>t(t(wasm.Manifold.cylinder(g.clearance+0.2,0.4,0.4,24))
    .translate([j.origin[0]+dx,y,tip-g.clearance-0.2])));
}
