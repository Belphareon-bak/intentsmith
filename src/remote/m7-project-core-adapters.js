import { createHash } from 'node:crypto';
import { realpath as defaultRealpath } from 'node:fs/promises';

import {
  PROJECT_CONTEXT_CONTRACT_VERSION,
  PROJECT_CONTEXT_ERROR_CODE,
  PROJECT_CONTEXT_KIND,
  PROJECT_CONTEXT_TERMINAL_STATUS,
  isProjectContextProjectId,
  validateProjectContextSnapshot,
} from '../../contracts/m2/project-context-v1.js';
import { canonicalizeM2ExecutionValue } from '../../contracts/m2/execution-v1.js';
import {
  observeWorkspaceRevision as defaultObserveWorkspaceRevision,
  queryProjectContext as defaultQueryProjectContext,
} from '../code-intel/project-context-provider.js';
import {
  M7_CORE_CURSOR_ERROR,
  M7CoreCursorError,
  computeM7CoreCursorFilterDigest,
  createM7CoreCursorCodec,
} from './m7-core-cursor.js';

export const M7_PROJECT_CORE_ERROR = Object.freeze({
  ACCESS_DENIED: 'M7_PROJECT_ACCESS_DENIED',
  CURSOR_INVALID: 'M7_PROJECT_CURSOR_INVALID',
  CURSOR_STALE: 'M7_PROJECT_CURSOR_STALE',
  INPUT_INVALID: 'M7_PROJECT_INPUT_INVALID',
  READ_FAILED: 'M7_PROJECT_READ_FAILED',
  SCAN_LIMIT: 'M7_PROJECT_SCAN_LIMIT',
});

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const WORKSPACE_REVISION = /^wsr1:[0-9a-f]{64}$/u;
const MAX_DEFAULT_PROJECT_SCAN = 200;

class M7ProjectCoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'M7ProjectCoreError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new M7ProjectCoreError(code, message);
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function digestRevision(prefix, value) {
  return `rev:${prefix}:${createHash('sha256')
    .update(canonicalizeM2ExecutionValue(value), 'utf8')
    .digest('hex')}`;
}

function requireDatabase(value) {
  const db = value?.db ?? value;
  if (!db || typeof db.prepare !== 'function') {
    throw new TypeError('m7-project-core:sqlite-database-required');
  }
  return db;
}

function requireFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`m7-project-core:${label}-required`);
  return value;
}

function requireScanLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
    throw new TypeError('m7-project-core:max-project-scan-invalid');
  }
  return value;
}

function requireIdentityContext(value) {
  if (!value || !IDENTIFIER.test(value.deviceId || '') || !IDENTIFIER.test(value.subjectId || '')) {
    fail(M7_PROJECT_CORE_ERROR.INPUT_INVALID, 'm7-project-core:trusted-context-invalid');
  }
  return value;
}

function canonicalTimestamp(value) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(M7_PROJECT_CORE_ERROR.READ_FAILED, 'm7-project-core:timestamp-invalid');
  }
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/u.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const milliseconds = Date.parse(normalized);
  if (!Number.isFinite(milliseconds)) {
    fail(M7_PROJECT_CORE_ERROR.READ_FAILED, 'm7-project-core:timestamp-invalid');
  }
  return new Date(milliseconds).toISOString();
}

function projectStage(row) {
  const stage = row.lifecyclePhase === null || row.lifecyclePhase === undefined
    ? 'active'
    : String(row.lifecyclePhase).toLowerCase();
  if (!IDENTIFIER.test(stage)) {
    fail(M7_PROJECT_CORE_ERROR.READ_FAILED, 'm7-project-core:lifecycle-stage-invalid');
  }
  return stage;
}

function projectName(value) {
  if (typeof value !== 'string'
    || value.length === 0
    || Buffer.byteLength(value, 'utf8') > 512
    || value.normalize('NFC') !== value
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(M7_PROJECT_CORE_ERROR.READ_FAILED, 'm7-project-core:project-name-invalid');
  }
  return value;
}

function listError(requestId, code, message, retryable = false) {
  return deepFreeze({
    contract: 'ProjectPage',
    version: 1,
    requestId,
    status: 'error',
    error: { code, message, retryable },
  });
}

function contextError(request, code, message) {
  const result = {
    contract: PROJECT_CONTEXT_KIND.SNAPSHOT,
    version: PROJECT_CONTEXT_CONTRACT_VERSION,
    requestId: request.requestId,
    projectId: request.projectId,
    status: PROJECT_CONTEXT_TERMINAL_STATUS.ERROR,
    error: { code, message },
  };
  const validation = validateProjectContextSnapshot(result);
  if (!validation.valid) throw new TypeError(
    `m7-project-core:invalid-context-error:${validation.errors.join(',')}`,
  );
  return deepFreeze(result);
}

function mapListFailure(request, error) {
  if (error instanceof M7CoreCursorError) {
    return listError(
      request.requestId,
      error.code === M7_CORE_CURSOR_ERROR.STALE
        ? 'REMOTE_PROJECT_CURSOR_STALE'
        : 'REMOTE_PROJECT_CURSOR_INVALID',
      'The project cursor is invalid or no longer describes the current snapshot.',
    );
  }
  if (error instanceof M7ProjectCoreError && error.code === M7_PROJECT_CORE_ERROR.SCAN_LIMIT) {
    return listError(
      request.requestId,
      'REMOTE_PROJECT_SCAN_LIMIT',
      'The authorized project catalog exceeds the bounded remote projection.',
    );
  }
  return listError(
    request.requestId,
    'REMOTE_PROJECT_READ_FAILED',
    'The project catalog could not be read safely.',
    true,
  );
}

export function createM7ProjectCoreAdapters({
  authorizeProject,
  cursorKey,
  database,
  maxProjectScan = MAX_DEFAULT_PROJECT_SCAN,
  now = Date.now,
  observeWorkspaceRevision = defaultObserveWorkspaceRevision,
  queryProjectContext = defaultQueryProjectContext,
  realpath = defaultRealpath,
} = {}) {
  const db = requireDatabase(database);
  const authorize = requireFunction(authorizeProject, 'authorize-project');
  const observe = requireFunction(observeWorkspaceRevision, 'observe-workspace-revision');
  const query = requireFunction(queryProjectContext, 'query-project-context');
  const resolveRealpath = requireFunction(realpath, 'realpath');
  const clock = requireFunction(now, 'clock');
  const scanLimit = requireScanLimit(maxProjectScan);
  const cursorCodec = createM7CoreCursorCodec({ key: cursorKey });

  const listRows = db.prepare(`
    SELECT
      project.id,
      project.name,
      project.path,
      project.status,
      project.last_active AS lastActive,
      (
        SELECT lifecycle.phase
        FROM project_lifecycles lifecycle
        WHERE lifecycle.project_id = project.id
        ORDER BY lifecycle.updated_at DESC, lifecycle.id DESC
        LIMIT 1
      ) AS lifecyclePhase
    FROM projects project
    WHERE project.status = 'active'
    ORDER BY project.id ASC
    LIMIT ?
  `);
  const findProject = db.prepare(`
    SELECT id, name, path, status, last_active AS lastActive
    FROM projects WHERE id = ? AND status = 'active'
  `);
  const projectRegistry = Object.freeze({
    findById: Object.freeze({
      get(projectId) {
        return findProject.get(projectId);
      },
    }),
  });

  async function accessAllowed(context, projectId, operationId) {
    const decision = await authorize(deepFreeze({
      deviceId: context.deviceId,
      subjectId: context.subjectId,
      projectId,
      operationId,
    }));
    if (decision !== true && decision !== false) {
      fail(M7_PROJECT_CORE_ERROR.READ_FAILED, 'm7-project-core:access-decision-invalid');
    }
    return decision;
  }

  async function observeRow(row, context, operationId) {
    if (!isProjectContextProjectId(row.id)) {
      fail(M7_PROJECT_CORE_ERROR.READ_FAILED, 'm7-project-core:project-id-invalid');
    }
    if (!await accessAllowed(context, row.id, operationId)) return null;
    const canonicalRoot = await resolveRealpath(row.path);
    const observation = await observe(
      { projectId: row.id, canonicalRoot },
      Object.freeze({}),
      { projects: projectRegistry, realpath: resolveRealpath, now: clock },
    );
    const confirmation = await observe(
      { projectId: row.id, canonicalRoot },
      Object.freeze({}),
      { projects: projectRegistry, realpath: resolveRealpath, now: clock },
    );
    if (!WORKSPACE_REVISION.test(observation?.workspaceRevision || '')
      || observation.workspaceRevision !== confirmation?.workspaceRevision) {
      fail(M7_PROJECT_CORE_ERROR.READ_FAILED, 'm7-project-core:workspace-snapshot-unstable');
    }
    // A policy change while observation was in flight must suppress the item;
    // authorization before I/O alone would allow a revoked project to escape.
    if (!await accessAllowed(context, row.id, operationId)) return null;
    const stage = projectStage(row);
    const updatedAt = canonicalTimestamp(row.lastActive);
    const item = {
      projectId: row.id,
      name: projectName(row.name),
      lifecycleStage: stage,
      updatedAt,
      workspaceRevision: observation.workspaceRevision,
      revision: null,
    };
    item.revision = digestRevision('project', {
      projectId: item.projectId,
      name: item.name,
      lifecycleStage: item.lifecycleStage,
      updatedAt: item.updatedAt,
      workspaceRevision: item.workspaceRevision,
    });
    return deepFreeze(item);
  }

  async function buildProjectSnapshot(request, context) {
    const rows = listRows.all(scanLimit + 1);
    if (rows.length > scanLimit) fail(
      M7_PROJECT_CORE_ERROR.SCAN_LIMIT,
      'm7-project-core:project-scan-limit',
    );
    const items = [];
    for (const row of rows) {
      const item = await observeRow(row, context, 'project.list');
      if (item) items.push(item);
    }
    const rowsAfter = listRows.all(scanLimit + 1);
    if (canonicalizeM2ExecutionValue(rowsAfter) !== canonicalizeM2ExecutionValue(rows)) {
      fail(M7_PROJECT_CORE_ERROR.READ_FAILED, 'm7-project-core:catalog-snapshot-unstable');
    }
    const states = request.lifecycleStates ?? [];
    const filtered = states.length === 0
      ? items
      : items.filter(item => states.includes(item.lifecycleStage));
    const snapshotRevision = digestRevision('project-snapshot', {
      deviceId: context.deviceId,
      subjectId: context.subjectId,
      lifecycleStates: states,
      items: filtered,
    });
    return deepFreeze({ items: filtered, snapshotRevision });
  }

  async function listProjects(request, trustedContext) {
    try {
      const context = requireIdentityContext(trustedContext);
      const filterDigest = computeM7CoreCursorFilterDigest({
        lifecycleStates: request.lifecycleStates ?? [],
        limit: request.limit,
      });
      const snapshot = await buildProjectSnapshot(request, context);
      const cursor = request.cursor === undefined ? null : cursorCodec.decode(request.cursor, {
        capabilityId: 'projects',
        capabilityVersion: 2,
        operationId: 'project.list',
        deviceId: context.deviceId,
        subjectId: context.subjectId,
        filterDigest,
        snapshotRevision: snapshot.snapshotRevision,
      });
      const offset = cursor?.offset ?? 0;
      if (offset > snapshot.items.length) throw new M7CoreCursorError(
        M7_CORE_CURSOR_ERROR.INVALID,
        'm7-core-cursor:offset-out-of-range',
      );
      const items = snapshot.items.slice(offset, offset + request.limit);
      const nextOffset = offset + items.length;
      const end = nextOffset >= snapshot.items.length;
      return deepFreeze({
        contract: 'ProjectPage',
        version: 1,
        requestId: request.requestId,
        status: 'ok',
        items,
        end,
        nextCursor: end ? null : cursorCodec.encode({
          capabilityId: 'projects',
          capabilityVersion: 2,
          operationId: 'project.list',
          deviceId: context.deviceId,
          subjectId: context.subjectId,
          filterDigest,
          snapshotRevision: snapshot.snapshotRevision,
          offset: nextOffset,
        }),
        snapshotRevision: snapshot.snapshotRevision,
      });
    } catch (error) {
      return mapListFailure(request, error);
    }
  }

  async function queryRootlessProjectContext(request, trustedContext) {
    let context;
    try {
      context = requireIdentityContext(trustedContext);
      const row = findProject.get(request.projectId);
      if (!row || !await accessAllowed(context, request.projectId, 'project-context.query')) {
        return contextError(
          request,
          PROJECT_CONTEXT_ERROR_CODE.INVALID_SCOPE,
          'The requested project is not available.',
        );
      }
      const canonicalRoot = await resolveRealpath(row.path);
      const result = await query({
        contract: PROJECT_CONTEXT_KIND.QUERY,
        version: PROJECT_CONTEXT_CONTRACT_VERSION,
        requestId: request.requestId,
        projectId: request.projectId,
        canonicalRoot,
        workspaceRevision: request.workspaceRevision,
        queryText: request.queryText,
        maxFiles: request.maxFiles,
        maxBytes: request.maxBytes,
        maxTokens: request.maxTokens,
      }, Object.freeze({}), {
        projects: projectRegistry,
        realpath: resolveRealpath,
        now: clock,
      });
      const rowAfter = findProject.get(request.projectId);
      if (canonicalizeM2ExecutionValue(rowAfter) !== canonicalizeM2ExecutionValue(row)) {
        fail(M7_PROJECT_CORE_ERROR.READ_FAILED, 'm7-project-core:project-mapping-unstable');
      }
      if (!await accessAllowed(context, request.projectId, 'project-context.query')) {
        return contextError(
          request,
          PROJECT_CONTEXT_ERROR_CODE.INVALID_SCOPE,
          'The requested project is not available.',
        );
      }
      const validation = validateProjectContextSnapshot(result);
      if (!validation.valid) fail(
        M7_PROJECT_CORE_ERROR.READ_FAILED,
        'm7-project-core:context-result-invalid',
      );
      return deepFreeze(structuredClone(result));
    } catch {
      return contextError(
        request,
        PROJECT_CONTEXT_ERROR_CODE.INTERNAL,
        'Project context could not be produced safely.',
      );
    }
  }

  const handlers = deepFreeze({
    'project-context.query': queryRootlessProjectContext,
    'project.list': listProjects,
  });
  return Object.freeze({
    handlers,
    listProjects,
    queryProjectContext: queryRootlessProjectContext,
  });
}

export default createM7ProjectCoreAdapters;
