import { sameModelName } from '../upgrade/model-identity.js';
import { getModelRuntimeProfile, getCodeRuntimeProfile } from '../llm/model-runtime-profile.js';
import { getNumCtx } from './model-ctx.js';
import { ideError, record } from '../db/ide-store.js';

export const IDE_MODEL_ROLES = Object.freeze(['D1','D2','CODE','R1','R2','CHAT','VISION']);
// CHAT requires room for interpretation and an ordinary 2 000-character input.
// Longer requests still undergo per-call admission and receive a typed capacity error.
export const minimumRoleContext = role => role==='CHAT'?8192:512;
export function currentRoleArtifact(db, config, role) {
  if (!IDE_MODEL_ROLES.includes(role)) throw ideError('IDE_ROLE_INVALID');
  const binding = db.prepare('SELECT model_name,digest_sha256 FROM model_desired_bindings WHERE role=?').get(role);
  if (!binding || !sameModelName(binding.model_name,config.models[role])) throw ideError('IDE_BINDING_UNAVAILABLE',409);
  return {model:binding.model_name,digestSha256:binding.digest_sha256};
}
export function roleRuntimeSettings(db, config, role, model) {
  if (!db || !IDE_MODEL_ROLES.includes(role)) return null;
  const row=db.prepare("SELECT data_json FROM ide_documents WHERE kind='role' AND id=?").get(role);
  if (!row) return null;
  const settings=JSON.parse(row.data_json),artifact=currentRoleArtifact(db,config,role);
  return sameModelName(artifact.model,model) && sameModelName(settings.model,model)
    && settings.digestSha256===artifact.digestSha256
    && settings.contextWindowTokens>=minimumRoleContext(role) ? {...settings,role} : null;
}
export function validateRoleSettings(db, config, role, input) {
  record(input,['revision','model','digestSha256','contextWindowTokens','maxOutputTokens']);
  const artifact=currentRoleArtifact(db,config,role);
  if (!sameModelName(input.model,artifact.model) || input.digestSha256!==artifact.digestSha256)
    throw ideError('IDE_BINDING_CHANGED',409);
  if(Number.isSafeInteger(input.contextWindowTokens)&&input.contextWindowTokens<minimumRoleContext(role))
    throw ideError('IDE_CONTEXT_TOO_SMALL',422);
  if (!Number.isSafeInteger(input.contextWindowTokens)||input.contextWindowTokens<512||input.contextWindowTokens>262144
    || !Number.isSafeInteger(input.maxOutputTokens)||input.maxOutputTokens<1||input.maxOutputTokens>6000
    || input.maxOutputTokens>=input.contextWindowTokens) throw ideError('IDE_TOKEN_LIMIT_INVALID');
  const profile=getModelRuntimeProfile(artifact.model)||getCodeRuntimeProfile(artifact.model,artifact.digestSha256);
  if (profile && input.contextWindowTokens>profile.contextWindowTokens) throw ideError('IDE_CONTEXT_EXCEEDS_APPROVED_PROFILE',409);
  if(role==='CODE'&&getCodeRuntimeProfile(artifact.model,artifact.digestSha256)
    &&input.contextWindowTokens!==profile.contextWindowTokens)throw ideError('IDE_CODE_CONTEXT_PINNED',409);
  if(!(role==='CODE'&&getCodeRuntimeProfile(artifact.model,artifact.digestSha256))
    &&input.contextWindowTokens>getNumCtx(artifact.model))throw ideError('IDE_CONTEXT_EXCEEDS_RUNTIME_CEILING',409);
  return {...artifact,contextWindowTokens:input.contextWindowTokens,maxOutputTokens:input.maxOutputTokens};
}
