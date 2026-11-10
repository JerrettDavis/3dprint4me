import {blockTextLines,fontTextLines,fitCrossSection,unsupportedBlockChars,BLOCK_SUBSTITUTION_WARNING} from '../../framework/text.js';
import {imageCrossSection} from '../../framework/image-trace.js';

// An original pixel face, not an imported game asset. Image files use the existing
// local tracing path; only bounded contours reach this worker, never file names.
const PIXEL_FACE=[
  '00000000','01100110','01100110','00000000',
  '01000010','00111100','00011000','00000000'
];

export function buildBlockMark(p,ctx,g,id,outer,t) {
  const {CrossSection:C}=ctx.wasm;
  const artwork=p.artwork??'none', target=p.artwork_block??'1';
  if(!['none','pixel-face','image'].includes(artwork)) throw new RangeError('Choose an available artwork type.');
  if(!['all','1','2','3','4','5','6','7','8'].includes(String(target))) throw new RangeError('Choose a block for the artwork.');
  const useArt=artwork!=='none'&&(target==='all'||String(target)===String(id+1));
  const text=String(p[`block_${id+1}_symbol`]??'').trim();
  if([...text].length>3) throw new RangeError(`Block ${id+1} writing must have at most three symbols.`);
  if(useArt&&text) throw new RangeError(`Clear block ${id+1} writing before placing artwork on that block.`);
  if(!useArt&&!text) return null;
  const box={cx:g.sx/2,cy:g.sy*(id<4?0.3:0.7),maxW:g.size*0.36,maxH:g.size*0.24};
  const warnings=[];
  let section;
  if(useArt) {
    let raw;
    if(artwork==='image') {
      if(!ctx.imageContours) throw new Error('Choose a local image first, or select the built-in pixel face.');
      raw=t(imageCrossSection(C,ctx.imageContours));
    }else {
      const cells=[];
      PIXEL_FACE.forEach((row,y)=>[...row].forEach((v,x)=>{if(v==='1')cells.push(t(t(C.square([1,1])).translate([x,7-y])));}));
      raw=t(C.union(cells));
    }
    if(raw.isEmpty()) throw new Error('The artwork has no printable outline. Choose a bolder image.');
    section=t(fitCrossSection(raw,{maxWidth:box.maxW,maxHeight:box.maxH,centerX:box.cx,centerY:box.cy}));
  }else if((p.font??'block')==='block') {
    const built=blockTextLines(C,[text],box,t);section=built.cs;
    if(unsupportedBlockChars(text).length)warnings.push(BLOCK_SUBSTITUTION_WARNING);
  }else {
    if(!ctx.font)throw new Error('The selected font is not loaded. Try again or choose the built-in block font.');
    const built=fontTextLines(C,ctx.font,text,box,t);section=built.cs;
    if(built.skipped?.length)warnings.push('Some characters are unavailable in the selected font. Choose another font for those symbols.');
  }
  if(section.isEmpty())throw new Error(`Block ${id+1} has no drawable symbols in the selected font.`);
  const relief=p.mark_height_mm??0.4;
  if(typeof relief!=='number'||!Number.isFinite(relief)||relief<0.4||relief>1)throw new RangeError('Mark height must be between 0.4 and 1 mm.');
  const mask=t(section.extrude(g.sz+relief+1));
  const cap=t(t(outer.translate([0,0,relief])).subtract(outer));
  const mark=t(cap.intersect(mask));
  if(mark.isEmpty())throw new Error(`Block ${id+1} artwork does not reach the surface.`);
  return {mask,mark,warnings};
}
