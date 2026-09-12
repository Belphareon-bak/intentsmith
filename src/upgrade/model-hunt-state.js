// Catalog fingerprints schedule work; only response-bound full digests prove models.
import { createHash, randomUUID } from 'node:crypto';
import { canonicalModelName } from './model-identity.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function huntCandidateIdentity(candidate) {
  const name = canonicalModelName(candidate.name);
  const revision = candidate.artifact?.digestSha256 || candidate.catalogDigest || null;
  if (!name || !revision || !/^[a-f0-9]{12,64}$/.test(revision)) return null;
  return { key: hash([name, revision]), name, revision };
}

export class ModelHuntState {
  constructor(db) { this.db = db; }

  // The first complete discovery snapshot establishes the historical backlog.
  // Later catalog revisions are incremental, even when the tag name is reused.
  observe(candidates, { initialize = false, now = new Date().toISOString() } = {}) {
    return this.db.transaction(() => {
      const started = this.db.prepare('SELECT started_at FROM model_hunt_bootstrap WHERE singleton = 1').get();
      if (!started && !initialize) throw new Error('HUNT_BOOTSTRAP_REQUIRED: run --bootstrap once before scheduling');
      const cohort = started ? 'INCREMENTAL' : 'BOOTSTRAP';
      if (!started) this.db.prepare('INSERT INTO model_hunt_bootstrap VALUES (1, ?)').run(now);
      return candidates.map(candidate => {
        const id = huntCandidateIdentity(candidate);
        if (!id) return { ...candidate, hunt: { schedulable: false, reason: 'CATALOG_REVISION_UNKNOWN' } };
        // Materializing an already observed catalog revision on disk is not
        // a newly discovered model. Keep full local identity, but inherit the
        // catalog cohort; the short fingerprint never becomes quality proof.
        const lineage = id.revision.length === 64
          ? this.db.prepare(`SELECT cohort, first_seen_at FROM model_hunt_catalog
              WHERE model_name = ? AND revision = ?`).get(id.name, id.revision.slice(0, 12))
          : null;
        this.db.prepare(`INSERT INTO model_hunt_catalog
          (candidate_key, model_name, revision, first_seen_at, cohort, candidate_json)
          SELECT ?, ?, ?, ?, ?, ? WHERE NOT EXISTS
            (SELECT 1 FROM model_hunt_catalog WHERE candidate_key = ?)`)
          .run(id.key, id.name, id.revision, lineage?.first_seen_at || now,
            lineage?.cohort || cohort, JSON.stringify(candidate), id.key);
        const row = this.db.prepare('SELECT cohort, first_seen_at FROM model_hunt_catalog WHERE candidate_key = ?').get(id.key);
        return { ...candidate, hunt: { key: id.key, schedulable: true, cohort: row.cohort, firstSeenAt: row.first_seen_at } };
      });
    })();
  }

  evaluationKey(candidate, providerVersion, plans, hardware) {
    return hash([providerVersion, hardware, [...candidate.roles].sort().map(role => [role, plans[role]?.suiteContractSha256])]);
  }

  pending(candidate, evaluationKey, now = Date.now()) {
    if (!candidate.hunt?.schedulable) return false;
    const row = this.db.prepare(`SELECT outcome, completed_at FROM model_hunt_attempts
      WHERE candidate_key = ? AND evaluation_key = ? ORDER BY completed_at DESC, attempt_id DESC LIMIT 1`)
      .get(candidate.hunt.key, evaluationKey);
    return !row || (row.outcome === 'RETRYABLE' && now - Date.parse(row.completed_at) >= 24 * 3600_000);
  }

  record(candidate, evaluationKey, result, now = new Date().toISOString()) {
    if (!candidate.hunt?.key) return;
    const cpuSpill = result.stage === 'measure' && result.measurement?.placement?.loaded === true
      && result.measurement?.fits === false;
    const floorFailure = result.stage === 'floor' && result.floor?.passed === false
      && !result.floor.failures.some(failure => failure.retryable);
    const completed = !result.error && !result.roleErrors?.length
      && result.trials?.some(trial => !trial.skipped)
      && result.trials.filter(trial => !trial.skipped).every(trial => trial.comparison?.candidateRunId);
    const outcome = completed ? 'COMPLETE' : (cpuSpill || floorFailure ? 'BLOCKED' : 'RETRYABLE');
    this.db.prepare(`INSERT INTO model_hunt_attempts
      (attempt_id, candidate_key, evaluation_key, outcome, completed_at, result_json)
      VALUES (?, ?, ?, ?, ?, ?)`).run(`hunt_${randomUUID()}`, candidate.hunt.key, evaluationKey, outcome, now, JSON.stringify(result));
  }

  summary() {
    return this.db.prepare(`SELECT cohort, count(*) AS observed FROM model_hunt_catalog GROUP BY cohort`).all();
  }

  recordRetention(candidate, key, retention, now = new Date().toISOString()) {
    if (!key.startsWith('retention:') || !['APPROVED', 'DELETED', 'DELETE_FAILED'].includes(retention.status)) {
      throw new Error('HUNT_RETENTION_RECORD_INVALID');
    }
    const [observed] = this.observe([candidate]);
    if (!observed.hunt?.key) throw new Error('HUNT_RETENTION_IDENTITY_MISSING');
    this.db.prepare(`INSERT INTO model_hunt_attempts
      (attempt_id, candidate_key, evaluation_key, outcome, completed_at, result_json)
      VALUES (?, ?, ?, 'BLOCKED', ?, ?)`).run(`hunt_${randomUUID()}`, observed.hunt.key,
      key, now, JSON.stringify({ retention }));
  }

  isRejected(candidate, key) {
    const id = huntCandidateIdentity(candidate);
    if (!id || !key) return false;
    // A catalog fingerprint schedules work; a full installed digest must
    // match exactly. Do not mistake a changed local artifact for an old one.
    return Boolean(this.db.prepare(`SELECT 1 FROM model_hunt_attempts a
      JOIN model_hunt_catalog c ON c.candidate_key = a.candidate_key
      WHERE c.model_name = ? AND a.evaluation_key = ?
        AND (c.revision = ? OR (? = 12 AND substr(c.revision, 1, 12) = ?))
        AND json_extract(a.result_json, '$.retention.status') = 'APPROVED'
      LIMIT 1`).get(id.name, key, id.revision, id.revision.length, id.revision));
  }
}
