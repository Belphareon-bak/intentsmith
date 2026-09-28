import { createHash } from 'node:crypto';

import {
  M2_EXECUTION_TERMINAL_STATUS,
  computeM2ExecutionValueDigest,
  validateM2ProjectChangeResult,
} from '../../contracts/m2/execution-v1.js';
import {
  LEARNING_ADAPTATION_KIND,
  LEARNING_DECAY_KIND,
  LEARNING_EVIDENCE_KIND,
  LEARNING_OBSERVATION_KIND,
  canonicalizeLearningValue,
  createLearningEvidenceV1,
  createLearningObservationV1,
  createLearningProposalV1,
} from '../../contracts/m4/learning-v1.js';

export const M4_LEARNING_PATTERN_PRODUCER = 'code-intel.approved-change-pattern.v1';

const DAY_MS = 86_400_000;
const MIN_REPETITIONS = 2;
const MAX_PROPOSAL_SOURCES = 8;
const DEFAULT_TTL_MS = 180 * DAY_MS;
const DEFAULT_HALF_LIFE_MS = 60 * DAY_MS;
const DEFAULT_FLOOR_CONFIDENCE_BPS = 5000;
const KEY_PATTERN = /^[a-z][a-z0-9._-]{0,127}$/;

export class LearningPatternProducerError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'LearningPatternProducerError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new LearningPatternProducerError(code, message, details);
}

function requireRepository(repository) {
  const methods = [
    'recordObservation',
    'recordProposal',
    'exportProjectLearning',
    'getLearningSettlement',
  ];
  if (!repository || methods.some(method => typeof repository[method] !== 'function')) {
    fail('LEARNING_PATTERN_REPOSITORY_REQUIRED', 'Learning authority repository is required');
  }
  return repository;
}

function exactCandidate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('LEARNING_PATTERN_CANDIDATE_INVALID', 'Pattern candidate must be an object');
  }
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'confidenceBps,key,statement,title') {
    fail('LEARNING_PATTERN_CANDIDATE_INVALID', 'Pattern candidate has an invalid field set');
  }
  if (typeof value.key !== 'string' || !KEY_PATTERN.test(value.key)) {
    fail('LEARNING_PATTERN_CANDIDATE_INVALID', 'Pattern key is invalid');
  }
  for (const field of ['title', 'statement']) {
    if (typeof value[field] !== 'string' || value[field].trim() === '' || value[field].length > 4096) {
      fail('LEARNING_PATTERN_CANDIDATE_INVALID', `Pattern ${field} is invalid`);
    }
  }
  if (
    !Number.isSafeInteger(value.confidenceBps)
    || value.confidenceBps < 0
    || value.confidenceBps > 10_000
  ) fail('LEARNING_PATTERN_CANDIDATE_INVALID', 'Pattern confidenceBps is invalid');
  return structuredClone(value);
}

function analysisDigest(candidate) {
  return `sha256:${createHash('sha256')
    .update(canonicalizeLearningValue(candidate), 'utf8')
    .digest('hex')}`;
}

function dominantText(observations, field) {
  const counts = new Map();
  for (const observation of observations) {
    const value = observation.subject[field];
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || Buffer.compare(
      Buffer.from(left[0], 'utf8'),
      Buffer.from(right[0], 'utf8'),
    ))[0][0];
}

function distinctApprovedSources(observations) {
  const sourceIds = new Set();
  for (const observation of observations) {
    const resultEvidence = observation.evidence.find(
      evidence => evidence.kind === LEARNING_EVIDENCE_KIND.PROJECT_CHANGE_RESULT,
    );
    if (!resultEvidence || sourceIds.has(resultEvidence.sourceId)) return false;
    sourceIds.add(resultEvidence.sourceId);
  }
  return true;
}

export function createLearningPatternProducer(repositoryValue) {
  const repository = requireRepository(repositoryValue);

  return Object.freeze({
    recordApprovedChangePattern({ result, candidate: candidateValue }) {
      const resultValidation = validateM2ProjectChangeResult(result);
      if (!resultValidation.valid) {
        fail(
          'LEARNING_PATTERN_RESULT_INVALID',
          'ProjectChangeResult is invalid',
          { errors: [...resultValidation.errors] },
        );
      }
      if (result.terminalStatus !== M2_EXECUTION_TERMINAL_STATUS.SUCCEEDED) {
        fail(
          'LEARNING_PATTERN_RESULT_NOT_APPROVED_SUCCESS',
          'Only a succeeded approved project change can produce an observation',
        );
      }
      const candidate = exactCandidate(candidateValue);
      const occurredAtMs = Date.parse(result.completedAt);
      const resultEvidence = createLearningEvidenceV1({
        kind: LEARNING_EVIDENCE_KIND.PROJECT_CHANGE_RESULT,
        sourceId: result.executionId,
        sourceVersion: result.version,
        digest: computeM2ExecutionValueDigest(result),
        workspaceRevision: result.changes.afterRevision,
        occurredAtMs,
      });
      const codeIntelEvidence = createLearningEvidenceV1({
        kind: LEARNING_EVIDENCE_KIND.CODE_INTELLIGENCE,
        sourceId: `pattern-analysis:${result.executionId}`,
        sourceVersion: 1,
        digest: analysisDigest(candidate),
        workspaceRevision: result.changes.afterRevision,
        occurredAtMs,
      });
      const observation = createLearningObservationV1({
        projectId: result.projectId,
        kind: LEARNING_OBSERVATION_KIND.PROJECT_PATTERN,
        producer: M4_LEARNING_PATTERN_PRODUCER,
        confidenceBps: candidate.confidenceBps,
        observedAtMs: occurredAtMs,
        subject: {
          key: candidate.key,
          title: candidate.title,
          statement: candidate.statement,
        },
        evidence: [resultEvidence, codeIntelEvidence],
      });
      return repository.recordObservation(observation);
    },

    proposeRepeatedProjectPatterns(projectId) {
      if (!Number.isSafeInteger(projectId) || projectId < 1) {
        fail('LEARNING_PATTERN_PROJECT_INVALID', 'projectId must be a positive integer');
      }
      const exported = repository.exportProjectLearning(projectId);
      const groups = new Map();
      for (const observation of exported.observations) {
        if (observation.producer !== M4_LEARNING_PATTERN_PRODUCER) continue;
        const entries = groups.get(observation.subject.key) ?? [];
        entries.push(observation);
        groups.set(observation.subject.key, entries);
      }

      const proposals = [];
      for (const key of [...groups.keys()].sort()) {
        const existingForKey = exported.proposals.filter(
          existing => existing.adaptation.key === key,
        );
        if (existingForKey.some(existing => {
          const settlement = repository.getLearningSettlement(existing.proposalId);
          return settlement?.state === 'pending' || settlement?.state === 'active';
        })) continue;

        const selected = groups.get(key)
          .sort((left, right) => (
            right.observedAtMs - left.observedAtMs
            || Buffer.compare(Buffer.from(left.observationId), Buffer.from(right.observationId))
          ))
          .slice(0, MAX_PROPOSAL_SOURCES);
        if (selected.length < MIN_REPETITIONS || !distinctApprovedSources(selected)) continue;

        const confidenceBps = Math.floor(
          selected.reduce((total, observation) => total + observation.confidenceBps, 0)
          / selected.length,
        );
        const title = dominantText(selected, 'title');
        const statement = dominantText(selected, 'statement');
        const proposal = createLearningProposalV1({
          projectId,
          observationIds: selected.map(observation => observation.observationId),
          title: `Adopt project pattern: ${title}`,
          rationale: `${selected.length} distinct approved project changes support the same pattern.`,
          confidenceBps,
          createdAtMs: Math.max(...selected.map(observation => observation.observedAtMs)) + 1,
          adaptation: {
            kind: LEARNING_ADAPTATION_KIND.PROJECT_CONTEXT_PATTERN,
            key,
            value: { statement },
            target: 'project_context',
            changesPermissions: false,
            changesCode: false,
            changesConfig: false,
          },
          gate: { kind: 'user', status: 'pending' },
          retention: {
            ttlMs: DEFAULT_TTL_MS,
            decay: {
              kind: LEARNING_DECAY_KIND.EXPONENTIAL_HALF_LIFE,
              halfLifeMs: DEFAULT_HALF_LIFE_MS,
              floorConfidenceBps: DEFAULT_FLOOR_CONFIDENCE_BPS,
            },
          },
        });
        if (existingForKey.some(existing => existing.proposalId === proposal.proposalId)) continue;
        proposals.push(repository.recordProposal(proposal));
      }
      return Object.freeze(proposals);
    },
  });
}
