import {composePrintEstimate,presentPublicEstimate} from '../compose-estimate.js';
import {estimateRow} from './estimate-session.js';
import {rollUpPackProduction} from './estimate-pack.js';

/** Complete one immutable operator pack revision using exactly its selected part jobs. */
export async function completeOperatorPackSlice({repository,job,result,now}) {
 if(!job.options._operatorEstimateId)return;
 const base=await repository.findEstimate(job.options._operatorEstimateId);
 if(!base?.geometry?.pack?.parts)return;
 const parts=[];
 for(const selection of base.geometry.pack.parts){
  const asset=await repository.findAsset(selection.partId);
  const match=selection.partId===job.assetId?result:await (async()=>{
   return repository.operatorSliceForAsset(selection.partId,base.geometry.operatorRevision);
  })();
  if(!asset||!match)return;
  parts.push({asset,quantity:selection.quantity,slicerProduction:match.input.production});
 }
 const options=base.input.options,production=rollUpPackProduction({parts,options});
 const estimate=composePrintEstimate({options,production,materialCost:base.cost.materialCost,model:base.pricing.model,now:now()});
 const asset=await repository.findAsset(base.assetId);
 await repository.insertEstimate(estimateRow({estimate,publicView:presentPublicEstimate({status:'ready',estimate,modelSummary:{filename:asset.originalName,format:'zip'},slice:{status:'ready'}}),asset,purpose:'slice',engine:result.engine,engineVersion:result.engineVersion,profileId:base.profileId,geometry:base.geometry,slicer:{pack:true}}));
}
