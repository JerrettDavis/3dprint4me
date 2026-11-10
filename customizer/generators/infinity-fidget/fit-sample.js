// Two production bearing bodies and one captured conical link. The sample
// deliberately uses the exact joint dimensions selected for the full assembly.
import {cubeMechanics,cubeTopology} from '../../../public/assets/js/customize/fidget-topology.js';
import {buildConicalJoint} from './conical-hinge.js';
import {chamferedBlock} from './shapes.js';

export function buildConicalFitSample(p,ctx) {
  const g=cubeMechanics(p),joint=buildConicalJoint(ctx.wasm,g);
  const {Manifold:M}=ctx.wasm,temps=[],solids=[];
  const t=s=>{temps.push(s);return s;};
  try {
    const topology=cubeTopology(g),j=topology.joints[0];
    const cut=t(joint.cut.translate(j.origin));
// Match the production spherical bearing-foot envelope, independent of the
// decorative chamfer setting (which spherical bodies do not use).
const blank=chamferedBlock(ctx.wasm,[g.sx,g.sy,g.sz],g.shape==='spherical'?g.radius/2:g.chamfer,t);
    for(let i=0;i<2;i++) {
      const body=t(t(blank.translate(topology.blocks[i].origin)).subtract(cut));
      const pins=t(joint.pins[i].translate(j.origin));
      solids.push({name:`Fit bearing ${i+1}`,color:p[`block_${i+1}_color`]??'#315b6c',solid:M.union([body,pins])});
    }
    solids.push({name:'Fit captured link',color:p.link_color??'#d6a052',solid:joint.link.translate(j.origin)});
    return {solids,filenameBase:'infinity-fidget-fit-sample',slicerSettings:{layer_height:'0.2',initial_layer_print_height:'0.2',wall_generator:'arachne',enable_support:'0'},warnings:[
      `Nominal bearing clearance ${g.clearance} mm. Print this sample with the same material, orientation and slicer settings as the full fidget.`,
      'Gently free both pivots after cooling. A successful sample checks local fit; it does not verify the full folding mechanism.'
    ]};
  }catch(e){solids.forEach(p=>p.solid.delete());throw e;}
  finally{joint.dispose();temps.reverse().forEach(s=>s.delete());}
}
