// Adapted from Jan Pieper's Sturdy Infinity Cube (MIT), revision e62b577.
// See LICENSE-JAN-PIEPER.txt. Local X joins pivots; Y is the bearing axis.
// Unlike the experimental cylindrical connector, the body carries the male
// conical pins and the moving link carries the tapered female bearings.
export function buildConicalJoint(wasm,g) {
  const {Manifold:M}=wasm, temps=[], owned=[];
  const t=s=>{temps.push(s);return s;};
  const {radius:r,width:w,clearance:c,pinRadius:pr,pinDepth:pd,pivotSpacing:d}=g;
  const box=(size,at)=>t(t(M.cube(size)).translate(at));
  const cylinder=(height,lo,hi,x,y,z,front=true)=>t(t(t(M.cylinder(height,lo,hi,64)).rotate([front?-90:90,0,0])).translate([x,y,z]));
  try {
    const profile=t(M.union([box([d,w-2*c,2*r],[0,c,0]),... [0,d].map(x=>cylinder(w-2*c,r,r,x,c,r))]));
    const holes=[];
    const pins=[];
    for(const x of [0,d]) {
      const pair=[];
      for(const front of [true,false]) {
        const y=front?0:w;
        holes.push(cylinder(pd+c,pr+c,pr/2+c,x,y,r,front));
        pair.push(cylinder(pd,pr,pr/2,x,y,r,front));
      }
      const pinPair=M.union(pair); owned.push(pinPair); pins.push(pinPair);
    }
    const holeUnion=t(M.union(holes));
    const link=profile.subtract(holeUnion); owned.push(link);
    const cut=M.union([
      box([d,w,2*r+c+1],[0,0,-1]),
      box([d+2*(r+c),w,r+1],[-r-c,0,-1]),
      ...[0,d].map(x=>cylinder(w,r+c,r+c,x,0,r))
    ]); owned.push(cut);
    let freed=false;
    return {link,cut,pins,dispose(){if(freed)return;freed=true;owned.forEach(s=>s.delete());}};
  }catch(e){owned.forEach(s=>s.delete());throw e;}
  finally{temps.reverse().forEach(s=>s.delete());}
}
