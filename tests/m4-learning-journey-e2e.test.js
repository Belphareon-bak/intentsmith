import assert from 'node:assert/strict';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { isolatedTestRuntime } from './helpers/isolated-test-db.js';
import { suite, summary, testAsync } from './harness.js';

const BASE_MS = Date.parse('2026-08-26T12:00:00.000Z');
const BEFORE_REVISION = `wsr1:${'1'.repeat(64)}`;
const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
const HEAD = '3'.repeat(40);
const ACTOR = Object.freeze({ actorType: 'user', actorId: 'local-operator' });

function projectChangeResult(index, projectId) {
  const completedAt = new Date(BASE_MS + index * 1000).toISOString();
  return {
    contract: 'ProjectChangeResult',
    version: 1,
    executionId: `m4-e2e-execution-${index}`,
    requestDigest: DIGEST_A,
    runId: `m4-e2e-run-${index}`,
    projectId,
    terminalStatus: 'succeeded',
    fencingGeneration: 1,
    startedAt: new Date(BASE_MS + index * 1000 - 100).toISOString(),
    completedAt,
    changes: {
      paths: ['src/app.js'],
      beforeRevision: BEFORE_REVISION,
      afterRevision: `wsr1:${index.toString(16).padStart(64, '0')}`,
      diffDigest: DIGEST_B,
    },
    focusedTest: {
      effectId: `m4-e2e-test-${index}`,
      terminalStatus: 'succeeded',
      exitCode: 0,
      signal: null,
      stdoutDigest: DIGEST_A,
      stderrDigest: DIGEST_B,
      outputTruncated: false,
    },
    git: {
      status: 'not_requested',
      beforeHead: HEAD,
      afterHead: HEAD,
      commitId: null,
      foreignDirtPreserved: true,
    },
    rollback: {
      required: false,
      status: 'not_required',
      paths: [],
      evidenceRef: null,
    },
    errorCode: null,
    evidenceRefs: ['artifact:diff', 'artifact:focused-test'],
    lateCompletionRejected: false,
  };
}

function fakePlannerResponse(prompt) {
  const item = prompt.match(
    /^- ([a-z][a-z0-9._-]*) \[item=(lit1:[0-9a-f]{64})@(\d+);/m,
  );
  const learnedPatternConformance = item ? [{
    item_id: item[2],
    item_version: Number(item[3]),
    key: item[1],
    status: 'conformed',
    explanation: 'The plan requires the exact approved independent review convention.',
  }] : [];
  return {
    core_goal: 'Add a project endpoint safely.',
    implicit_assumptions: [],
    technical_decisions: [],
    clarifying_questions: ['Which endpoint should be added?'],
    learned_pattern_conformance: learnedPatternConformance,
    initial_assessment: {
      estimated_complexity: 'LOW',
      key_risks: [],
      suggested_tech_stack: ['Node.js'],
      tech_stack_rationale: 'The project already uses Node.js.',
    },
  };
}

suite('M4 governed learning exact local journey');

await testAsync(
  'approved evidence changes a measured plan, then rollback removes the influence',
  async () => {
    const dbModule = await import('../src/db/database.js');
    const { LearningAuthorityRepository } = await import(
      '../src/memory/learning-authority-repository.js'
    );
    const { createLearningPatternProducer } = await import(
      '../src/code-intel/learning-pattern-producer.js'
    );
    const { createLearningApplicationService } = await import(
      '../src/memory/learning-application-service.js'
    );
    const { buildProjectLearningContext } = await import(
      '../src/code-intel/project-learning-context.js'
    );
    const { projectContextProvider } = await import(
      '../src/code-intel/project-context-provider.js'
    );
    const { ProjectLifecycle } = await import('../src/planner/lifecycle.js');
    const { startSpec } = await import('../src/planner/lifecycle-spec.js');
    const {
      computeLearningItemId,
    } = await import('../contracts/m4/learning-v1.js');
    const {
      LEARNING_PLAN_CONFORMANCE_STATUS,
      computeLearningPlanResponseDigest,
      createLearningPlanEvaluationArtifactV1,
    } = await import('../contracts/m4/learning-plan-evaluation-v1.js');
    const { createLearningOutcomeEvaluator } = await import(
      '../src/memory/learning-outcome-evaluator.js'
    );

    let nowMs = Date.now() + 10_000;
    const tick = () => ++nowMs;
    const repository = new LearningAuthorityRepository(dbModule.db, { clock: tick });
    const producer = createLearningPatternProducer(repository);
    const service = createLearningApplicationService({
      repository,
      projects: dbModule.projects,
    });
    const evaluator = createLearningOutcomeEvaluator(repository);

    const projectPath = path.join(isolatedTestRuntime.projects, 'm4-e2e-project');
    const foreignPath = path.join(isolatedTestRuntime.projects, 'm4-e2e-foreign');
    mkdirSync(path.join(projectPath, 'src'), { recursive: true, mode: 0o700 });
    mkdirSync(foreignPath, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(projectPath, 'src', 'app.js'), 'export const ready = true;\n');
    const project = dbModule.projects.getOrCreate('M4 E2E', projectPath, 'Governed learning journey');
    const foreign = dbModule.projects.getOrCreate('M4 foreign', foreignPath, 'Isolation sentinel');
    const projectId = Number(project.id);

    for (const index of [1, 2]) {
      producer.recordApprovedChangePattern({
        result: projectChangeResult(index, projectId),
        candidate: {
          key: 'tests.require-review',
          title: 'Require review before merge',
          statement: 'Require independent review before merge.',
          confidenceBps: 8000,
        },
      });
    }
    const [proposal] = producer.proposeRepeatedProjectPatterns(projectId);
    assert(proposal);

    const pending = service.listProposalReviews({
      authenticatedSubject: ACTOR,
      projectId,
      state: 'pending',
    });
    assert.equal(pending.reviews.length, 1);
    assert.equal(pending.reviews[0].observations.length, 2);
    assert.equal(pending.reviews[0].state, 'pending');
    assert.equal(repository.exportProjectLearning(Number(foreign.id)).observations.length, 0);

    const prompts = [];
    const plannerResponses = [];
    let forcedPlannerResponse = null;
    const lifecycle = await ProjectLifecycle.create({
      id: 'm4-learning-e2e-lifecycle',
      projectId,
      projectPath,
      lifecycleConfig: { autoCommit: false },
      callLLM: async (_role, prompt) => {
        prompts.push(prompt);
        const value = forcedPlannerResponse ?? fakePlannerResponse(prompt);
        plannerResponses.push(value);
        return { content: JSON.stringify(value) };
      },
    });

    const baselinePlan = await startSpec(lifecycle, 'Add a project endpoint.', {});
    assert.equal(baselinePlan.learnedPatternConformance.length, 0);
    assert(!prompts[0].includes('## User-Approved Project Patterns'));
    const itemId = computeLearningItemId(proposal.proposalId);
    const baselineArtifact = createLearningPlanEvaluationArtifactV1({
      projectId,
      proposalId: proposal.proposalId,
      itemId,
      itemVersion: 1,
      learningContextDigest: null,
      generatedAtMs: tick(),
      responseDigest: computeLearningPlanResponseDigest(plannerResponses[0]),
      conformance: {
        key: proposal.adaptation.key,
        status: LEARNING_PLAN_CONFORMANCE_STATUS.ABSENT,
        explanation: 'No approved learning context was supplied to the baseline plan.',
      },
    });

    const approved = service.approveProposal({
      authenticatedSubject: ACTOR,
      projectId,
      proposalId: proposal.proposalId,
      reason: 'The two exact approved changes establish this project convention.',
    });
    assert.equal(approved.state, 'active');
    assert.equal(approved.currentOutcome.learnedItem.itemId, itemId);

    const canonicalRoot = realpathSync(projectPath);
    const observedRevision = await projectContextProvider.observeWorkspaceRevision(
      { projectId, canonicalRoot },
      {},
      { projects: dbModule.projects },
    );
    const learningContext = buildProjectLearningContext({
      repository,
      projectId,
      workspaceRevision: observedRevision.workspaceRevision,
      nowMs: tick(),
    });
    assert.equal(learningContext.items.length, 1);

    const observedPlan = await startSpec(lifecycle, 'Add a project endpoint.', {
      projectLearningContext: learningContext,
    });
    assert.equal(observedPlan.learnedPatternConformance.length, 1);
    assert(prompts[1].includes('## User-Approved Project Patterns'));
    assert(prompts[1].includes(itemId));
    assert(prompts[1].includes(learningContext.contextDigest));
    const [conformance] = observedPlan.learnedPatternConformance;
    assert.deepEqual(conformance, {
      item_id: itemId,
      item_version: 1,
      key: 'tests.require-review',
      status: 'conformed',
      explanation: 'The plan requires the exact approved independent review convention.',
    });
    const observedArtifact = createLearningPlanEvaluationArtifactV1({
      projectId,
      proposalId: proposal.proposalId,
      itemId: conformance.item_id,
      itemVersion: conformance.item_version,
      learningContextDigest: learningContext.contextDigest,
      generatedAtMs: tick(),
      responseDigest: computeLearningPlanResponseDigest(plannerResponses[1]),
      conformance: {
        key: conformance.key,
        status: conformance.status,
        explanation: conformance.explanation,
      },
    });
    const measured = evaluator.measurePlanConformance({
      proposalId: proposal.proposalId,
      baselineArtifact,
      observedArtifact,
      projectLearningContext: learningContext,
    });
    assert.deepEqual(measured.outcome.measurement, {
      metric: 'plan_conformance',
      baselineScoreBps: 0,
      observedScoreBps: 10000,
      deltaBps: 10000,
      sampleSize: 1,
      baselineArtifactId: baselineArtifact.artifactId,
      observedArtifactId: observedArtifact.artifactId,
    });

    forcedPlannerResponse = {
      ...fakePlannerResponse(prompts[1]),
      learned_pattern_conformance: [{
        ...conformance,
        item_id: `lit1:${'f'.repeat(64)}`,
      }],
    };
    await assert.rejects(
      () => startSpec(lifecycle, 'Add a project endpoint.', {
        projectLearningContext: learningContext,
      }),
      /learned-pattern-conformance-item-mismatch/,
    );
    forcedPlannerResponse = null;

    const rolledBack = service.rollbackLearning({
      authenticatedSubject: ACTOR,
      projectId,
      proposalId: proposal.proposalId,
      reason: 'Verify that the learned influence is fully reversible.',
    });
    assert.equal(rolledBack.state, 'rolled_back');
    const afterRollbackContext = buildProjectLearningContext({
      repository,
      projectId,
      workspaceRevision: observedRevision.workspaceRevision,
      nowMs: tick(),
    });
    assert.equal(afterRollbackContext.items.length, 0);
    const afterRollbackPlan = await startSpec(lifecycle, 'Add a project endpoint.', {
      projectLearningContext: afterRollbackContext,
    });
    assert.equal(afterRollbackPlan.learnedPatternConformance.length, 0);
    assert(!prompts[3].includes('## User-Approved Project Patterns'));

    const deleted = service.deleteLearning({
      authenticatedSubject: ACTOR,
      projectId,
      proposalId: proposal.proposalId,
      reason: 'Remove retained learning after the reversible journey proof.',
    });
    assert.equal(deleted.state, 'deleted');
    assert.equal(repository.getLearningSettlement(proposal.proposalId).state, 'deleted');
    assert.deepEqual(
      repository.getPlanEvaluationArtifact(baselineArtifact.artifactId),
      baselineArtifact,
    );
    assert.deepEqual(
      repository.getPlanEvaluationArtifact(observedArtifact.artifactId),
      observedArtifact,
    );
    assert.equal(repository.exportProjectLearning(Number(foreign.id)).outcomes.length, 0);

    dbModule.close();
  },
  60_000,
);

summary();
