import { zipSync,strToU8 } from 'fflate';
import { HttpError } from '../http.js';

const XML='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function runs(source){
 return source.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).filter(Boolean).map(part=>{
  const bold=part.startsWith('**')&&part.endsWith('**'),code=part.startsWith('`')&&part.endsWith('`');
  const italic=!bold&&part.startsWith('*')&&part.endsWith('*');
  const value=bold?part.slice(2,-2):code||italic?part.slice(1,-1):part;
  return `<w:r>${bold?'<w:rPr><w:b/></w:rPr>':italic?'<w:rPr><w:i/></w:rPr>':''}<w:t xml:space="preserve">${esc(value)}</w:t></w:r>`;
 }).join('');
}
function paragraph(text,style='Normal',list=false){
 return `<w:p><w:pPr><w:pStyle w:val="${style}"/>${list?'<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>':''}</w:pPr>${runs(text)}</w:p>`;
}
const cells=line=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(value=>value.trim());
const divider=line=>line?.includes('|')&&cells(line).every(value=>/^:?-{3,}:?$/.test(value));
function table(rows){
 const count=rows[0].length;
 if(count<2||count>6||rows.length>200||rows.some(row=>row.length!==count||row.some(value=>value.length>4000)))throw new HttpError(400,'Review tables support two to six columns, up to 200 rows and 4000 characters per cell.');
 const weights=rows[0].map((_,column)=>Math.max(12,...rows.map(row=>Math.min(60,row[column].length)))),total=weights.reduce((a,b)=>a+b,0);
 const widths=weights.map(weight=>Math.floor(10080*weight/total));widths[count-1]+=10080-widths.reduce((a,b)=>a+b,0);
 return '<w:tbl><w:tblPr><w:tblW w:w="10080" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>'+widths.map(width=>`<w:gridCol w:w="${width}"/>`).join('')+'</w:tblGrid>'+rows.map((row,index)=>'<w:tr><w:trPr><w:cantSplit/>'+(index===0?'<w:tblHeader/>':'')+'</w:trPr>'+row.map((value,column)=>`<w:tc><w:tcPr><w:tcW w:w="${widths[column]}" w:type="dxa"/><w:tcMar><w:top w:w="100" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar><w:vAlign w:val="center"/>${index===0?'<w:tcBorders><w:bottom w:val="single" w:sz="4" w:color="777777"/></w:tcBorders>':''}</w:tcPr>${paragraph(value,index===0?'TableHeader':'Normal')}</w:tc>`).join('')+'</w:tr>').join('')+'</w:tbl>'+paragraph('');
}
/** Restricted text-only Markdown. Clause IDs and placeholders remain editable.
 * No HTML, images, hyperlinks, macros, relationships or remote templates derive
 * from input. Provenance identifies source text; this is not an e-signature. */
export function createReviewDocx({markdown,sourceHash}){
 if(typeof markdown!=='string'||(markdown.length>200000&&!(markdown.length===200001&&markdown.endsWith('\n')))||!markdown.trim()||!/^[a-f0-9]{64}$/.test(sourceHash))throw new Error('Invalid review document source.');
 if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(markdown))throw new Error('Invalid document control character.');
 const blocks=[];let pending=[],firstTitle=true;
 const flush=()=>{if(pending.length){blocks.push(paragraph(pending.join(' ')));pending=[];}};
 const lines=markdown.replace(/\r\n?/g,'\n').split('\n');
 for(let lineNo=0;lineNo<lines.length;lineNo++){
  const line=lines[lineNo];
  if(line.includes('|')&&divider(lines[lineNo+1])){
   flush();const rows=[cells(line)];lineNo++;
   while(lines[lineNo+1]?.trim()&&lines[lineNo+1].includes('|'))rows.push(cells(lines[++lineNo]));
   blocks.push(table(rows));continue;
  }
  const heading=/^(#{1,6})\s+(.+)$/.exec(line),bullet=/^\s*[-*]\s+(.+)$/.exec(line);
  if(!line.trim()){flush();continue;}
  if(heading){flush();const title=heading[1].length===1&&firstTitle;blocks.push(paragraph(heading[2],title?'Title':heading[1].length<=2?'Heading1':'Heading2'));if(title)firstTitle=false;}
  else if(bullet){flush();blocks.push(paragraph(bullet[1],'Normal',true));}
  else pending.push(line.trim());
 }
 flush();
 const styles=XML+`<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Liberation Serif" w:hAnsi="Liberation Serif"/><w:color w:val="000000"/><w:sz w:val="23"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="240"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="36"/></w:rPr></w:style>${[1,2].map(n=>`<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="220" w:after="100"/><w:outlineLvl w:val="${n-1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${n===1?26:24}"/></w:rPr></w:style>`).join('')}</w:styles>`;
 const parts={
  '[Content_Types].xml':XML+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>',
  '_rels/.rels':XML+`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
  'word/document.xml':XML+`<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${blocks.join('')}<w:sectPr><w:footerReference w:type="default" r:id="rId3"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="360" w:footer="480"/></w:sectPr></w:body></w:document>`,
  'word/styles.xml':blocks.some(block=>block.startsWith('<w:tbl>'))?styles.replace('</w:styles>','<w:style w:type="paragraph" w:styleId="TableHeader"><w:name w:val="Table Header"/><w:basedOn w:val="Normal"/><w:rPr><w:b/></w:rPr></w:style></w:styles>'):styles,
  'word/numbering.xml':XML+`<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="360"/></w:tabs><w:ind w:left="360" w:hanging="180"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
  'word/_rels/document.xml.rels':XML+`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${R}/numbering" Target="numbering.xml"/><Relationship Id="rId3" Type="${R}/footer" Target="footer1.xml"/></Relationships>`,
  'word/footer1.xml':XML+`<w:ftr xmlns:w="${W}"><w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>Review copy   Source SHA256 ${sourceHash.slice(0,16)}   Page </w:t></w:r><w:fldSimple w:instr="PAGE"/></w:p></w:ftr>`,
 };
 return zipSync(Object.fromEntries(Object.entries(parts).map(([name,value])=>[name,[strToU8(value),{mtime:new Date(1980,0,1)}]])),{level:6});
}
