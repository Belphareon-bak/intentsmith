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
        this.db.prepare(`INSERT INTO model_hunt_catalog
          (candidate_key, model_name, revision, first_seen_at, cohort, candidate_json)
          SELECT ?, ?, ?, ?, ?, ? WHERE NOT EXISTS
            (SELECT 1 FROM model_hunt_catalog WHERE candidate_key = ?)`)
          .run(id.key, id.name, id.revision, now, cohort, JSON.stringify(candidate), id.key);
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
    const completed = !result.error && result.trials?.some(trial => !trial.skipped)
      && result.trials.filter(trial => !trial.skipped).every(trial => trial.comparison?.candidateRunId);
    const outcome = completed ? 'COMPLETE' : (cpuSpill || floorFailure ? 'BLOCKED' : 'RETRYABLE');
    this.db.prepare(`INSERT INTO model_hunt_attempts
      (attempt_id, candidate_key, evaluation_key, outcome, completed_at, result_json)
      VALUES (?, ?, ?, ?, ?, ?)`).run(`hunt_${randomUUID()}`, candidate.hunt.key, evaluationKey, outcome, now, JSON.stringify(result));
  }

  summary() {
    return this.db.prepare(`SELECT cohort, count(*) AS observed FROM model_hunt_catalog GROUP BY cohort`).all();
  }
}
