#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import {
  M2_REMOTE_CORE_PORT_KIND,
  M2_REMOTE_CORE_PORT_VERSION,
} from '../contracts/m2/remote-core-port-v1.js';
import { computeProjectContextSnapshotDigest } from '../contracts/m2/project-context-v1.js';
import {
  EXTENSION_HOST_CAPABILITY,
  canonicalizeExtensionManifestV1,
  createExtensionContextV1,
} from '../contracts/m3/extension-v1.js';
import { M5_REMOTE_CORE_OPERATION } from '../contracts/m5/remote-core-adapter-v1.js';
import { AgentRepository, initAgentTables } from '../src/agents/repository.js';
import { AgentRunner, RUN_STATE } from '../src/agents/runner.js';
import { AgentScheduler } from '../src/agents/scheduler.js';
import { createLearningPatternProducer } from '../src/code-intel/learning-pattern-producer.js';
import { projectContextProvider } from '../src/code-intel/project-context-provider.js';
import { up as applyLearningAuthority } from '../src/db/migrations/2026_08_26_087_m4_learning_authority.js';
import { AgentExtensionService } from '../src/extensions/agent-extension-service.js';
import { createAgentProjectContextBridge } from '../src/extensions/agent-project-context.js';
import { createSpecialistProjectContextBridge } from '../src/extensions/specialist-project-context.js';
import { SpecialistRuntime } from '../src/expertises/specialist-runtime.js';
import { createLearningApplicationService } from '../src/memory/learning-application-service.js';
import { LearningAuthorityRepository } from '../src/memory/learning-authority-repository.js';
import {
  M5_REMOTE_CORE_ADAPTER_ERROR,
  createM5RemoteCorePortAdapter,
} from '../src/remote/remote-core-port-adapter.js';
import * as codeReviewer from '../specialists/code-reviewer/index.js';
import { suite, summary, testAsync } from './harness.js';

const BASE_MS = Date.parse('2026-08-27T00:00:00.000Z');
const ACTOR = Object.freeze({ actorType: 'user', actorId: 'm6-operator' });
const quietLogger = Object.freeze({ info() {}, warn() {}, error() {} });

function projectChangeResult(index, projectId) {
  return {
    contract: 'ProjectChangeResult',
    version: 1,
    executionId: `m6-platform-execution-${index}`,
    requestDigest: `sha256:${'a'.repeat(64)}`,
    runId: `m6-platform-run-${index}`,
    projectId,
    terminalStatus: 'succeeded',
    fencingGeneration: 1,
    startedAt: new Date(BASE_MS + index * 1000 - 100).toISOString(),
    completedAt: new Date(BASE_MS + index * 1000).toISOString(),
    changes: {
      paths: ['src/auth.js'],
      beforeRevision: `wsr1:${'1'.repeat(64)}`,
      afterRevision: `wsr1:${index.toString(16).padStart(64, '0')}`,
      diffDigest: `sha256:${'b'.repeat(64)}`,
    },
    focusedTest: {
      effectId: `m6-platform-test-${index}`,
      terminalStatus: 'succeeded',
      exitCode: 0,
      signal: null,
      stdoutDigest: `sha256:${'c'.repeat(64)}`,
      stderrDigest: `sha256:${'d'.repeat(64)}`,
      outputTruncated: false,
    },
    git: {
      status: 'not_requested',
      beforeHead: '3'.repeat(40),
      afterHead: '3'.repeat(40),
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

function hello() {
  return {
    contract: M2_REMOTE_CORE_PORT_KIND.HELLO,
    version: M2_REMOTE_CORE_PORT_VERSION,
    requestId: 'm6-platform-remote-hello',
    clientId: 'm6-in-process-fixture',
    clientBuild: 'm6-candidate',
    supportedPortVersions: [1],
    capabilities: [{ capabilityId: 'projects', versions: [1] }],
    sentAt: new Date(BASE_MS).toISOString(),
  };
}

function invocation(port, request) {
  const requestHello = hello();
  return {
    hello: requestHello,
    negotiation: port.negotiate(requestHello),
    capabilityId: 'projects',
    capabilityVersion: 1,
    operationId: M5_REMOTE_CORE_OPERATION.PROJECT_CONTEXT_QUERY,
    request,
  };
}

suite('M6 shared-project specialist, agent, learning and RemoteCorePort journey');

await testAsync('one registered project preserves identity and provenance through all four governed consumers', async () => {
  const projectRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'intentsmith-m6-platform-')));
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  try {
    await writeFile(
      path.join(projectRoot, 'auth.js'),
      'export function validateSessionToken(input) { return eval(input); }\n',
    );
    database.exec(`
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
      )
    `);
    database.prepare(`
      INSERT INTO projects (id, name, path, status)
      VALUES (1, 'M6 platform', ?, 'active')
    `).run(projectRoot);
    const projects = { findById: database.prepare('SELECT * FROM projects WHERE id = ?') };
    initAgentTables(database);
    applyLearningAuthority(database);

    const ownedProvider = Object.freeze({
      observeWorkspaceRevision(scope, context = {}) {
        return projectContextProvider.observeWorkspaceRevision(scope, context, { projects });
      },
      queryProjectContext(query, context = {}) {
        return projectContextProvider.queryProjectContext(query, context, { projects });
      },
    });

    const specialistBridge = createSpecialistProjectContextBridge({ provider: ownedProvider });
    const specialistRuntime = new SpecialistRuntime();
    specialistRuntime.setProjectContextHost(specialistBridge.host);
    const specialistManifest = canonicalizeExtensionManifestV1(JSON.parse(await readFile(
      new URL('../specialists/code-reviewer/specialist.json', import.meta.url),
      'utf8',
    )), 'specialist');
    await codeReviewer.register(createExtensionContextV1({
      manifest: specialistManifest,
      hostCapabilities: {
        [EXTENSION_HOST_CAPABILITY.SPECIALIST_RUNTIME]: specialistRuntime,
        [EXTENSION_HOST_CAPABILITY.PROJECT_CONTEXT]: specialistBridge.capability,
      },
    }));
    const specialistResult = await specialistRuntime.tryToolExecution(
      'code_reviewer',
      'Proveď security audit validateSessionToken v tomto projektu',
      {
        sessionId: 'm6-conversation',
        conversationId: 'm6-conversation',
        userMessageId: 1,
        project: { id: 1, path: projectRoot },
      },
    );
    assert.equal(specialistResult.toolType, 'code-reviewer.security_scan');
    assert.equal(specialistResult.evidence.projectId, 1);
    assert.equal(specialistResult.result.data.vulnerabilities[0].severity, 'critical');
    const sharedRevision = specialistResult.evidence.workspaceRevision;
    assert.match(sharedRevision, /^wsr1:[0-9a-f]{64}$/);

    const agentRepository = new AgentRepository(database);
    const agentBridge = createAgentProjectContextBridge({ provider: ownedProvider, projects });
    const extensionService = new AgentExtensionService({
      repository: agentRepository,
      hostCapabilities: {
        [EXTENSION_HOST_CAPABILITY.PROJECT_CONTEXT]: agentBridge.capability,
      },
    });
    assert.deepEqual(extensionService.discover().map(item => item.id), ['project-health']);
    const agentRunner = new AgentRunner({
      repository: agentRepository,
      extensionService,
      projectContextBridge: agentBridge,
      logger: quietLogger,
    });
    const scheduler = new AgentScheduler({
      repository: agentRepository,
      runner: agentRunner,
      logger: quietLogger,
    });
    extensionService.attachScheduler(scheduler);
    extensionService.install('project-health', {
      instanceId: 'm6-project-health',
      params: { project_id: 1 },
      enabled: true,
    });
    const baseline = await extensionService.runInstance('m6-project-health');
    assert.equal(baseline.run_state, RUN_STATE.INIT_BASELINE);
    await writeFile(
      path.join(projectRoot, 'auth.js'),
      'export function validateSessionToken(input) {\n  // FIXME remove eval\n  return eval(input);\n}\n',
    );
    const changed = await extensionService.runInstance('m6-project-health');
    assert.equal(changed.run_state, RUN_STATE.SUCCESS_TRIGGERED);
    assert.deepEqual(changed.triggered, ['health_changed']);
    const notification = agentRepository.getNotifications({ agentId: 'm6-project-health' })[0];
    assert.equal(notification.data.projectId, '1');
    assert.match(notification.data.workspaceRevision, /^wsr1:[0-9a-f]{64}$/);
    assert.notEqual(notification.data.workspaceRevision, sharedRevision);

    let now = BASE_MS + 20_000;
    const learningRepository = new LearningAuthorityRepository(database, {
      clock: () => ++now,
    });
    const producer = createLearningPatternProducer(learningRepository);
    for (const index of [1, 2]) {
      producer.recordApprovedChangePattern({
        result: projectChangeResult(index, 1),
        candidate: {
          key: 'security.require-review',
          title: 'Require independent security review',
          statement: 'Require independent security review before merge.',
          confidenceBps: 8500,
        },
      });
    }
    const [proposal] = producer.proposeRepeatedProjectPatterns(1);
    const learningService = createLearningApplicationService({
      repository: learningRepository,
      projects,
    });
    assert.equal(learningService.listProposalReviews({
      authenticatedSubject: ACTOR,
      projectId: 1,
      state: 'pending',
    }).reviews.length, 1);
    const approved = learningService.approveProposal({
      authenticatedSubject: ACTOR,
      projectId: 1,
      proposalId: proposal.proposalId,
      reason: 'M6 exact same-project learning journey.',
    });
    assert.equal(approved.state, 'active');
    assert.equal(approved.currentOutcome.projectId, 1);
    assert.equal(approved.currentOutcome.learnedItem.itemVersion, 1);
    assert.equal(approved.proposal.adaptation.changesPermissions, false);
    assert.equal(approved.proposal.adaptation.changesCode, false);
    assert.equal(approved.proposal.adaptation.changesConfig, false);
    await assert.rejects(
      Promise.resolve().then(() => learningService.approveProposal({
        authenticatedSubject: { actorType: 'system', actorId: 'self-asserted' },
        projectId: 1,
        proposalId: proposal.proposalId,
        reason: 'forged',
      })),
      error => error.code === 'M4_LEARNING_AUTH_REQUIRED',
    );

    const observed = await ownedProvider.observeWorkspaceRevision({
      projectId: 1,
      canonicalRoot: projectRoot,
    });
    const query = {
      contract: 'ProjectContextQuery',
      version: 1,
      requestId: 'm6-platform-project-query',
      projectId: 1,
      canonicalRoot: projectRoot,
      workspaceRevision: observed.workspaceRevision,
      queryText: 'validateSessionToken FIXME',
      maxFiles: 8,
      maxBytes: 8192,
      maxTokens: 2048,
    };
    const remote = createM5RemoteCorePortAdapter({
      clock: () => BASE_MS + 1,
      queryProjectContext: request => ownedProvider.queryProjectContext(request),
    });
    const remoteResult = await remote.invoke(invocation(remote, query), {
      authenticatedSubject: ACTOR,
    });
    assert.equal(remoteResult.projectId, 1);
    assert.equal(remoteResult.workspaceRevision, observed.workspaceRevision);
    assert.equal(remoteResult.items[0].provenance.projectId, 1);
    assert.equal('listen' in remote, false);

    const forgedRemote = createM5RemoteCorePortAdapter({
      clock: () => BASE_MS + 1,
      queryProjectContext: async request => {
        const forged = structuredClone(await ownedProvider.queryProjectContext(request));
        forged.workspaceRevision = `wsr1:${'f'.repeat(64)}`;
        for (const item of forged.items) {
          item.provenance.workspaceRevision = forged.workspaceRevision;
        }
        forged.snapshotDigest = null;
        forged.snapshotDigest = computeProjectContextSnapshotDigest(forged);
        return forged;
      },
    });
    await assert.rejects(
      forgedRemote.invoke(invocation(forgedRemote, query)),
      error => error.code === M5_REMOTE_CORE_ADAPTER_ERROR.IDENTITY_MISMATCH,
    );
  } finally {
    database.close();
    await rm(projectRoot, { recursive: true, force: true });
  }
}, 60_000);

summary();
