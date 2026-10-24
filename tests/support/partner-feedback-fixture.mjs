import { unzipSync,strToU8,strFromU8 } from 'fflate';
import { createReviewDocx } from '../../lib/partner-outreach/docx.js';
export function annotatedFeedbackParts(){
 const files=unzipSync(createReviewDocx({markdown:'# Draft\n\n## [IMS-04] Fees\nOriginal fee.',sourceHash:'a'.repeat(64)}));
 files['word/document.xml']=strToU8(strFromU8(files['word/document.xml']).replace('<w:r><w:t xml:space="preserve">Original fee.</w:t></w:r>','<w:r><w:t>Original </w:t></w:r><w:del w:id="2" w:author="Reviewer"><w:r><w:delText>fee</w:delText></w:r></w:del><w:ins w:id="3" w:author="Reviewer"><w:r><w:t>project fee</w:t></w:r></w:ins><w:commentRangeStart w:id="4"/><w:r><w:t>.</w:t></w:r><w:commentRangeEnd w:id="4"/><w:r><w:commentReference w:id="4"/></w:r>'));
 files['word/comments.xml']=strToU8('<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="4" w:author="Reviewer"><w:p><w:r><w:t>Clarify &amp; disclose.</w:t></w:r></w:p></w:comment></w:comments>');
 files['word/_rels/document.xml.rels']=strToU8(strFromU8(files['word/_rels/document.xml.rels']).replace('</Relationships>','<Relationship Id="rIdComments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>'));
 files['[Content_Types].xml']=strToU8(strFromU8(files['[Content_Types].xml']).replace('</Types>','<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>'));
 return files;
}
