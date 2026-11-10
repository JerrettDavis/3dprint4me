// Independent rigid transforms, transcribed from the MIT source's bearing axes.
// This file must not import the builder or its topology; otherwise a shared axis
// placement mistake could make both construction and motion checks agree.
import {Matrix4,Vector3} from 'three';

export const FOLD_TO_CUBE=[90,90,0,0,90,90,0,0,-90,-90,0,0,-90,-90,0,0];
export const foldAngles=(a,b)=>[a,b,0,0,a,b,0,0,-b,-a,0,0,-b,-a,0,0];
// Continue through two different cube configurations. This is a forward
// continuation, not the first flat-to-cube path played in reverse.
export function extendedFoldAngles(phase,complete=false) {
  const q=[0,0,0,0,0,0];
  const moves=[[[0],90],[[1],90],[[4],90],[[5],90],[[2],90],[[3],90],[[0,1],0]];
  if(complete)moves.push([[0,1],90],[[2],0],[[3],0],[[4],0],[[5],0],[[0],0],[[1],0]);
  for(let i=0;i<moves.length;i++) {
    const [keys,value]=moves[i],fraction=Math.max(0,Math.min(1,phase-i));
    for(const key of keys)q[key]+=(value-q[key])*fraction;
  }
  const [a,b,c,d,e,f]=q;
  return [a,b,-c,-d,a,b,e,f,-b,-a,-d,-c,-b,-a,-f,-e];
}
const bodyOrder=[1,2,3,7,6,5,4,0];
const linkOrder=[0,4,1,7,3,5,2,6];

export function referenceAxes({size_mm:s=20,aspect=1,shape='cube',connector_mm:thickness=8,block_gap_mm:gap=1}={}) {
  const x=s*(shape==='rectangular'?aspect:1),r=thickness/2;
  const a=x-r,b=x+gap+r,c=2*x+gap-r,d=2*x+2*gap+r,e=3*x+2*gap-r,f=3*x+3*gap+r;
  const z=shape==='triangle'?s*0.3:s/2,y=shape==='triangle'?s*0.7:s/2,yr=shape==='triangle'?s*1.3+gap:1.5*s+gap;
  const topLeft=shape==='triangle'?s*0.3:x/2,topRight=shape==='triangle'?s*0.7:x/2;
  return [
    [1,[a,y,r]],[1,[b,y,r]],
    [2,[c,r,z]],[2,[d,r,z]],
    [1,[e,y,r]],[1,[f,y,r]],
    [0,[3*(x+gap)+topRight,s-r,s-r]],[0,[3*(x+gap)+topRight,s+gap+r,s-r]],
    [1,[f,yr,r]],[1,[e,yr,r]],
    [2,[d,2*s+gap-r,z]],[2,[c,2*s+gap-r,z]],
    [1,[b,yr,r]],[1,[a,yr,r]],
    [0,[topLeft,s+gap+r,s-r]],[0,[topLeft,s-r,s-r]]
  ];
}

export function referencePose(angles,params={}) {
  let matrix=new Matrix4();
  const bodies=new Map([[0,matrix.clone()]]),links=new Map();
  const axes=referenceAxes(params);
  for(let i=0;i<16;i++) {
    const [axis,p]=axes[i],v=[0,0,0];v[axis]=1;
    const step=new Matrix4().makeTranslation(...p)
      .multiply(new Matrix4().makeRotationAxis(new Vector3(...v),angles[i]*Math.PI/180))
      .multiply(new Matrix4().makeTranslation(...p.map(x=>-x)));
    matrix=matrix.clone().multiply(step);
    if(i%2===0)links.set(linkOrder[i/2],matrix.clone());
    else if(i<15)bodies.set(bodyOrder[(i-1)/2],matrix.clone());
  }
  return {bodies,links,closure:matrix};
}
