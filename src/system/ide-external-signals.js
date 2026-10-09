import { canonicalModelName } from '../upgrade/model-identity.js';
import { IDE_MODEL_ROLES } from '../llm/role-runtime-settings.js';
import { ideError, record, textField } from '../db/ide-store.js';

export function validateExternalSignal(input) {
  record(input,['revision','model','role','metric','score','minimum','maximum','sourceUrl','measuredAt','referenceModel']);
  if(!IDE_MODEL_ROLES.includes(input.role)||![input.score,input.minimum,input.maximum].every(Number.isFinite)
    ||input.minimum>=input.maximum||input.score<input.minimum||input.score>input.maximum)
    throw ideError('IDE_EXTERNAL_SIGNAL_INVALID');
  let source;try{source=new URL(input.sourceUrl);}catch{throw ideError('IDE_EXTERNAL_SOURCE_INVALID');}
  if(source.protocol!=='https:'||source.username||source.password||source.hash||source.href.length>2000)
    throw ideError('IDE_EXTERNAL_SOURCE_INVALID');
  if(typeof input.measuredAt!=='string'||!Number.isFinite(Date.parse(input.measuredAt))||new Date(input.measuredAt).toISOString()!==input.measuredAt
    ||Date.parse(input.measuredAt)>Date.now())throw ideError('IDE_EXTERNAL_DATE_INVALID');
  const model=textField(input.model,200);
  if(!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(model))throw ideError('IDE_MODEL_NAME_INVALID');
  return {model,role:input.role,metric:textField(input.metric),score:input.score,minimum:input.minimum,maximum:input.maximum,
    sourceUrl:source.href,measuredAt:input.measuredAt,referenceModel:textField(input.referenceModel),
    evidence:'OPERATOR_IMPORTED_EXTERNAL_REFERENCE',identityScope:'MODEL_REFERENCE_NOT_LOCAL_DIGEST'};
}
export function externalSignalsForCandidate(store,candidate,bindings) {
  const signals=store.list('external-signal'),normalize=s=>(s.score-s.minimum)/(s.maximum-s.minimum)*100;
  return signals.filter(s=>canonicalModelName(s.model)===canonicalModelName(candidate.name)).map(signal=>{
    const incumbent=signals.filter(s=>s.role===signal.role&&canonicalModelName(s.model)===canonicalModelName(bindings[signal.role])
      &&s.sourceUrl===signal.sourceUrl&&s.metric===signal.metric&&s.minimum===signal.minimum&&s.maximum===signal.maximum
      // Do not subtract scores from different benchmark revisions/dates.
      &&s.measuredAt===signal.measuredAt).sort((a,b)=>b.updatedAt-a.updatedAt)[0];
    return {...signal,normalizedPercent:normalize(signal),estimatedGainPoints:incumbent?normalize(signal)-normalize(incumbent):null,
      comparisonModel:bindings[signal.role]||null,comparisonEvidenceId:incumbent?.id||null,
      use:'DOWNLOAD_AND_TEST_PRIORITY_ONLY',localQuality:null};
  });
}
