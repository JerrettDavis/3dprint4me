// Eight bodies and eight captured links. Adapted topology and tapered bearings:
// Jan Pieper, MIT; see LICENSE-JAN-PIEPER.txt. Surface treatments are applied later.
import {cubeMechanics,cubeTopology} from '../../../public/assets/js/customize/fidget-topology.js';
import {buildConicalJoint} from './conical-hinge.js';
import {bodyShape,textureTools,chamferedBlock} from './shapes.js';
import {buildBlockMark} from './decoration.js';
import {topSupportPosts,sideSupportStrip,sideBearingTipSupports} from './supports.js';

export function buildCubeAssembly(p,ctx) {
  const {wasm}=ctx;
  const g=cubeMechanics(p), topology=cubeTopology(g), {Manifold:M}=wasm;
  const temps=[],solids=[],marks=[],warnings=[]; const t=s=>{temps.push(s);return s;};
  const joint=buildConicalJoint(wasm,g);
  const transform=(s,j)=>t(t(s.rotate(j.rotation)).translate(j.origin));
  try {
    const cuts=topology.joints.map(j=>transform(joint.cut,j));
    const allCuts=t(M.union(cuts));
    const pins=topology.blocks.map(()=>[]);
    const endpointPins=new Map();
    for(const j of topology.joints) j.blocks.forEach((id,end)=>{
      const placed=transform(joint.pins[end],j);
      pins[id].push(placed);endpointPins.set(`${j.id}:${id}`,placed);
    });
    const base=bodyShape(wasm,g,t);
    // Round bodies have no sharp outer edges, but their bearing feet still need
    // a safety bevel so two feet can pass each other during the complete fold.
    const mountBase=g.shape==='spherical'?chamferedBlock(wasm,[g.sx,g.sy,g.sz],g.radius/2,t):null;
    const texture=textureTools(wasm,g,base,t);
    // Conservative rectangular lands reserve material around both bearings and
    // their openings. Decorations never take material from those lands.
    const protect=t(M.union(cuts.map(c=>{
      const b=c.boundingBox(),wall=1.2;
      return t(t(M.cube(b.max.map((v,i)=>v-b.min[i]+2*wall))).translate(b.min.map(v=>v-wall)));
    })));
    for(const b of topology.blocks) {
      const localG=g.shape==='triangle'?{...g,triangleX:b.id%2?-1:1,triangleY:b.id<4?-1:1}:g;
      const localBase=g.shape==='triangle'?bodyShape(wasm,localG,t):base;
      const localTexture=g.shape==='triangle'?textureTools(wasm,localG,localBase,t):texture;
      const decorated=buildBlockMark(p,ctx,localG,b.id,localBase,t);
      let blank=t(localBase.translate(b.origin));
      if(mountBase) {
        // Narrow bearings on a large sphere can leave top/side pins detached,
        // too. Root every bearing in a land extending to the print bed.
        // These are inside the original cube envelope, so they preserve its
        // verified motion clearance while the main body remains spherical.
        const lands=[];
        const clip=t(mountBase.translate(b.origin));
        for(const j of topology.joints.filter(j=>j.blocks.includes(b.id))) {
          const pin=endpointPins.get(`${j.id}:${b.id}`);
          const box=pin.boundingBox(),wall=1.2;
          const pad=t(t(M.cube([box.max[0]-box.min[0]+2*wall,box.max[1]-box.min[1]+2*wall,box.max[2]+wall])).translate([box.min[0]-wall,box.min[1]-wall,0]));
          lands.push(t(pad.intersect(clip)));
        }
        blank=t(M.union([blank,...lands]));
      }
      let body=t(blank.subtract(allCuts));
      if(localTexture) {
        const placed=t(localTexture.translate(b.origin));
        let safe=t(placed.subtract(protect));
        if(decorated)safe=t(safe.subtract(t(decorated.mask.translate(b.origin))));
        body=t(body.subtract(safe));
      }
      const posts=(p.removable_supports??true)?topology.joints.filter(j=>j.kind==='top'&&j.blocks.includes(b.id)).flatMap(j=>{
        const post=topSupportPosts(wasm,g,j,t)[j.blocks.indexOf(b.id)];
        return [post];
      }):[];
      const solid=M.union([body,...pins[b.id],...posts]);
      solids.push({name:`Block ${b.id+1}`,color:p[`block_${b.id+1}_color`]??p.body_color??'#315b6c',solid});
      if(decorated) {
        const solid=decorated.mark.translate(b.origin);
        marks.push({name:`Mark ${b.id+1}`,color:p.mark_color??'#f6f5f1',solid});
        warnings.push(...decorated.warnings);
      }
    }
    for(const j of topology.joints) {
      const turned=t(joint.link.rotate(j.rotation));
      const placed=t(turned.translate(j.origin));
      let solid;
      if((p.removable_supports??true)&&j.kind==='side') {
        const strip=t(M.union([sideSupportStrip(wasm,g,j,t),...sideBearingTipSupports(wasm,g,j,t)]));
        const bodies=t(M.union(j.blocks.map(i=>solids[i].solid)));
        const freeStrip=t(strip.subtract(bodies));
        solid=M.union([placed,freeStrip]);
      }else solid=placed.translate([0,0,0]);
      solids.push({name:`Captured link ${j.id+1}`,color:p.link_color??'#d6a052',solid});
    }
    solids.push(...marks);marks.length=0;
    return {solids,filenameBase:`infinity-fidget-${g.shape}`,slicerSettings:{layer_height:'0.2',initial_layer_print_height:'0.2',wall_generator:'arachne',enable_support:'0'},warnings:[...new Set(warnings),
      'Physical bearing fit, support release and durability have not been certified. Print the fit sample before the complete fidget.',
      (p.removable_supports??true)?'Remove the side strips and top posts, then gently release the joints to break the four tiny bearing-tip stalks. Automatic slicer supports should be off.':'Built-in supports are off. This bare mechanism has unsupported starts and is for inspection, not production printing.',
      `Nominal bearing clearance ${g.clearance} mm. Print a fit sample first.`
    ]};
  }catch(e){[...solids,...marks].forEach(p=>p.solid.delete());throw e;}
  finally{joint.dispose();temps.reverse().forEach(s=>s.delete());}
}
