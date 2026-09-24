// Two accepted semantic judges are independent only when their exact artifacts
// and known model families differ. Unknown provenance cannot prove a pair.
import { parseModelNameExtended } from '../upgrade/model-family-extensions.js';
import { createHash } from 'node:crypto';

const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function independentGraderPair(left, right, answerDigestSha256 = null) {
  const a = left?.judge, b = right?.judge;
  const family = name => {
    const parsed = parseModelNameExtended(name).family;
    if (!parsed || parsed === 'unknown') return null;
    if (parsed === 'qwq' || parsed.startsWith('qwen')) return 'qwen';
    if (parsed === 'devstral' || parsed.startsWith('mistral')) return 'mistral';
    if (parsed.startsWith('gemma')) return 'gemma';
    return parsed;
  };
  const familyA = family(a?.modelName), familyB = family(b?.modelName);
  return Boolean(left?.id && right?.id && left.id !== right.id
    && hash(a?.digestSha256) && hash(b?.digestSha256)
    && a.digestSha256 !== b.digestSha256
    && a.digestSha256 !== answerDigestSha256 && b.digestSha256 !== answerDigestSha256
    && a.providerVersion && b.providerVersion
    && familyA && familyB && familyA !== familyB);
}

export function acceptedGraderPair(graders, answerDigestSha256 = null) {
  const eligible = (graders || []).filter(g => g?.judge?.digestSha256 !== answerDigestSha256);
  const pairs = [];
  for (let i = 0; i < eligible.length; i++) for (let j = i + 1; j < eligible.length; j++) {
    if (independentGraderPair(eligible[i], eligible[j], answerDigestSha256)) pairs.push([eligible[i], eligible[j]]);
  }
  return pairs.length === 1 ? pairs[0] : null;
}

// A historical single-judge score remains visible in history, but it cannot
// satisfy current collection readiness or qualify an operational decision.
export function validGradingPair(grading, acceptedGraders, answerDigestSha256) {
  if (grading?.version !== 2 || !Array.isArray(grading.graders)
    || grading.graders.length !== 2 || !grading.sourceCollectionRunId
    || !hash(grading.sourceCollectionSha256)) return false;
  const pair = acceptedGraderPair(grading.graders.map(row => ({id:row.id,judge:row.judge})),answerDigestSha256);
  if (!pair) return false;
  return grading.graders.every(row => {
    const accepted = acceptedGraders?.find(g => g.id === row.id);
    return accepted && row.payloadSha256 === accepted.payloadSha256
      && row.judge?.digestSha256 === accepted.judge?.digestSha256
      && row.judge?.providerVersion === accepted.judge?.providerVersion
      && hash(row.reviewSha256);
  });
}

// Read-side proof that a COMPLETE row is backed by two immutable review rows,
// not merely by two IDs copied into metadata. Missing migration/data closes the
// path; it never silently falls back to one grader.
export function validStoredGradingPair(db, grading, acceptedGraders, answerDigestSha256,
  role, contractSha256, score) {
  if (!validGradingPair(grading,acceptedGraders,answerDigestSha256)) return false;
  try {
    const source = db.prepare('SELECT * FROM model_evaluation_runs WHERE run_id=?')
      .get(grading.sourceCollectionRunId);
    const sourceMeta = JSON.parse(source?.metadata_json || '{}');
    if (source?.status !== 'BLOCKED' || source.role !== role
      || source.model_digest_sha256 !== answerDigestSha256
      || sourceMeta.collection?.status !== 'AWAITING_REVIEW'
      || source.score !== null) return false;
    const canonical = value => JSON.stringify(value, (_key,item) => item && typeof item === 'object'
      && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key,item[key]])) : item);
    const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
    return grading.graders.every(entry => {
      const row = db.prepare('SELECT * FROM model_evaluation_grader_reviews WHERE review_id=?').get(entry.reviewId);
      if (!row || row.source_run_id !== grading.sourceCollectionRunId
        || row.source_sha256 !== grading.sourceCollectionSha256
        || row.role !== role || row.contract_sha256 !== contractSha256
        || row.grader_acceptance_id !== entry.id
        || row.grader_acceptance_sha256 !== entry.payloadSha256
        || row.summary_sha256 !== entry.reviewSha256) return false;
      const summary = JSON.parse(row.summary_json);
      return digest(summary) === row.summary_sha256 && summary.score === score
        && summary.grading?.graderAcceptanceId === entry.id
        && summary.grading?.graderAcceptanceSha256 === entry.payloadSha256
        && summary.grading?.sourceCollectionSha256 === grading.sourceCollectionSha256;
    });
  } catch { return false; }
}
