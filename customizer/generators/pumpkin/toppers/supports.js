// Removable, model-derived posts. Coordinates stay in the model's print orientation.
// Supports occupy empty vertical intervals beneath surfaces steeper than 45 degrees.
export function integratedSupports(wasm, solid) {
  const mesh = solid.getMesh(), box = solid.boundingBox(), pitch = 2.4, gap = .16;
  const columns = new Map(), temps = [], t = o => { temps.push(o); return o; };
  const point = i => Array.from(mesh.vertProperties.slice(i*mesh.numProp,i*mesh.numProp+3));
  for (let i=0; i<mesh.triVerts.length; i+=3) {
    const [a,b,c] = [0,1,2].map(j=>point(mesh.triVerts[i+j]));
    const ux=b[0]-a[0], uy=b[1]-a[1], uz=b[2]-a[2];
    const vx=c[0]-a[0], vy=c[1]-a[1], vz=c[2]-a[2];
    const nz=ux*vy-uy*vx;
    if (Math.abs(nz)<1e-9) continue;
    const nx=uy*vz-uz*vy, ny=uz*vx-ux*vz;
    const roof=nz < -Math.hypot(nx,ny);
    const xmin=Math.ceil(Math.min(a[0],b[0],c[0])/pitch), xmax=Math.floor(Math.max(a[0],b[0],c[0])/pitch);
    const ymin=Math.ceil(Math.min(a[1],b[1],c[1])/pitch), ymax=Math.floor(Math.max(a[1],b[1],c[1])/pitch);
    for(let ix=xmin;ix<=xmax;ix++) for(let iy=ymin;iy<=ymax;iy++) {
      const x=ix*pitch,y=iy*pitch, dx=x-a[0],dy=y-a[1];
      const u=(dx*vy-dy*vx)/nz, v=(ux*dy-uy*dx)/nz;
      if(u< -1e-7||v< -1e-7||u+v>1+1e-7) continue;
      const key=`${ix},${iy}`;
      if(!columns.has(key)) columns.set(key,{x,y,hits:[]});
      columns.get(key).hits.push({z:a[2]+u*uz+v*vz,roof,entry:nz<0});
    }
  }
  try {
    const posts=[];
    for(const {x,y,hits} of columns.values()) {
      hits.sort((a,b)=>a.z-b.z);
      let base=box.min[2];
      const unique=hits.filter((h,i)=>!i||Math.abs(h.z-hits[i-1].z)>1e-5);
      for(const hit of unique) {
        if(hit.entry && hit.roof && hit.z-base>1) {
          const top=hit.z-gap, neck=Math.min(.8,(top-base)/2), stem=top-base-neck;
          posts.push(t(t(wasm.Manifold.cylinder(stem,.65,.65,12)).translate([x,y,base])));
          posts.push(t(t(wasm.Manifold.cylinder(neck,.65,.225,12)).translate([x,y,base+stem])));
        }
        if(!hit.entry) base=hit.z+gap;
      }
    }
    if(!posts.length) return null;
    const raw=t(wasm.Manifold.union(posts));
    // Trim sloped contacts to the actual surface, with a vertical release gap.
    const exclusion=t(solid.add(t(solid.translate([0,0,-gap]))));
    return raw.subtract(exclusion);
  } finally { temps.forEach(o=>o.delete()); }
}
