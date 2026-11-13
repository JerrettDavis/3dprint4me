import {cubeMechanics,minimumCornerGap} from '../fidget-topology.js?v=7d07d40d5e3cc157';
import {FIDGET_LICENSE} from '../fidget-license.js?v=7d07d40d5e3cc157';
import {fontSchema,fontRule,FONT_SPEC} from '../fonts.js?v=7d07d40d5e3cc157';

const isAssembly=p=>p.model_kind!=='fit';
const hasWriting=p=>isAssembly(p)&&Array.from({length:8},(_,i)=>String(p[`block_${i+1}_symbol`]??'').trim()).some(Boolean);
const textured=p=>isAssembly(p)&&p.texture!=='smooth';
const blockFields=Object.fromEntries(Array.from({length:8},(_,i)=>[
  [`block_${i+1}_color`,{type:'color',label:`Block ${i+1} color`,default:'#315b6c',group:'colors',section:'blocks',randomize:i<2,...(i>1?{visibleWhen:isAssembly}:{})}],
  [`block_${i+1}_symbol`,{type:'text',label:`Block ${i+1} writing`,max:3,optional:true,default:'',group:'writing',section:'marks',randomize:false,visibleWhen:isAssembly,help:'Up to three symbols. Use one per block to spell a word across the fidget.'}]
]).flat());

function rules(p) {
  const errors=[],fieldErrors={},limits={};
  const add=(keys,message)=>{errors.push(message);for(const key of keys)fieldErrors[key]=message;};
  if([p.size_mm,p.clearance_mm].every(Number.isFinite)) {
    const max=Math.min(10,Math.floor(((p.size_mm*(p.shape==='triangle'?0.4:0.5)-1.2-2*p.clearance_mm)/0.975)*5+1e-8)/5);
    const min=p.shape==='spherical'?Math.max(4,Math.ceil(p.size_mm/4*5-1e-8)/5):4;
    limits.connector_mm=[min,Math.max(min,max)];
  }
  if(Number.isFinite(p.connector_mm))limits.chamfer_mm=[0,Math.min(2.5,Math.floor(Math.min(p.connector_mm,limits.connector_mm?.[1]??10)/4*10+1e-8)/10)];
  if([p.connector_mm,p.chamfer_mm,p.mark_height_mm].every(Number.isFinite)) {
    const corner=minimumCornerGap(p.connector_mm,p.shape==='spherical'?p.connector_mm/4:p.chamfer_mm);
    const mark=hasWriting(p)||(isAssembly(p)&&p.artwork!=='none')?2*p.mark_height_mm+0.2:0;
    limits.block_gap_mm=[Math.max(0.6,Math.ceil(Math.max(corner,mark)*10-1e-8)/10),4.5];
  }
  try{cubeMechanics(p);}catch(e){
    const message=String(e.message);
    const keys=/decorated|relief/i.test(message)?['mark_height_mm','block_gap_mm']:/block gap/i.test(message)?['block_gap_mm','chamfer_mm']:/chamfer/i.test(message)?['chamfer_mm','connector_mm']:/connector|socket/i.test(message)?['connector_mm','size_mm','clearance_mm']:['size_mm'];
    add(keys,message);
  }
  const colors=Array.from({length:isAssembly(p)?8:2},(_,i)=>p[`block_${i+1}_color`]);
  colors.push(p.link_color);
  if(hasWriting(p)||(isAssembly(p)&&p.artwork!=='none'))colors.push(p.mark_color);
  if(new Set(colors).size>5)add(['link_color','mark_color',...Array.from({length:8},(_,i)=>`block_${i+1}_color`)],'Use at most five unique material colors across the blocks, connectors and writing. Reuse a color for several blocks.');
  if(isAssembly(p)&&p.artwork!=='none') for(let i=1;i<=8;i++) {
    if((p.artwork_block==='all'||p.artwork_block===String(i))&&String(p[`block_${i}_symbol`]??'').trim())add([`block_${i}_symbol`,'artwork_block'],`Clear block ${i} writing before placing artwork on that block.`);
  }
  const font=fontRule(p,hasWriting(p));
  errors.push(...font.errors);Object.assign(fieldErrors,font.fieldErrors);
  return {errors,fieldErrors,limits};
}

const presets={
  classic:{},
  knurled:{texture:'knurled'},
  honeycomb:{texture:'hexagons'},
  rectangular:{shape:'rectangular',aspect:1.3,texture:'lines'},
  spheres:{shape:'spherical',chamfer_mm:0},
  triangle:{shape:'triangle',connector_mm:6,chamfer_mm:1.5},
  'fit-sample':{model_kind:'fit'},
  'pixel-face':{artwork:'pixel-face',block_1_color:'#527c70',block_2_color:'#527c70',block_3_color:'#527c70',block_4_color:'#527c70',block_5_color:'#527c70',block_6_color:'#527c70',block_7_color:'#527c70',block_8_color:'#527c70',mark_color:'#161614'},
  letters:{block_1_symbol:'F',block_2_symbol:'I',block_3_symbol:'D',block_4_symbol:'G',block_5_symbol:'E',block_6_symbol:'T',block_7_symbol:'!',block_8_symbol:'!'}
};

export default {
  id:'infinity-fidget',version:1,title:'Infinity fidget',category:'fidgets',origin:'house',
  blurb:'Create an articulated fidget with shaped blocks, tactile surfaces, individual colors and local artwork.',
  rights:{publishable:true,note:'Conical bearings and eight-block layout adapted from Jan Pieper’s MIT Sturdy Infinity Cube. Triangle corner planes and offset bearing placement informed by the user-supplied permissioned reference. Original parametric surfaces and pixel artwork. Local notice at /customize/licenses/infinity-fidget-MIT.txt.'},
  stlHeader:'Jan Pieper MIT|https://3dprint4.me/customize/licenses/infinity-fidget-MIT.txt',
  publicParams:p=>({...p,source_author:'Jan Pieper',source_design:'Sturdy Infinity Cube',source_license:'MIT',source_repository:'github.com/jhpieper/sturdy-infinity-cube',source_notice:FIDGET_LICENSE,source_notice_url:'https://3dprint4.me/customize/licenses/infinity-fidget-MIT.txt'}),
  initialView:'3d',viewLabels:{front:'Top',back:'Bottom'},
  sections:{blocks:'Blocks',joints:'Connectors',surface:'Surface',marks:'Writing & artwork'},
  focus:[{part:'Block ',section:'blocks'},{part:'Captured link ',section:'joints'},{part:'Mark ',section:'marks'}],
  schema:{
    model_kind:{type:'enum',label:'Model to print',default:'assembly',group:'construction',section:'joints',randomize:false,options:[{value:'assembly',label:'Complete fidget'},{value:'fit',label:'Two-block bearing fit sample'}],help:'Print the fit sample with your chosen connector and clearance before making the full fidget. Only the selected model is downloaded or sent with your request.'},
    shape:{randomize:false,type:'enum',label:'Block shape',default:'cube',group:'shape',section:'blocks',options:[{value:'cube',label:'Cube'},{value:'rectangular',label:'Rectangular'},{value:'spherical',label:'Spherical'},{value:'triangle',label:'Infinity triangle'}]},
    size_mm:{randomize:false,type:'number',label:'Block size',default:20,min:18,max:40,step:1,unit:'mm',group:'size',section:'blocks'},
    aspect:{randomize:false,type:'number',label:'Rectangular length ratio',default:1,min:1,max:1.5,step:0.1,group:'size',section:'blocks',visibleWhen:{shape:'rectangular'}},
    chamfer_mm:{randomize:false,type:'number',label:'Edge chamfer',default:2,min:0,max:2.5,step:0.1,unit:'mm',group:'shape',section:'blocks'},
    connector_mm:{type:'number',label:'Connector thickness',default:8,min:4,max:10,step:0.2,unit:'mm',group:'construction',section:'joints',advanced:true,randomize:false},
    clearance_mm:{type:'number',label:'Bearing clearance',default:0.4,min:0.2,max:0.5,step:0.05,unit:'mm',group:'construction',section:'joints',advanced:true,randomize:false,help:'Nominal radial and end clearance, not a guaranteed printer fit. Start with a fit sample.'},
    block_gap_mm:{type:'number',label:'Gap between blocks',default:1,min:0.6,max:4.5,step:0.1,unit:'mm',group:'construction',section:'joints',advanced:true,randomize:false,help:'Square edges and taller artwork need more space to pass during folding.'},
    removable_supports:{type:'bool',label:'Built-in breakaway supports',default:true,group:'construction',section:'joints',advanced:true,randomize:false,help:'Keep on for printing. Remove the tiny side strips and top posts before folding. Turning this off shows the bare mechanism and leaves unsupported starts.'},
    texture:{type:'enum',label:'Surface detail',visibleWhen:isAssembly,default:'smooth',group:'surface',section:'surface',options:[{value:'smooth',label:'Smooth'},{value:'knurled',label:'Knurled diamonds'},{value:'ridged',label:'Horizontal ridges'},{value:'hexagons',label:'Hexagons'},{value:'lines',label:'Vertical lines'}],help:'Engraved details follow the surface and keep bearing lands and the print-bed face clear.'},
    texture_depth_mm:{type:'number',label:'Texture depth',default:0.4,min:0.2,max:0.8,step:0.1,unit:'mm',group:'surface',section:'surface',advanced:true,visibleWhen:textured},
    texture_pitch_mm:{type:'number',label:'Texture spacing',default:3,min:2.4,max:6,step:0.2,unit:'mm',group:'surface',section:'surface',advanced:true,visibleWhen:textured},
    ...blockFields,
    link_color:{type:'color',label:'Connector color',default:'#d6a052',group:'colors',section:'joints'},
    mark_color:{type:'color',visibleWhen:isAssembly,label:'Writing / artwork color',default:'#f6f5f1',group:'colors',section:'marks',randomize:false},
    mark_height_mm:{randomize:false,type:'number',visibleWhen:isAssembly,label:'Writing / artwork relief',default:0.4,min:0.4,max:1,step:0.2,unit:'mm',group:'writing',section:'marks',advanced:true},
    artwork:{randomize:false,type:'enum',label:'Artwork',visibleWhen:isAssembly,default:'none',group:'artwork',section:'marks',options:[{value:'none',label:'No image'},{value:'pixel-face',label:'Original pixel face'},{value:'image',label:'My local image'}]},
    artwork_block:{randomize:false,type:'enum',label:'Artwork block',default:'1',group:'artwork',section:'marks',visibleWhen:p=>isAssembly(p)&&p.artwork!=='none',options:[...Array.from({length:8},(_,i)=>({value:String(i+1),label:`Block ${i+1}`})),{value:'all',label:'Every block'}]},
    image_threshold:{randomize:false,type:'int',label:'Image threshold',default:128,min:0,max:255,step:1,group:'artwork',section:'marks',visibleWhen:{artwork:'image',model_kind:'assembly'},advanced:true},
    image_invert:{randomize:false,type:'bool',label:'Invert image',default:false,group:'artwork',section:'marks',visibleWhen:{artwork:'image',model_kind:'assembly'},advanced:true},
    ...Object.fromEntries(Object.entries(fontSchema('writing',hasWriting)).map(([key,field])=>[key,{...field,section:'marks'}]))
  },
  rules,
  onParamChange(key,p){
    if(![p.size_mm,p.connector_mm,p.clearance_mm,p.chamfer_mm].every(Number.isFinite))return null;
    let size=p.size_mm,connector=p.connector_mm,chamfer=p.chamfer_mm;
    const bearingWidthRatio=p.shape==='triangle'?0.4:0.5;
    if(p.shape==='spherical'&&key!=='connector_mm')connector=Math.max(connector,Math.ceil(size/4*5-1e-8)/5);
    if(p.shape==='spherical'&&key==='connector_mm'){
      size=Math.min(size,Math.max(18,Math.floor(connector*4+1e-8)));
      connector=Math.max(connector,Math.ceil(size/4*5-1e-8)/5);
    }
    if(key==='chamfer_mm')connector=Math.max(connector,Math.ceil(4*chamfer*5-1e-8)/5);
    if(key==='connector_mm'||key==='chamfer_mm')size=Math.max(size,Math.ceil((1.2+2*p.clearance_mm+0.975*connector)/bearingWidthRatio-1e-8));
    if(key==='size_mm'||key==='clearance_mm'||key==='shape')connector=Math.min(connector,Math.floor((size*bearingWidthRatio-1.2-2*p.clearance_mm)/0.975*5+1e-8)/5);
    chamfer=Math.min(chamfer,Math.floor(connector/4*10+1e-8)/10);
    let gap=p.block_gap_mm;
    const corner=minimumCornerGap(connector,p.shape==='spherical'?connector/4:chamfer);
    const mark=hasWriting(p)||(isAssembly(p)&&p.artwork!=='none')?2*p.mark_height_mm+0.2:0;
    if(Number.isFinite(gap)) {
      if(key==='block_gap_mm'&&p.shape!=='spherical'){
        const r=connector/2,needed=r-Math.sqrt((r+gap/2)**2-r*r);
        chamfer=Math.min(connector/4,Math.max(chamfer,Math.ceil(needed*10-1e-8)/10));
        gap=Math.max(gap,Math.ceil(Math.max(minimumCornerGap(connector,chamfer),mark)*10-1e-8)/10);
      }else gap=Math.max(gap,Math.ceil(Math.max(corner,mark)*10-1e-8)/10);
    }
    return {size_mm:size,connector_mm:connector,chamfer_mm:chamfer,block_gap_mm:gap};
  },
  font:FONT_SPEC,image:{when:{artwork:'image',model_kind:'assembly'},threshold:'image_threshold',invert:'image_invert'},presets,
  designs:Object.entries(presets).map(([id,params])=>({id,label:{classic:'Classic cube',knurled:'Knurled',honeycomb:'Honeycomb',rectangular:'Long blocks',spheres:'Round blocks',triangle:'Infinity triangle','pixel-face':'Pixel face',letters:'Spell it out','fit-sample':'Bearing fit sample'}[id],blurb:'A starting point; change the blocks, finish and colors.',params})),defaultDesign:'classic',
  errorField(message){return /image|artwork/i.test(message)?'artwork':/font/i.test(message)?'font':/chamfer/i.test(message)?'chamfer_mm':/connector|bearing|socket/i.test(message)?'connector_mm':null;}
};
