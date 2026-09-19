// Durable reviews of evidence, not automatic approval of a passing test log.
// No default database, environment override, or mutable decisionReady switch.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DEFAULT_MODEL_EVALUATION_OPTIONS } from '../eval/model-evaluation-runner.js';
import { decideCodePilot } from '../eval/code-pilot-decision.js';

const roles = new Set(['D1','D2','CODE','R1','R2','CHAT','VISION']);
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object'
  && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key,item[key]])) : item);
export const acceptanceHash = value => createHash('sha256').update(canonical(value)).digest('hex');
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 2048;
const requireValue = (condition, label) => { if (!condition) throw new Error(`EVALUATION_ACCEPTANCE_INVALID:${label}`); };
const blocked = code => ({ ready:false, code, graderIds:[], qualifications:[] });

// Operational evidence also expires when the workflow or decision implementation
// changes, even if the short benchmark's contract is unchanged.
export function qualificationRuntimeSha256() {
  const sources = ['../executor/execution-loop.js','../executor/error-normalizer.js',
    '../patch/patch-parser.js','../patch/patch-applier.js','../patch/patch-validator.js',
    '../patch/patch-engine.js','../patch/scope-limiter.js','../eval/code-pilot-decision.js',
    './model-evaluation-acceptance.js','../../scripts/manual/c3-code-pilot.mjs',
    '../../scripts/manual/c3-code-pilot-fixtures.mjs','../../package-lock.json'];
  return acceptanceHash(Object.fromEntries(sources.map(path => [path,
    createHash('sha256').update(readFileSync(new URL(path,import.meta.url))).digest('hex')])));
}

function validateEnvelope(record) {
  requireValue(record?.schemaVersion === 1 && roles.has(record.role) && hash(record.contractSha256), 'identity');
  requireValue(['GRADER','OPERATIONAL','REVOKE'].includes(record.kind), 'kind');
  const review = record.review;
  requireValue(text(review?.reviewer) && text(review?.reference) && text(review?.reason)
    && Number.isFinite(Date.parse(review.reviewedAt)) && Date.parse(review.reviewedAt) <= Date.now()
    && review.decision === (record.kind === 'REVOKE' ? 'REVOKED' : 'ACCEPTED')
    && review.evidenceSha256 === acceptanceHash(record.evidence), 'review');
  if (record.kind === 'REVOKE') {
    requireValue(text(record.targetId) && record.evidence?.targetId === record.targetId, 'revocation');
    return;
  }
  const e = record.evidence;
  requireValue(e?.role === record.role && e.contractSha256 === record.contractSha256
    && hash(e.archiveSha256) && hash(e.runtimeSha256)
    && e.status === 'PASS' && Number.isFinite(Date.parse(e.completedAt))
    && Date.parse(e.completedAt) <= Date.parse(review.reviewedAt), 'evidence');
  if (record.kind === 'GRADER') {
    requireValue(Array.isArray(e.tasks) && e.tasks.length > 0
      && new Set(e.tasks.map(t => t.name)).size === e.tasks.length, 'grader tasks');
    for (const task of e.tasks) {
      // T4 needs a separately accepted evaluator/calibration path; a PASS flag
      // must never silently admit it through the deterministic T1–T3 importer.
      requireValue(text(task.name) && ['T1','T2','T3'].includes(task.tier), 'grader tier');
      requireValue(Number.isFinite(task.floor) && task.floor >= 0 && task.floor < 0.9, 'grader floor');
      for (const name of ['empty','prompt-echo','keyword-stuffing','negated-facts','confident-wrong','gold','alternative']) {
        const probe = task.probes?.[name];
        requireValue(Number.isFinite(probe?.score) && probe.score >= 0 && probe.score <= 1
          && hash(probe.responseSha256)
          && (['gold','alternative'].includes(name) ? probe.score >= 0.9 : probe.score <= task.floor), `probe ${name}`);
      }
    }
  } else {
    // The accepted pilot currently has a CODE decision engine only. Other
    // roles remain closed until their own §3/§8 implementation is accepted.
    requireValue(record.role === 'CODE', 'operational role unsupported');
    requireValue(text(e.graderAcceptanceId) && e.plan?.evaluationContractSha256 === record.contractSha256
      && e.plan.runtimeSha256 === e.runtimeSha256
      && e.plan.workflow === 'intentsmith' && e.plan.developmentOnly === false && e.plan.notAHoldout === false
      && e.holdout?.independent === true && e.holdout.usedForDevelopment === false
      && hash(e.holdout.manifestSha256) && e.plan.holdoutSha256 === e.holdout.manifestSha256, 'holdout');
    requireValue(text(e.hardware?.model) && Number.isFinite(e.hardware?.vramMb) && e.hardware.vramMb > 0
      && text(e.plan.profile?.providerVersion), 'operational profile');
    const decision = decideCodePilot(e.plan, e.attempts, e.qualifications);
    requireValue(decision.qualityInterval && !decision.invalidAttempts.length && !decision.missingAttempts.length
      && ['QUALITY_BENEFIT','SPEED_WITH_NONINFERIOR_QUALITY','CANDIDATE_QUALITY_LOSS','INSUFFICIENT_EVIDENCE'].includes(decision.reason), 'paired evidence');
    requireValue(e.attempts.every(a => Date.parse(a.startedAt) + a.durationMs <= Date.parse(e.completedAt)), 'attempt interval');
  }
}

export class ModelEvaluationAcceptanceStore {
  constructor(db) { this.db = db; }

  // Explicit reviewed input only; no inference runner calls this writer.
  record(record) {
    validateEnvelope(record);
    return this.db.transaction(() => {
      if (record.kind === 'OPERATIONAL') {
        const grader = this._rows(record.role, record.contractSha256).find(r => r.id === record.evidence.graderAcceptanceId);
        requireValue(grader?.kind === 'GRADER' && !grader.revoked
          && grader.evidence.runtimeSha256 === record.evidence.runtimeSha256, 'grader reference');
      }
      const payload = canonical(record), id = `accept_${randomUUID()}`;
      this.db.prepare(`INSERT INTO model_evaluation_acceptances
        (acceptance_id,role,contract_sha256,kind,target_id,payload_json,payload_sha256)
        VALUES (?,?,?,?,?,?,?)`).run(id, record.role, record.contractSha256, record.kind,
        record.targetId || null, payload, acceptanceHash(record));
      return { id, payloadSha256:acceptanceHash(record) };
    }).immediate();
  }

  _rows(role, contractSha256) {
    const rows = this.db.prepare(`SELECT * FROM model_evaluation_acceptances
      WHERE role=? AND contract_sha256=? ORDER BY rowid`).all(role,contractSha256);
    const decoded = rows.map(row => {
      const value = JSON.parse(row.payload_json);
      requireValue(acceptanceHash(value) === row.payload_sha256 && value.role === row.role
        && value.contractSha256 === row.contract_sha256 && value.kind === row.kind
        && (value.targetId || null) === row.target_id, 'stored integrity');
      validateEnvelope(value);
      return { ...value,id:row.acceptance_id,payloadSha256:row.payload_sha256,recordedAt:row.recorded_at };
    });
    const revoked = new Set(decoded.filter(r => r.kind === 'REVOKE').map(r => r.targetId));
    for (const r of decoded.filter(r => r.kind === 'REVOKE')) requireValue(decoded.some(x => x.id === r.targetId && x.kind !== 'REVOKE'), 'stored revocation');
    return decoded.map(row => ({ ...row, revoked:revoked.has(row.id) }));
  }

  resolve({ role, suiteContractSha256, taskNames, runtimeSha256 }) {
    if (!hash(runtimeSha256)) return blocked('EVALUATION_ACCEPTANCE_RUNTIME_UNVERIFIABLE');
    if (!this.db) return blocked('EVALUATION_ACCEPTANCE_DB_UNAVAILABLE');
    try {
      const rows = this._rows(role, suiteContractSha256);
      const current = rows.filter(r => !r.revoked && r.evidence?.runtimeSha256 === runtimeSha256);
      const names = [...taskNames].sort().join('\n');
      const graders = current.filter(r => r.kind === 'GRADER' && r.evidence.tasks.map(t => t.name).sort().join('\n') === names);
      const qualifications = current.filter(r => r.kind === 'OPERATIONAL' && graders.some(g => g.id === r.evidence.graderAcceptanceId))
        .map(r => ({ id:r.id, payloadSha256:r.payloadSha256, graderId:r.evidence.graderAcceptanceId,
          review:r.review, planSha256:r.evidence.plan.planSha256,
          profileSha256:acceptanceHash(r.evidence.plan.profile), profile:r.evidence.plan.profile,
          candidateDigestSha256:r.evidence.plan.candidate.digest,
          incumbentDigestSha256:r.evidence.plan.incumbent.digest,
          providerVersion:r.evidence.plan.profile.providerVersion, numCtx:r.evidence.plan.profile.numCtx,
          hardware:r.evidence.hardware,
          decision:decideCodePilot(r.evidence.plan,r.evidence.attempts,r.evidence.qualifications) }));
      return { ready:qualifications.length > 0,
        code:qualifications.length ? null : graders.length ? 'EVALUATION_OPERATIONAL_ACCEPTANCE_MISSING' : 'EVALUATION_GRADER_ACCEPTANCE_MISSING',
        graderIds:graders.map(r => r.id), qualifications };
    } catch { return blocked('EVALUATION_ACCEPTANCE_UNVERIFIABLE'); }
  }

  forRuns(plan, { candidateRunId, incumbentRunId }) {
    try {
      const acceptance = plan.acceptance;
      if (!acceptance?.ready) return null;
      const get = id => this.db.prepare('SELECT * FROM model_evaluation_runs WHERE run_id=?').get(id);
      const candidate = get(candidateRunId), incumbent = get(incumbentRunId);
      const matches = (run,q,digest) => {
        const metadata = JSON.parse(run?.metadata_json || '{}'), hardware = JSON.parse(run?.hardware_json || '{}');
        return run?.status === 'COMPLETE' && run.role === plan.role
          && run.suite_contract_sha256 === plan.suiteContractSha256
          && run.suite_name === plan.suiteName && run.suite_version === plan.suiteVersion
          && plan.suite.tests.every(t => [['num_ctx','numCtx'],['num_predict','numPredict'],['temperature','temperature'],['top_p','topP']]
            .every(([option,key]) => (t.options?.[option] ?? DEFAULT_MODEL_EVALUATION_OPTIONS[option]) === q.profile[key]))
          && run.model_digest_sha256 === digest && metadata.provider?.proof === 'RESPONSE_BOUND'
          && metadata.provider.version === q.providerVersion && hardware.model === q.hardware.model
          && hardware.vramMb === q.hardware.vramMb && hardware.numCtx === q.numCtx;
      };
      const matching = acceptance.qualifications.filter(q => matches(candidate,q,q.candidateDigestSha256)
        && matches(incumbent,q,q.incumbentDigestSha256));
      // Conflicting or multiple qualifications need explicit revocation of the
      // superseded review; ordering by newest would be an implicit override.
      return matching.length === 1 ? matching[0] : null;
    } catch { return null; }
  }
}

export function acceptedOperationalDecision(qualification) {
  const d = qualification?.decision;
  if (!d) return null;
  return { winner:d.verdict === 'ZMENIT' ? 'candidate' : d.verdict === 'PONECHAT' ? 'incumbent' : 'inconclusive',
    reasonCode:d.verdict === 'ZMENIT' ? 'CANDIDATE_QUALITY' : d.verdict === 'PONECHAT' ? 'INCUMBENT_QUALITY' : 'INSUFFICIENT_EVIDENCE',
    basis:'přijaté párové provozní měření', detail:d.reason,
    acceptanceId:qualification.id, acceptanceSha256:qualification.payloadSha256,
    operationalReason:d.reason, qualityInterval:d.qualityInterval };
}
