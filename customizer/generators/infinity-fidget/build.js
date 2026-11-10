import {buildCubeAssembly} from './cube-assembly.js';
import {buildConicalFitSample} from './fit-sample.js';
export default function build(params,ctx) {
  if(params.model_kind==='fit')return buildConicalFitSample(params,ctx);
  if(params.model_kind!=null&&params.model_kind!=='assembly')throw new RangeError('Choose the complete fidget or a bearing fit sample.');
  return buildCubeAssembly(params,ctx);
}
