// Parametric policy/topology adapted from Jan Pieper's MIT Sturdy Infinity Cube.
// Geometry implementation and its full attribution live in the worker builder.
// Two beveled corners sweep about the end bearings during a coupled fold.
// Their maximum radial reach is hypot(r, r-chamfer), not the 45-degree reach.
export const minimumCornerGap=(thickness,chamfer)=>{
  const r=thickness/2;
  return 2*(Math.hypot(r,Math.max(0,r-chamfer))-r);
};
export function cubeMechanics(p = {}) {
  const size = p.size_mm ?? 20, aspect = p.aspect ?? 1;
  const thickness = p.connector_mm ?? 8, clearance = p.clearance_mm ?? 0.4;
  const chamfer = p.chamfer_mm ?? 2, gap = p.block_gap_mm ?? 1;
  const shape=p.shape??'cube', texture=p.texture??'smooth';
  const textureDepth=p.texture_depth_mm??0.4,texturePitch=p.texture_pitch_mm??3;
  for (const [key,value,min,max] of [
    ['size_mm',size,18,40],['aspect',aspect,1,1.5],['connector_mm',thickness,4,10],
    ['clearance_mm',clearance,0.2,0.5],['chamfer_mm',chamfer,0,3],['block_gap_mm',gap,0.6,4.5],
    ['texture_depth_mm',textureDepth,0.2,0.8],['texture_pitch_mm',texturePitch,2.4,6]
  ]) if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max) throw new RangeError(`${key} must be between ${min} and ${max}.`);
  const radius = thickness/2, width = size*(shape==='triangle'?0.4:0.5), pinRadius = radius/2, pinDepth = radius*0.975;
  if(width-2*(pinDepth+clearance)<1.2-1e-8) throw new RangeError('Reduce connector thickness or increase block size to leave 1.2 mm between the tapered pin sockets.');
  if(chamfer>radius/2+1e-8) throw new RangeError('Edge chamfer must not exceed one quarter of connector thickness.');
  if(!['cube','rectangular','spherical','triangle'].includes(shape)) throw new RangeError('Choose a cube, rectangular, spherical or triangle mechanism.');
  if(shape==='spherical'&&thickness<size/4-1e-8)throw new RangeError('Round block bearing lands need a connector at least one quarter of the block size.');
  const cornerGap=minimumCornerGap(thickness,shape==='spherical'?thickness/4:chamfer);
  if(gap<cornerGap-1e-8)throw new RangeError('Increase the block gap or edge chamfer so square corners can pass during folding.');
  const marked=p.model_kind!=='fit'&&((p.artwork??'none')!=='none'||Array.from({length:8},(_,i)=>String(p[`block_${i+1}_symbol`]??'').trim()).some(Boolean));
  const markHeight=p.mark_height_mm??0.4;
  if(marked&&(typeof markHeight!=='number'||!Number.isFinite(markHeight)||markHeight<0.4||markHeight>1))throw new RangeError('Writing / artwork relief must be between 0.4 and 1 mm.');
  if(marked&&gap<2*markHeight+0.2-1e-8)throw new RangeError('Increase the block gap or lower the writing / artwork relief to leave 0.2 mm between two decorated faces.');
  if(!['smooth','lines','ridged','knurled','hexagons'].includes(texture)) throw new RangeError('Choose an available surface texture.');
  const sx=size*(shape==='rectangular'?aspect:1), sy=size, sz=size;
  return Object.freeze({size,sx,sy,sz,aspect,shape,texture,textureDepth,texturePitch,thickness,radius,width,pinRadius,pinDepth,clearance,chamfer,gap,pivotSpacing:2*radius+gap});
}

export function cubeTopology(g) {
  const {sx,sy,sz,gap,radius:r}=g;
  const blocks=Array.from({length:8},(_,i)=>({id:i,origin:[(i%4)*(sx+gap),Math.floor(i/4)*(sy+gap),0],size:[sx,sy,sz]}));
  const joints=[];
  for(const row of [0,1]) for(const col of [0,2]) {
    const cy=g.shape==='triangle'?(row?0.3:0.7)*sy:sy/2;
    joints.push({id:joints.length,blocks:[row*4+col,row*4+col+1],origin:[(col+1)*sx+col*gap-r,row*(sy+gap)+cy-g.width/2,0],rotation:[0,0,0],kind:'bottom'});
  }
  const sideCenter=sz*(g.shape==='triangle'?0.3:0.5);
  joints.push({id:joints.length,blocks:[1,2],origin:[2*sx+gap-r,0,sideCenter+g.width/2],rotation:[-90,0,0],kind:'side'});
  joints.push({id:joints.length,blocks:[5,6],origin:[2*sx+gap-r,2*sy+gap,sideCenter-g.width/2],rotation:[90,0,0],kind:'side'});
  for(const col of [0,3]) {
    const cx=sx*(g.shape==='triangle'?(col?0.7:0.3):0.5);
    joints.push({id:joints.length,blocks:[col,col+4],origin:[col*(sx+gap)+cx-g.width/2,sy-r,sz],rotation:[180,0,90],kind:'top'});
  }
  return {blocks,joints};
}
