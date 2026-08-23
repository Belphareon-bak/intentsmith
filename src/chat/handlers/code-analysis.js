// CODE_ANALYSIS is intentionally project-bound. This consumer may only use the
// versioned ProjectContext provider; the legacy global search/index/graph stack
// is outside the M2 containment boundary.

import { createHash } from 'node:crypto';
import { realpath as defaultRealpath } from 'node:fs/promises';

import {
  PROJECT_CONTEXT_CONTRACT_VERSION,
  PROJECT_CONTEXT_ERROR_CODE,
  PROJECT_CONTEXT_KIND,
  PROJECT_CONTEXT_OUTCOME,
} from '../../../contracts/m2/project-context-v1.js';
import { projectContextProvider as defaultProjectContextProvider } from '../../code-intel/project-context-provider.js';
import { logger } from '../../core/logger.js';
import {
  ChatMode,
  ResponseSpeaker,
  ResponseTag,
  TaggedResponse,
} from '../controller.js';

const PROJECT_CONTEXT_BUDGET = Object.freeze({
  maxFiles: 10,
  maxBytes: 60_000,
  maxTokens: 15_000,
});

function buildProjectInfo(context) {
  const parts = [];
  if (context.project?.name) parts.push(`**Project:** ${context.project.name}`);
  if (context.projectWorkingMemory?.scope) {
    parts.push(`**Scope:** ${context.projectWorkingMemory.scope}`);
  }
  if (context.projectWorkingMemory?.techStack) {
    const stack = context.projectWorkingMemory.techStack;
    parts.push(`**Tech Stack:** ${typeof stack === 'string' ? stack : JSON.stringify(stack)}`);
  }
  return parts.join('\n') || 'Registered project';
}

function tagged(content, projectContext, extraMetadata = {}) {
  return new TaggedResponse({
    content,
    tag: new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM,
      mode: ChatMode.PROJECT,
      confidence: projectContext.status === 'ok' ? 0.9 : 1,
      canExecute: false,
      metadata: {
        codeAnalysis: true,
        projectContext,
        ...extraMetadata,
      },
    }),
  });
}

function invalidScopeMetadata(projectId, reason) {
  return {
    boundary: 'ProjectContext',
    version: PROJECT_CONTEXT_CONTRACT_VERSION,
    phase: 'preflight',
    projectId: Number.isSafeInteger(projectId) ? projectId : null,
    status: 'error',
    error: {
      code: PROJECT_CONTEXT_ERROR_CODE.INVALID_SCOPE,
      message: reason,
    },
  };
}

function snapshotMetadata(snapshot) {
  if (snapshot.status !== 'ok') return snapshot;
  return {
    contract: snapshot.contract,
    version: snapshot.version,
    requestId: snapshot.requestId,
    projectId: snapshot.projectId,
    status: snapshot.status,
    outcome: snapshot.outcome,
    workspaceRevision: snapshot.workspaceRevision,
    snapshotDigest: snapshot.snapshotDigest,
    itemCount: snapshot.items.length,
    budget: snapshot.budget,
    truncation: snapshot.truncation,
  };
}

function buildRequestId(projectId, workspaceRevision, input) {
  const digest = createHash('sha256')
    .update(`${projectId}\0${workspaceRevision}\0${input}`, 'utf8')
    .digest('hex');
  return `code-context:${digest}`;
}

function formatSnapshotContext(snapshot) {
  return snapshot.items.map(item => [
    `### ${item.path}:${item.startLine}-${item.endLine}`,
    `content-digest: ${item.contentDigest}`,
    '~~~text',
    item.content,
    '~~~',
  ].join('\n')).join('\n\n');
}

function buildAnalysisPrompt(input, snapshot, context) {
  return [
    'Analyze the developer question using only the revision-bound project excerpts below.',
    'Do not claim access to files or revisions not present in the excerpts.',
    'Reference project-relative file paths and line spans when useful.',
    'Answer in the same language as the developer question.',
    '',
    buildProjectInfo(context),
    `Workspace revision: ${snapshot.workspaceRevision}`,
    `Snapshot digest: ${snapshot.snapshotDigest}`,
    '',
    '## Developer question',
    input,
    '',
    '## Project excerpts',
    formatSnapshotContext(snapshot),
  ].join('\n');
}

async function defaultSynthesize(prompt) {
  const creBridge = await import('../../llm/cre-bridge.js');
  return creBridge.classifyIntent(prompt, {
    systemPrompt: 'You are a senior software engineer performing evidence-bound code analysis.',
    rawMode: true,
  });
}

function responseText(value) {
  if (typeof value === 'string') return value;
  return value?.content || value?.raw || String(value);
}

function invokeSystemStep(context, name, detail, depth) {
  if (typeof context.onSystemStep !== 'function') return;
  try {
    context.onSystemStep(name, detail, depth);
  } catch {
    // Progress notification is observational and cannot change connector truth.
  }
}

/**
 * Handle CODE_ANALYSIS through ProjectContextQuery/Snapshot@1.
 *
 * The fourth argument is an explicit construction seam for executable tests.
 * Production callers omit it and therefore cannot replace authority through
 * request context.
 */
export async function handleCodeAnalysisDecision(
  input,
  _decision,
  context = {},
  dependencies = {},
) {
  const projectId = context.project?.id ?? context.projectId;
  const projectPath = context.project?.path ?? context.projectPath;
  if (!Number.isSafeInteger(projectId) || projectId < 1 || typeof projectPath !== 'string') {
    const metadata = invalidScopeMetadata(projectId, 'No active registered project is available.');
    return tagged('Nelze bezpečně analyzovat kód bez aktivního registrovaného projektu.', metadata);
  }

  const provider = dependencies.projectContextProvider ?? defaultProjectContextProvider;
  if (
    typeof provider?.observeWorkspaceRevision !== 'function'
    || typeof provider?.queryProjectContext !== 'function'
  ) {
    const metadata = {
      ...invalidScopeMetadata(projectId, 'The project context provider is not ready.'),
      error: {
        code: PROJECT_CONTEXT_ERROR_CODE.NOT_READY,
        message: 'The project context provider is not ready.',
      },
    };
    return tagged('Projektový kontext zatím není připraven.', metadata);
  }

  invokeSystemStep(context, 'code_analysis_start', input.substring(0, 80));
  const invocationContext = {
    ...(context.signal ? { signal: context.signal } : {}),
    ...(context.deadlineAt !== undefined ? { deadlineAt: context.deadlineAt } : {}),
  };
  const providerDependencies = dependencies.projectContextDependencies ?? {};

  try {
    let canonicalRoot;
    try {
      canonicalRoot = await (dependencies.realpath ?? defaultRealpath)(projectPath);
    } catch (cause) {
      const error = new Error('The registered project root is unavailable.', { cause });
      error.code = PROJECT_CONTEXT_ERROR_CODE.INVALID_SCOPE;
      throw error;
    }
    const observation = await provider.observeWorkspaceRevision(
      { projectId, canonicalRoot },
      invocationContext,
      providerDependencies,
    );
    const query = {
      contract: PROJECT_CONTEXT_KIND.QUERY,
      version: PROJECT_CONTEXT_CONTRACT_VERSION,
      requestId: buildRequestId(projectId, observation.workspaceRevision, input),
      projectId,
      canonicalRoot: observation.canonicalRoot,
      workspaceRevision: observation.workspaceRevision,
      queryText: input,
      ...PROJECT_CONTEXT_BUDGET,
    };

    invokeSystemStep(context, 'code_analysis_context', `Revision ${query.workspaceRevision}`, 2);
    const snapshot = await provider.queryProjectContext(
      query,
      invocationContext,
      providerDependencies,
    );
    const metadata = snapshotMetadata(snapshot);
    if (snapshot.status !== 'ok') {
      logger.warn('CodeAnalysis', 'Project context query did not succeed', {
        projectId,
        status: snapshot.status,
        code: snapshot.error?.code,
      });
      return tagged(
        `Projektový kontext se nepodařilo bezpečně načíst (${snapshot.error.code}).`,
        metadata,
      );
    }
    if (snapshot.outcome === PROJECT_CONTEXT_OUTCOME.EMPTY) {
      return tagged('V aktuální revizi projektu nebyla nalezena odpovídající část kódu.', metadata);
    }

    invokeSystemStep(
      context,
      'code_analysis_llm',
      `Synthesis from ${snapshot.items.length} revision-bound file(s)`,
      2,
    );
    const synthesize = dependencies.classifyIntent ?? defaultSynthesize;
    let llmResponse;
    try {
      llmResponse = await synthesize(buildAnalysisPrompt(input, snapshot, context), {
        snapshot,
        signal: context.signal,
        deadlineAt: context.deadlineAt,
      });
    } catch (error) {
      logger.error('CodeAnalysis', 'Revision-bound synthesis failed', { error: error.message });
      return tagged(
        'Projektový kontext byl načten, ale analýzu se nepodařilo dokončit.',
        metadata,
        {
          synthesis: {
            status: 'error',
            code: 'CODE_ANALYSIS_SYNTHESIS_FAILED',
          },
        },
      );
    }
    const files = snapshot.items.map(item => item.path);
    return tagged(
      `${responseText(llmResponse)}\n\n---\n*Analyzed ${files.length} file(s): ${files.join(', ')}*`,
      metadata,
    );
  } catch (error) {
    logger.error('CodeAnalysis', 'Project-bound analysis failed', { error: error.message });
    const recognizedCodes = new Set([
      PROJECT_CONTEXT_ERROR_CODE.CANCELLED,
      PROJECT_CONTEXT_ERROR_CODE.TIMEOUT,
      PROJECT_CONTEXT_ERROR_CODE.INVALID_SCOPE,
      PROJECT_CONTEXT_ERROR_CODE.NOT_READY,
    ]);
    const code = recognizedCodes.has(error?.code)
      ? error.code
      : PROJECT_CONTEXT_ERROR_CODE.INTERNAL;
    const status = code === PROJECT_CONTEXT_ERROR_CODE.CANCELLED
      ? 'cancelled'
      : code === PROJECT_CONTEXT_ERROR_CODE.TIMEOUT
        ? 'timeout'
        : 'error';
    return tagged('Projektovou analýzu se nepodařilo bezpečně dokončit.', {
      boundary: 'ProjectContext',
      version: PROJECT_CONTEXT_CONTRACT_VERSION,
      phase: 'preflight',
      projectId,
      status,
      error: {
        code,
        message: 'Project-bound code analysis failed.',
      },
    }, { synthesisFailed: true });
  }
}

export const _testInternals = Object.freeze({
  buildAnalysisPrompt,
  buildRequestId,
  formatSnapshotContext,
});

export default { handleCodeAnalysisDecision };
