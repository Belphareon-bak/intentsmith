import { LearningAuthorityErrorCode } from './learning-authority-repository.js';

export const LEARNING_REVIEW_LIST_CONTRACT = 'LearningProposalReviewList';
export const LEARNING_REVIEW_CONTRACT = 'LearningProposalReview';
export const LEARNING_REVIEW_VERSION = 1;

export const LearningApplicationErrorCode = Object.freeze({
  AUTH_REQUIRED: 'M4_LEARNING_AUTH_REQUIRED',
  PROJECT_INVALID: 'M4_LEARNING_PROJECT_INVALID',
  PROJECT_NOT_FOUND: 'M4_LEARNING_PROJECT_NOT_FOUND',
  PROJECT_NOT_ACTIVE: 'M4_LEARNING_PROJECT_NOT_ACTIVE',
  PROPOSAL_PROJECT_MISMATCH: 'M4_LEARNING_PROPOSAL_PROJECT_MISMATCH',
});

export class LearningApplicationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LearningApplicationError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new LearningApplicationError(code, message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach(item => deepFreeze(item, seen));
  return Object.freeze(value);
}

function requireDependencies(repository, projects) {
  const repositoryMethods = [
    'expireDue',
    'getProposal',
    'getProposalObservations',
    'getLearningSettlement',
    'listProjectProposalSettlements',
    'approveProposal',
    'rejectProposal',
    'weakenLearning',
    'rollbackLearning',
    'deleteLearning',
  ];
  if (!isRecord(repository)
    || repositoryMethods.some(method => typeof repository[method] !== 'function')) {
    throw new TypeError('learning-application:complete-repository-required');
  }
  if (typeof projects?.findById?.get !== 'function') {
    throw new TypeError('learning-application:projects.findById.get-required');
  }
}

function requireAuthenticatedUser(subject) {
  if (
    !isRecord(subject)
    || subject.actorType !== 'user'
    || typeof subject.actorId !== 'string'
    || subject.actorId.trim() === ''
  ) fail(LearningApplicationErrorCode.AUTH_REQUIRED, 'An authenticated user subject is required.');
  return subject;
}

function requireProjectId(value) {
  const projectId = typeof value === 'string' && /^[1-9][0-9]*$/.test(value)
    ? Number(value)
    : value;
  if (!Number.isSafeInteger(projectId) || projectId < 1) {
    fail(LearningApplicationErrorCode.PROJECT_INVALID, 'projectId must be a positive integer.');
  }
  return projectId;
}

function reviewView(settlement, observations) {
  return deepFreeze({
    contract: LEARNING_REVIEW_CONTRACT,
    version: LEARNING_REVIEW_VERSION,
    projectId: settlement.proposal.projectId,
    proposal: settlement.proposal,
    observations,
    state: settlement.state,
    currentOutcome: settlement.currentOutcome,
  });
}

export class LearningApplicationService {
  constructor({ repository, projects } = {}) {
    requireDependencies(repository, projects);
    this.repository = repository;
    this.projects = projects;
  }

  #scope(authenticatedSubject, projectIdValue) {
    const subject = requireAuthenticatedUser(authenticatedSubject);
    const projectId = requireProjectId(projectIdValue);
    const project = this.projects.findById.get(projectId);
    if (!project || Number(project.id) !== projectId) {
      fail(LearningApplicationErrorCode.PROJECT_NOT_FOUND, 'Project does not exist.');
    }
    if (project.status !== 'active') {
      fail(LearningApplicationErrorCode.PROJECT_NOT_ACTIVE, 'Project is not active.');
    }
    return { subject, projectId };
  }

  #proposal(authenticatedSubject, projectIdValue, proposalId) {
    const scope = this.#scope(authenticatedSubject, projectIdValue);
    this.repository.expireDue(scope.projectId);
    const proposal = this.repository.getProposal(proposalId);
    if (!proposal) {
      const error = new LearningApplicationError(
        LearningAuthorityErrorCode.PROPOSAL_NOT_FOUND,
        'Learning proposal does not exist.',
      );
      throw error;
    }
    if (proposal.projectId !== scope.projectId) {
      fail(
        LearningApplicationErrorCode.PROPOSAL_PROJECT_MISMATCH,
        'Learning proposal does not belong to the requested project.',
      );
    }
    return { ...scope, proposal };
  }

  #review(proposalId) {
    const settlement = this.repository.getLearningSettlement(proposalId);
    const observations = this.repository.getProposalObservations(proposalId);
    return reviewView(settlement, observations);
  }

  listProposalReviews({ authenticatedSubject, projectId, state = 'all', limit = 50 }) {
    const scope = this.#scope(authenticatedSubject, projectId);
    this.repository.expireDue(scope.projectId);
    const settlements = this.repository.listProjectProposalSettlements(
      scope.projectId,
      { state, limit },
    );
    return deepFreeze({
      contract: LEARNING_REVIEW_LIST_CONTRACT,
      version: LEARNING_REVIEW_VERSION,
      projectId: scope.projectId,
      stateFilter: state,
      reviews: settlements.map(settlement => reviewView(
        settlement,
        this.repository.getProposalObservations(settlement.proposal.proposalId),
      )),
    });
  }

  getProposalReview({ authenticatedSubject, projectId, proposalId }) {
    this.#proposal(authenticatedSubject, projectId, proposalId);
    return this.#review(proposalId);
  }

  approveProposal({ authenticatedSubject, projectId, proposalId, reason }) {
    const scope = this.#proposal(authenticatedSubject, projectId, proposalId);
    this.repository.approveProposal({
      proposalId,
      actorId: scope.subject.actorId,
      reason,
    });
    return this.#review(proposalId);
  }

  rejectProposal({ authenticatedSubject, projectId, proposalId, reason }) {
    const scope = this.#proposal(authenticatedSubject, projectId, proposalId);
    this.repository.rejectProposal({
      proposalId,
      actorId: scope.subject.actorId,
      reason,
    });
    return this.#review(proposalId);
  }

  weakenLearning({
    authenticatedSubject,
    projectId,
    proposalId,
    reason,
    confidenceBps,
    value,
  }) {
    const scope = this.#proposal(authenticatedSubject, projectId, proposalId);
    this.repository.weakenLearning({
      proposalId,
      actorId: scope.subject.actorId,
      reason,
      confidenceBps,
      value,
    });
    return this.#review(proposalId);
  }

  rollbackLearning({ authenticatedSubject, projectId, proposalId, reason }) {
    const scope = this.#proposal(authenticatedSubject, projectId, proposalId);
    this.repository.rollbackLearning({
      proposalId,
      actorId: scope.subject.actorId,
      reason,
    });
    return this.#review(proposalId);
  }

  deleteLearning({ authenticatedSubject, projectId, proposalId, reason }) {
    const scope = this.#proposal(authenticatedSubject, projectId, proposalId);
    this.repository.deleteLearning({
      proposalId,
      actorId: scope.subject.actorId,
      reason,
    });
    return this.#review(proposalId);
  }
}

export function createLearningApplicationService(dependencies) {
  return new LearningApplicationService(dependencies);
}
