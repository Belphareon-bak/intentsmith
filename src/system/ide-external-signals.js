import { canonicalModelName } from '../upgrade/model-identity.js';
import { IDE_MODEL_ROLES } from '../llm/role-runtime-settings.js';
import { ideError, record, textField } from '../db/ide-store.js';
import { readFileSync } from 'node:fs';

// A pinned primary-source snapshot works offline. It describes the publisher's
// named model, never the installed quantization/digest or IntentSmith role quality.
const snapshot = JSON.parse(readFileSync(new URL('./ide-public-references.json', import.meta.url), 'utf8'));
const roleMetric = { CHAT:'MMLU Pro', D1:'GPQA Diamond', R1:'GPQA Diamond',
  CODE:'LiveCodeBench v6', D2:'LiveCodeBench v6', R2:'LiveCodeBench v6', VISION:'MMMU Pro' };
const bundledSignals = snapshot.sources.flatMap(source => source.models.flatMap(model =>
  Object.entries(roleMetric).map(([role,metric]) => ({
    id:source.id+':'+model.model+':'+role, model:model.model, referenceModel:model.referenceModel,
    role, metric, score:model.scores[metric], minimum:0, maximum:100,
    sourceUrl:source.sourceUrl, sourceSha256:source.sourceSha256,
    protocolId:source.id, observedAt:snapshot.observedAt, measuredAt:null,
    sourceUpdatedAt:source.sourceUpdatedAt, roleMapping:snapshot.roleMapping,
    evidence:'BUNDLED_PRIMARY_SOURCE_REFERENCE', identityScope:'MODEL_REFERENCE_NOT_LOCAL_DIGEST',
  }))));

export function publicReferenceSignals() { return structuredClone(bundledSignals); }
const sameProtocol = (a,b) => a.sourceUrl===b.sourceUrl && a.metric===b.metric
  && a.minimum===b.minimum && a.maximum===b.maximum && a.measuredAt===b.measuredAt
  && (a.protocolId||null)===(b.protocolId||null) && (a.sourceSha256||null)===(b.sourceSha256||null);

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
  const signals=[...store.list('external-signal'),...bundledSignals],normalize=s=>(s.score-s.minimum)/(s.maximum-s.minimum)*100;
  return signals.filter(s=>canonicalModelName(s.model)===canonicalModelName(candidate.name)).map(signal=>{
    const incumbent=signals.filter(s=>s.role===signal.role&&canonicalModelName(s.model)===canonicalModelName(bindings[signal.role])
      // Never subtract different publisher tables, revisions or measurement dates.
      &&sameProtocol(s,signal)).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))[0];
    return {...signal,normalizedPercent:normalize(signal),estimatedGainPoints:incumbent?normalize(signal)-normalize(incumbent):null,
      comparisonModel:bindings[signal.role]||null,comparisonEvidenceId:incumbent?.id||null,
      use:'DOWNLOAD_AND_TEST_PRIORITY_ONLY',localQuality:null};
  });
}
