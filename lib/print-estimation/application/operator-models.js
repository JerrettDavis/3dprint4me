import {randomUUID} from 'node:crypto';
import {HttpError} from '../../http.js';
import {newSessionId,newCapabilityToken,hashCapability,validateAssetId,validateSessionId} from '../capability.js';
import {normalizeEstimateOptions,sliceProfileKey} from '../domain.js';
import {createEstimateSessionUseCases,estimateRow} from './estimate-session.js';
import {composePrintEstimate,presentPublicEstimate} from '../compose-estimate.js';
import {estimateProductionFromGeometry,GEOMETRY_ANALYZER} from '../geometry/analyze-model.js';
import {rollUpPackProduction,validateSelections} from './estimate-pack.js';

export function createOperatorModels({repository,fileStore,materialCosts,slicerEnabled=false,now=()=>new Date(),...runtime}) {
  function requireWork(work){if(!work?.item?.requestId||work.item.projectDraft)throw new HttpError(409,'Complete this project request before adding private models.');if(!repository||!fileStore)throw new HttpError(503,'Private model storage is not configured.');}
  async function sessionFor(work,id){requireWork(work);const session=await repository.findSession(validateSessionId(id));if(!session||session.assumptions?._operatorWorkId!==work.item.id)throw new HttpError(404,'This upload is not part of this work item.');return session;}
  function analysis(work,session) {
    const token=newCapabilityToken();
    // No anonymous capability is issued for operator sessions. Each call substitutes
    // an ephemeral capability only after checking authenticated work ownership.
    const scoped={...repository,findSession:async id=>id===session.id?{...session,ownershipHash:hashCapability(token)}:null};
    return {token,useCases:createEstimateSessionUseCases({...runtime,repository:scoped,fileStore,materialCosts,slicerEnabled:false,now,rateLimiter:{consume:async()=>{}}})};
  }
  async function estimate(work,input,{revision=randomUUID(),session=null}={}) {
    if(typeof revision!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(revision))throw new HttpError(400,'A valid estimate revision command is required.');
    requireWork(work);const asset=await repository.findAsset(validateAssetId(input.assetId));
    if(!asset||asset.requestId!==work.item.requestId)throw new HttpError(404,'This model is not attached to this work item.');
    if(asset.parentAssetId)throw new HttpError(400,'Estimate the whole pack with explicit part selections.');
    if(asset.state!=='ready')throw new HttpError(409,'A successfully analyzed model is required.');
    const options=normalizeEstimateOptions(input.options??session?.assumptions??work.request?.specifications??{});
    const parts=asset.format==='zip'?validateSelections(input.selections,await repository.listChildren(asset.id)):null;
    const children=parts?await repository.listChildren(asset.id):[];
    const production=parts?rollUpPackProduction({parts:parts.map(part=>({asset:children.find(a=>a.id===part.partId),quantity:part.quantity})),options}):estimateProductionFromGeometry(asset.geometryMetrics,options);
    const composed=composePrintEstimate({options,production,materialCost:await materialCosts.materialCost(options.material),now:now()});
    const publicView=presentPublicEstimate({status:'ready',estimate:composed,modelSummary:{filename:asset.originalName,format:asset.format},slice:{status:slicerEnabled?'pending':'unavailable'}});
    const saved=await repository.insertEstimate(estimateRow({estimate:composed,publicView,asset,purpose:'operator',engine:GEOMETRY_ANALYZER.engine,engineVersion:GEOMETRY_ANALYZER.version,profileId:`operator:${sliceProfileKey(options)}`,geometry:{...(parts?{pack:{parts}}:asset.geometryMetrics),operatorRevision:revision}}));
    const canonicalParts=value=>JSON.stringify((value??[]).map(p=>({partId:p.partId,quantity:p.quantity})).sort((a,b)=>a.partId.localeCompare(b.partId)));
    if(saved.assetId!==asset.id||JSON.stringify(normalizeEstimateOptions(saved.input.options))!==JSON.stringify(options)||canonicalParts(saved.geometry?.pack?.parts)!==canonicalParts(parts))throw new HttpError(409,'This estimate command was already used for different inputs. Review the current estimate before trying again.');
    if(slicerEnabled){
      const queue=parts?parts.map(part=>({asset:children.find(a=>a.id===part.partId),quantity:part.quantity})): [{asset,quantity:1}];
      for(const part of queue)await repository.enqueueJob({assetId:part.asset.id,jobType:'slice',profileKey:`${sliceProfileKey(options)}:${saved.id}`,options:{...options,quantity:parts?1:options.quantity,_operatorRevision:revision,_operatorEstimateId:saved.id}});
    }
    return {status:'ready',estimateId:saved.id,assetId:asset.id};
  }
  return {
    async authorizeUpload(work,input){
      requireWork(work);const options=normalizeEstimateOptions(input.options??work.request?.specifications??{}),id=newSessionId();
      const session=await repository.createSession({id,ownershipHash:hashCapability(newCapabilityToken()),assumptions:{...options,_operatorWorkId:work.item.id},expiresAt:new Date(now().getTime()+24*3600000).toISOString()});
      const scoped=analysis(work,session);
      const grant=await scoped.useCases.authorizeUpload({...input,sessionId:id,token:scoped.token});
      return {...grant,sessionId:id};
    },
    async finish(work,input){
      let session=await sessionFor(work,input.sessionId);
      const asset=await repository.findAsset(validateAssetId(input.assetId));
      if(!asset||asset.sessionId!==session.id)throw new HttpError(404,'This model is not part of this upload.');
      let result;
      if(session.state==='open'){const scoped=analysis(work,session);result=await scoped.useCases.analyze({sessionId:session.id,assetId:asset.id,token:scoped.token});await repository.attachOperatorSession({sessionId:session.id,workId:work.item.id,requestId:work.item.requestId});}
      else if(session.requestId!==work.item.requestId)throw new HttpError(404,'This upload is not part of this work item.');
      const current=await repository.findAsset(asset.id);
      if(current.state!=='ready')return {status:'failed',assetId:asset.id};
      if(current.format==='zip')return {status:'pack',assetId:asset.id,parts:(await repository.listChildren(asset.id)).map(a=>({id:a.id,name:a.archiveEntry,state:a.state,quantity:a.quantity??1}))};
      return estimate(work,{assetId:asset.id,options:session.assumptions},{revision:session.id,session});
    },
    estimate
  };
}
