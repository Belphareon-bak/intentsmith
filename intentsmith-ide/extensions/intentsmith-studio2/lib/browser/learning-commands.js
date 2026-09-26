'use strict';

// Project-bound M4 commands use the same review contract as the classic Studio.
// Keep this independent of the renderer so every HTTP response is validated
// before it is presented as an approval result.
const COMMANDS = new Set(['/m4-learning', '/m4-learning-show', '/m4-learning-approve',
  '/m4-learning-reject', '/m4-learning-weaken', '/m4-learning-rollback', '/m4-learning-delete']);
const STATES = new Set(['pending', 'active', 'rejected', 'rolled_back', 'expired', 'deleted']);
const FILTERS = new Set(['all', 'pending', 'active', 'terminal']);
const PROPOSAL_ID = /^lpr1:[0-9a-f]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const REVISION = /^wsr1:[0-9a-f]{64}$/;

function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function invalid(message, code = 'M4_STUDIO_INVALID_RESPONSE') {
  return Object.assign(new Error(message), { code });
}
function display(value) { return value === null || value === undefined || value === '' ? '—' : String(value); }

function validateReview(view, projectId, proposalId = null) {
  if (!record(view) || view.contract !== 'LearningProposalReview' || view.version !== 1
    || view.projectId !== projectId || !record(view.proposal)
    || view.proposal.projectId !== projectId || !PROPOSAL_ID.test(view.proposal.proposalId)
    || proposalId && view.proposal.proposalId !== proposalId
    || !Array.isArray(view.proposal.observationIds) || view.proposal.observationIds.length < 2
    || !Array.isArray(view.observations)
    || view.observations.length !== view.proposal.observationIds.length || !STATES.has(view.state)) {
    throw invalid('Server vrátil neúplný nebo cizí M4 learning review.');
  }
  view.observations.forEach((observation, index) => {
    if (!record(observation) || observation.contract !== 'LearningObservation'
      || observation.projectId !== projectId
      || observation.observationId !== view.proposal.observationIds[index]
      || !Array.isArray(observation.evidence) || !observation.evidence.length) {
      throw invalid('M4 review nemá úplnou evidenci stejného projektu.', 'M4_STUDIO_INVALID_EVIDENCE');
    }
    for (const evidence of observation.evidence) {
      if (!record(evidence) || typeof evidence.evidenceId !== 'string'
        || !DIGEST.test(evidence.digest) || !REVISION.test(evidence.workspaceRevision)) {
        throw invalid('M4 review evidence nemá přesný digest a revizi.', 'M4_STUDIO_INVALID_EVIDENCE');
      }
    }
  });
  if (view.state === 'pending') {
    if (view.currentOutcome !== null) throw invalid('Čekající M4 návrh nesmí mít výsledek.');
  } else if (!record(view.currentOutcome) || view.currentOutcome.projectId !== projectId
    || view.currentOutcome.proposalId !== view.proposal.proposalId
    || (view.state === 'active'
      ? !['approved', 'measured', 'weakened'].includes(view.currentOutcome.status)
      : view.currentOutcome.status !== view.state)) {
    throw invalid('M4 review nemá přesný současný výsledek.');
  }
  return view;
}

function validateList(view, projectId, filter) {
  if (!record(view) || view.contract !== 'LearningProposalReviewList' || view.version !== 1
    || view.projectId !== projectId || view.stateFilter !== filter
    || !Array.isArray(view.reviews) || view.reviews.length > 100) {
    throw invalid('Server vrátil neúplný nebo cizí M4 learning seznam.');
  }
  view.reviews.forEach(review => validateReview(review, projectId));
  return view;
}

function renderReview(view, compact = false) {
  const proposal = view.proposal, adaptation = proposal.adaptation || {}, retention = proposal.retention || {};
  const lines = [compact ? 'M4 PROPOSAL' : 'M4 LEARNING REVIEW',
    'Proposal ID: ' + proposal.proposalId, 'Project ID: ' + view.projectId,
    'State: ' + view.state, 'Title: ' + display(proposal.title),
    'Rationale: ' + display(proposal.rationale),
    'Confidence: ' + display(proposal.confidenceBps) + '/10000',
    'Created at: ' + display(proposal.createdAtMs),
    'Pattern key: ' + display(adaptation.key),
    'Pattern value: ' + JSON.stringify(adaptation.value),
    'Target: ' + display(adaptation.target),
    'Changes permissions/code/config: ' + [adaptation.changesPermissions, adaptation.changesCode, adaptation.changesConfig].join('/'),
    'TTL ms: ' + display(retention.ttlMs),
    'Observation IDs: ' + JSON.stringify(proposal.observationIds), 'Exact evidence:'];
  for (const observation of view.observations) {
    lines.push('- observation ' + observation.observationId + ' | producer: ' + display(observation.producer)
      + ' | confidence: ' + display(observation.confidenceBps) + '/10000 | observedAt: ' + display(observation.observedAtMs));
    for (const evidence of observation.evidence) {
      lines.push('  evidence ' + evidence.evidenceId + ' | kind: ' + display(evidence.kind)
        + ' | source: ' + display(evidence.sourceId) + '@' + display(evidence.sourceVersion)
        + ' | digest: ' + evidence.digest + ' | workspaceRevision: ' + evidence.workspaceRevision);
    }
  }
  if (view.currentOutcome) {
    lines.push('Current outcome ID: ' + view.currentOutcome.outcomeId,
      'Current outcome actor: ' + display(view.currentOutcome.actor?.actorId),
      'Current outcome reason: ' + display(view.currentOutcome.reason));
    if (view.currentOutcome.learnedItem) lines.push('Learned item: '
      + view.currentOutcome.learnedItem.itemId + '@' + view.currentOutcome.learnedItem.itemVersion
      + ' | active: ' + view.currentOutcome.learnedItem.active
      + ' | expiresAt: ' + view.currentOutcome.learnedItem.expiresAtMs);
  }
  if (view.state === 'pending') lines.push('Explicit approval: /m4-learning-approve ' + proposal.proposalId
    + ' <reason>', 'Explicit rejection: /m4-learning-reject ' + proposal.proposalId
    + ' <reason>', 'Obecné „ano“ tento návrh nikdy neschválí.');
  else if (view.state === 'active') lines.push('Weaken: /m4-learning-weaken ' + proposal.proposalId
    + ' {"confidenceBps":5000,"reason":"...","value":{...}}',
    'Rollback: /m4-learning-rollback ' + proposal.proposalId + ' <reason>',
    'Delete tombstone: /m4-learning-delete ' + proposal.proposalId + ' <reason>');
  else if (view.state !== 'deleted') lines.push('Delete tombstone: /m4-learning-delete ' + proposal.proposalId + ' <reason>');
  return lines.join('\n');
}

function renderList(view) {
  const lines = ['M4 LEARNING PROPOSALS', 'Project ID: ' + view.projectId,
    'Filter: ' + view.stateFilter, 'Count: ' + view.reviews.length];
  if (!view.reviews.length) lines.push('Žádné návrhy v tomto stavu.');
  view.reviews.forEach((review, index) => lines.push('', '[' + (index + 1) + '/' + view.reviews.length + ']', renderReview(review, true)));
  return lines.join('\n');
}

function parseCommand(text, projectId) {
  const match = /^([^\s]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match || !COMMANDS.has(match[1])) return null;
  if (!Number.isSafeInteger(projectId) || projectId < 1) throw invalid('M4 learning vyžaduje aktivní projekt s číselným ID.', 'M4_STUDIO_PROJECT_REQUIRED');
  const [, command, argument = ''] = match;
  const base = '/api/projects/' + encodeURIComponent(projectId) + '/learning/proposals';
  if (command === '/m4-learning') {
    const filter = argument || 'pending';
    if (!FILTERS.has(filter)) throw invalid('Použití: /m4-learning [all|pending|active|terminal]', 'M4_STUDIO_ARGUMENT_INVALID');
    return { command, path: base + '?state=' + encodeURIComponent(filter) + '&limit=50', method: 'GET', filter };
  }
  if (command === '/m4-learning-show') {
    if (!PROPOSAL_ID.test(argument)) throw invalid('Použití: /m4-learning-show <proposalId>', 'M4_STUDIO_ARGUMENT_INVALID');
    return { command, path: base + '/' + encodeURIComponent(argument), method: 'GET', proposalId: argument };
  }
  const parsed = /^(lpr1:[0-9a-f]{64})\s+([\s\S]+)$/.exec(argument);
  if (!parsed) throw invalid('Použití: ' + command + ' <proposalId> <reason|JSON>', 'M4_STUDIO_ARGUMENT_INVALID');
  const proposalId = parsed[1], action = command.slice('/m4-learning-'.length);
  let body;
  if (action === 'weaken') {
    try { body = JSON.parse(parsed[2]); } catch { throw invalid('Weaken vyžaduje validní JSON.', 'M4_STUDIO_JSON_INVALID'); }
    if (!record(body) || Object.keys(body).sort().join(',') !== 'confidenceBps,reason,value'
      || !Number.isSafeInteger(body.confidenceBps) || body.confidenceBps < 0 || body.confidenceBps > 10000
      || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 4096) {
      throw invalid('Weaken JSON musí mít přesně confidenceBps, reason a value.', 'M4_STUDIO_ARGUMENT_INVALID');
    }
    body = { confidenceBps: body.confidenceBps, reason: body.reason.trim(), value: body.value };
  } else {
    const reason = parsed[2].trim();
    if (!reason || reason.length > 4096) throw invalid('Důvod musí mít 1 až 4096 znaků.', 'M4_STUDIO_ARGUMENT_INVALID');
    body = { reason };
  }
  return { command, path: base + '/' + encodeURIComponent(proposalId) + (action === 'delete' ? '' : '/' + action),
    method: action === 'delete' ? 'DELETE' : 'POST', body, proposalId };
}

async function runCommand({ text, projectId, backendUrl, fetchImpl, assertContext }) {
  const command = parseCommand(text, projectId);
  if (!command) return null;
  const base = backendUrl();
  if (typeof base !== 'string' || !/^https?:\/\//.test(base)) throw invalid('Backend není dostupný.', 'M4_STUDIO_BACKEND_UNAVAILABLE');
  const options = { method: command.method, credentials: 'same-origin', signal: AbortSignal.timeout(120_000) };
  if (command.body) { options.headers = { 'Content-Type': 'application/json' }; options.body = JSON.stringify(command.body); }
  const response = await fetchImpl(base + command.path, options);
  let view = {};
  try { view = await response.json(); } catch { /* HTTP status remains authoritative. */ }
  if (!response.ok) throw Object.assign(new Error(typeof view.error === 'string' ? view.error : 'M4 learning HTTP ' + response.status),
    { code: typeof view.code === 'string' ? view.code : 'HTTP_' + response.status, status: response.status });
  assertContext();
  return command.command === '/m4-learning'
    ? renderList(validateList(view, projectId, command.filter))
    : renderReview(validateReview(view, projectId, command.proposalId));
}

module.exports = { COMMANDS, parseCommand, validateReview, validateList, renderReview, runCommand };
