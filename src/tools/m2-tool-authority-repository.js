import { registerM2FileListOutputFunctions, readM2FileListOutput } from '../effects/effect-file-list-output-repository.js';
import { registerM2FileReadOutputFunctions, readM2FileReadOutput } from '../effects/effect-file-read-output-repository.js';
import {
  canonicalizeM2ToolValue,
  computeM2ToolRequestDigest,
  computeM2ToolValueDigest,
  validateM2ToolRequest,
  validateM2ToolResult,
} from '../../contracts/m2/tool-v1.js';
import {
  computeEffectRequestDigest,
  validateEffectRequest,
  validateEffectResult,
  validateEffectResultForRequest,
} from '../../contracts/m2/effect-current.js';
import {
  getM2ToolDescriptor,
  expectedM2EffectOperationKey,
  projectM2EffectToolTerminal,
} from './m2-tool-registry.js';
import { processExecutionLiveness } from '../effects/execution-owner.js';

export const M2ToolAuthorityErrorCode = Object.freeze({
  INPUT_INVALID: 'TOOL_AUTHORITY_INPUT_INVALID',
  REQUEST_CONFLICT: 'TOOL_REQUEST_CONFLICT',
  REQUEST_NOT_FOUND: 'TOOL_REQUEST_NOT_FOUND',
  RESULT_CONFLICT: 'TOOL_RESULT_CONFLICT',
  RESULT_REQUEST_MISMATCH: 'TOOL_RESULT_REQUEST_MISMATCH',
  EFFECT_LINK_CONFLICT: 'TOOL_EFFECT_LINK_CONFLICT',
  EFFECT_LINK_MISMATCH: 'TOOL_EFFECT_LINK_MISMATCH',
  STORAGE_FAILURE: 'TOOL_AUTHORITY_STORAGE_FAILURE',
});

export class M2ToolAuthorityError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'M2ToolAuthorityError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new M2ToolAuthorityError(code, message, details);
}

function requireDatabase(database) {
  if (!database || typeof database.prepare !== 'function') {
    fail(M2ToolAuthorityErrorCode.INPUT_INVALID, 'A SQLite database is required');
  }
  return database;
}

function timestampMs(value, label) {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    fail(M2ToolAuthorityErrorCode.INPUT_INVALID, `${label} must be a canonical timestamp`);
  }
  return milliseconds;
}

function requireValid(value, validator, label) {
  const validation = validator(value);
  if (!validation.valid) {
    fail(M2ToolAuthorityErrorCode.INPUT_INVALID, `${label} is invalid`, {
      errors: validation.errors,
    });
  }
  return value;
}

function storageFailure(operation, error) {
  fail(M2ToolAuthorityErrorCode.STORAGE_FAILURE, `Tool authority storage failed during ${operation}`, {
    cause: error?.message || String(error),
    sqliteCode: error?.code || null,
  });
}

function parseStored(row, column, validator, label) {
  if (!row) return null;
  try {
    const value = JSON.parse(row[column]);
    const validation = validator(value);
    if (!validation.valid) throw new Error(validation.errors.join(','));
    return Object.freeze(value);
  } catch (error) {
    storageFailure(`${label} read`, error);
  }
}

function registryDescriptorFor(request) {
  const descriptor = getM2ToolDescriptor(request.toolId, request.toolVersion);
  const expectedBinding = typeof descriptor?.buildEffectBinding === 'function'
    ? descriptor.buildEffectBinding(request.input)
    : null;
  const exact = descriptor
    && descriptor.version === request.toolVersion
    && descriptor.riskClass === request.riskClass
    && descriptor.authorityMode === request.authorityMode
    && descriptor.inputSchema === request.inputSchema
    && descriptor.outputSchema === request.outputSchema
    && descriptor.requiredEffectKind === request.requiredEffectKind
    && descriptor.validateInput(request.input).length === 0
    && canonicalizeM2ToolValue(expectedBinding) === canonicalizeM2ToolValue(request.effectBinding);
  if (!exact) {
    fail(
      M2ToolAuthorityErrorCode.INPUT_INVALID,
      'ToolRequest does not match the installed registry descriptor',
      { requestId: request.requestId, toolId: request.toolId },
    );
  }
  return descriptor;
}

function translationDigest(toolRequest, effectRequest) {
  return computeM2ToolValueDigest({
    toolRequestDigest: computeM2ToolRequestDigest(toolRequest),
    effectRequestDigest: computeEffectRequestDigest(effectRequest),
    effectBinding: toolRequest.effectBinding,
  });
}

function effectMatchesToolRequest(toolRequest, descriptor, effectRequest) {
  return effectRequest.runId === toolRequest.runId
    && effectRequest.origin.projectId === toolRequest.origin.projectId
    && effectRequest.actor.type === toolRequest.actor.type
    && effectRequest.actor.id === toolRequest.actor.id
    && effectRequest.origin.surface === toolRequest.origin.surface
    && effectRequest.origin.sessionId === toolRequest.origin.sessionId
    && effectRequest.origin.conversationId === toolRequest.origin.conversationId
    && effectRequest.kind === toolRequest.requiredEffectKind
    && effectRequest.idempotencyKey === expectedM2EffectOperationKey(toolRequest)
    && typeof descriptor.validateEffectTranslation === 'function'
    && descriptor.validateEffectTranslation(toolRequest, effectRequest) === true;
}

function effectProjectionMatches(result, projection) {
  return projection
    && result.status === projection.status
    && canonicalizeM2ToolValue(result.output) === canonicalizeM2ToolValue(projection.output)
    && result.outputDigest === projection.outputDigest
    && result.effectRequestId === projection.effectRequestId
    && canonicalizeM2ToolValue(result.error) === canonicalizeM2ToolValue(projection.error)
    && result.startedAt === projection.startedAt
    && result.completedAt === projection.completedAt
    && canonicalizeM2ToolValue(result.evidenceRefs) === canonicalizeM2ToolValue(projection.evidenceRefs)
    && result.lateCompletionRejected === projection.lateCompletionRejected;
}

function requireExecutionOwner(value) {
  const canonicalBootId = typeof value?.bootId === 'string'
    && (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.bootId)
      || /^unknown:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.bootId));
  const canonicalStartIdentity = typeof value?.startIdentity === 'string'
    && (/^\d+$/.test(value.startIdentity)
      || /^unknown:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.startIdentity));
  if (
    !value
    || typeof value.ownerId !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.ownerId)
    || !Number.isSafeInteger(value.pid)
    || value.pid <= 0
    || !canonicalBootId
    || !canonicalStartIdentity
  ) fail(M2ToolAuthorityErrorCode.INPUT_INVALID, 'A bounded tool execution owner is required');
  return value;
}

function projectionFunction(toolRequestJson, effectRequestJson, effectResultJson, toolResultJson, evidenceJson = null) {
  try {
    const request = JSON.parse(toolRequestJson);
    const effectRequest = JSON.parse(effectRequestJson);
    const effectResult = JSON.parse(effectResultJson);
    const result = JSON.parse(toolResultJson);
    if (
      !validateM2ToolRequest(request).valid
      || !validateEffectRequest(effectRequest).valid
      || !validateEffectResultForRequest(effectRequest, effectResult).valid
      || !validateM2ToolResult(result).valid
    ) return 0;
    const descriptor = registryDescriptorFor(request);
    if (!effectMatchesToolRequest(request, descriptor, effectRequest)) return 0;
    return effectProjectionMatches(
      result,
      projectM2EffectToolTerminal(request, descriptor, effectRequest, effectResult,
        evidenceJson === null ? null : JSON.parse(evidenceJson)),
    ) ? 1 : 0;
  } catch {
    return 0;
  }
}

export function registerM2FileReadToolProjectionFunction(database) {
  registerM2FileReadOutputFunctions(database);
  database.function('m2_tool_effect_projection_matches_v2', { deterministic: true },
    (requestJson, effectRequestJson, effectResultJson, resultJson, evidenceJson) => {
      try {
        const request = JSON.parse(requestJson);
        if (request.toolId !== 'file.read' || request.toolVersion !== 2) return 0;
        return projectionFunction(requestJson, effectRequestJson, effectResultJson, resultJson, evidenceJson);
      } catch { return 0; }
    });
}

export function registerM2FileListToolProjectionFunction(database) {
  registerM2FileListOutputFunctions(database);
  database.function('m2_tool_effect_request_matches_v2', { deterministic: true }, (toolJson, effectJson) => {
    try {
      const request = JSON.parse(toolJson); const effect = JSON.parse(effectJson);
      return request.toolId === 'file.list' && request.toolVersion === 2 && effect.version === 2
        && validateM2ToolRequest(request).valid && validateEffectRequest(effect).valid
        && effectMatchesToolRequest(request, registryDescriptorFor(request), effect) ? 1 : 0;
    } catch { return 0; }
  });
  database.function('m2_tool_effect_projection_matches_v3', { deterministic: true },
    (requestJson, effectRequestJson, effectResultJson, resultJson, evidenceJson) => {
      try {
        const request = JSON.parse(requestJson);
        if (request.toolId !== 'file.list' || request.toolVersion !== 2) return 0;
        return projectionFunction(requestJson, effectRequestJson, effectResultJson, resultJson, evidenceJson);
      } catch { return 0; }
    });
}

export class M2ToolAuthorityRepository {
  constructor(database, { clock = Date.now, executionLiveness = processExecutionLiveness } = {}) {
    this.database = requireDatabase(database);
    this.clock = clock;
    if (typeof clock !== 'function') {
      fail(M2ToolAuthorityErrorCode.INPUT_INVALID, 'A trusted tool authority clock is required');
    }
    if (typeof executionLiveness?.isProvablyDead !== 'function') {
      fail(M2ToolAuthorityErrorCode.INPUT_INVALID, 'Trusted tool execution liveness is required');
    }
    this.executionLiveness = executionLiveness;
    this.database.function('m2_tool_effect_projection_matches_v1', {
      deterministic: true,
    }, (requestJson, effectRequestJson, effectResultJson, resultJson) => {
      try {
        if (JSON.parse(effectRequestJson).version !== 1) return 0;
        return projectionFunction(requestJson, effectRequestJson, effectResultJson, resultJson);
      } catch { return 0; }
    });
    registerM2FileReadToolProjectionFunction(this.database);
    registerM2FileListToolProjectionFunction(this.database);
    this.database.function('m2_tool_effect_operation_key_matches_v1', {
      deterministic: true,
    }, (toolRequestJson, effectRequestJson) => {
      try {
        const toolRequest = JSON.parse(toolRequestJson);
        const effectRequest = JSON.parse(effectRequestJson);
        return effectRequest.idempotencyKey === expectedM2EffectOperationKey(toolRequest) ? 1 : 0;
      } catch {
        return 0;
      }
    });
    this.database.function('m2_tool_effect_operation_key_equals_v1', {
      deterministic: true,
    }, (toolRequestJson, operationKey) => {
      try {
        return expectedM2EffectOperationKey(JSON.parse(toolRequestJson)) === operationKey ? 1 : 0;
      } catch {
        return 0;
      }
    });
  }

  getEffectOutputEvidence(effectRequest, effectResult) {
    return effectRequest?.version === 2
      ? readM2FileListOutput(this.database, effectRequest, effectResult)?.evidence ?? null
      : this.getFileReadOutputEvidence(effectRequest, effectResult);
  }

  getFileReadOutputEvidence(effectRequest, effectResult) {
    return readM2FileReadOutput(this.database, effectRequest, effectResult)?.evidence ?? null;
  }

  resolveFileReadContent({ requestId, contentRef, actor, projectId, conversationId }) {
    const request = this.getToolRequest(requestId);
    if (!request || request.toolId !== 'file.read' || request.toolVersion !== 2
      || actor?.type !== 'user' || request.actor.type !== actor.type || request.actor.id !== actor.id
      || !Number.isSafeInteger(projectId) || projectId <= 0 || request.origin.projectId !== projectId
      || request.origin.conversationId !== conversationId) {
      fail(M2ToolAuthorityErrorCode.INPUT_INVALID, 'Exact file output caller is required');
    }
    // Check current membership using indexes before loading any private BLOB.
    const visible = this.database.prepare(`
      SELECT output.effect_id FROM m2_file_read_outputs output
      JOIN m2_tool_effect_links link ON link.effect_id = output.effect_id
      JOIN conversations conversation ON conversation.id = output.conversation_id
      JOIN projects project ON project.id = conversation.project_id
      WHERE link.request_id = ? AND output.project_id = ? AND project.id = output.project_id
        AND project.path = output.project_path AND output.payload IS NOT NULL
        AND conversation.state IN ('active', 'archived') AND project.status IN ('active', 'archived')
        AND NOT EXISTS (SELECT 1 FROM m2_file_read_output_tombstones WHERE effect_id = output.effect_id)
    `).get(requestId, projectId);
    if (!visible) fail('EFFECT_FILE_READ_CONTENT_UNAVAILABLE', 'Immutable file content is unavailable for the current project conversation');
    const result = this.getToolResult(requestId);
    const link = this.getEffectLinkByRequest(requestId);
    if (!result || result.status !== 'ok' || !link || result.effectRequestId !== link.effectId
      || result.output?.contentRef !== contentRef) {
      fail(M2ToolAuthorityErrorCode.INPUT_INVALID, 'Exact successful file output reference is required');
    }
    const effectResult = this.getExactEffectResult(link.effectId);
    const output = readM2FileReadOutput(this.database, link.effectRequest, effectResult);
    const current = this.database.prepare(`
      SELECT conversation.id FROM conversations conversation JOIN projects project ON project.id = conversation.project_id
      WHERE conversation.id = ? AND project.id = ? AND project.path = ?
        AND conversation.state IN ('active', 'archived') AND project.status IN ('active', 'archived')
    `).get(output?.conversationId, projectId, output?.projectPath);
    if (!current || !output?.bytes || output.evidence.contentRef !== contentRef) {
      fail('EFFECT_FILE_READ_CONTENT_UNAVAILABLE', 'Immutable file content is unavailable for the current project conversation');
    }
    return Object.freeze({ bytes: output.bytes, output: result.output, request, result,
      effectId: link.effectId, path: request.input.path });
  }

  resolveFileListContent({ requestId, contentRef, actor, projectId, conversationId }) {
    const request = this.getToolRequest(requestId);
    if (!request || request.toolId !== 'file.list' || request.toolVersion !== 2
      || actor?.type !== 'user' || request.actor.type !== actor.type || request.actor.id !== actor.id
      || !Number.isSafeInteger(projectId) || projectId <= 0 || request.origin.projectId !== projectId
      || request.origin.conversationId !== conversationId) {
      fail(M2ToolAuthorityErrorCode.INPUT_INVALID, 'Exact listing output caller is required');
    }
    // Check current membership using indexes before loading any private BLOB.
    const visible = this.database.prepare(`
      SELECT output.effect_id FROM m2_file_list_outputs output
      JOIN m2_tool_effect_links link ON link.effect_id = output.effect_id
      JOIN conversations conversation ON conversation.id = output.conversation_id
      JOIN projects project ON project.id = conversation.project_id
      WHERE link.request_id = ? AND output.project_id = ? AND project.id = output.project_id
        AND project.path = output.project_path AND output.payload IS NOT NULL
        AND conversation.state IN ('active', 'archived') AND project.status IN ('active', 'archived')
        AND NOT EXISTS (SELECT 1 FROM m2_file_list_output_tombstones WHERE effect_id = output.effect_id)
    `).get(requestId, projectId);
    if (!visible) fail('EFFECT_FILE_LIST_CONTENT_UNAVAILABLE', 'Immutable listing content is unavailable for the current project conversation');
    const result = this.getToolResult(requestId);
    const link = this.getEffectLinkByRequest(requestId);
    if (!result || result.status !== 'ok' || !link || result.effectRequestId !== link.effectId
      || result.output?.contentRef !== contentRef) {
      fail(M2ToolAuthorityErrorCode.INPUT_INVALID, 'Exact successful listing output reference is required');
    }
    const effectResult = this.getExactEffectResult(link.effectId);
    const output = readM2FileListOutput(this.database, link.effectRequest, effectResult);
    const current = this.database.prepare(`
      SELECT conversation.id FROM conversations conversation JOIN projects project ON project.id = conversation.project_id
      WHERE conversation.id = ? AND project.id = ? AND project.path = ?
        AND conversation.state IN ('active', 'archived') AND project.status IN ('active', 'archived')
    `).get(output?.conversationId, projectId, output?.projectPath);
    if (!current || !output?.bytes || output.evidence.contentRef !== contentRef) {
      fail('EFFECT_FILE_LIST_CONTENT_UNAVAILABLE', 'Immutable listing content is unavailable for the current project conversation');
    }
    return Object.freeze({ bytes: output.bytes, output: result.output, request, result,
      effectId: link.effectId, path: request.input.path });
  }

  registerToolRequest(requestValue) {
    const request = requireValid(requestValue, validateM2ToolRequest, 'ToolRequest');
    registryDescriptorFor(request);
    const encoded = canonicalizeM2ToolValue(request);
    const requestDigest = computeM2ToolRequestDigest(request);
    try {
      this.database.prepare(`
        INSERT INTO tool_v1_requests (
          request_id, request_digest, run_id, project_id, actor_type, actor_id,
          surface, session_id, conversation_id, tool_id, tool_version,
          risk_class, input_schema, input_digest, required_effect_kind,
          timeout_ms, idempotency_key, request_json, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        request.requestId,
        requestDigest,
        request.runId,
        request.origin.projectId,
        request.actor.type,
        request.actor.id,
        request.origin.surface,
        request.origin.sessionId,
        request.origin.conversationId,
        request.toolId,
        request.toolVersion,
        request.riskClass,
        request.inputSchema,
        request.inputDigest,
        request.requiredEffectKind,
        request.timeoutMs,
        request.idempotencyKey,
        encoded,
        timestampMs(request.createdAt, 'ToolRequest.createdAt'),
      );
      return Object.freeze({ created: true, request, requestDigest });
    } catch (error) {
      const existing = this.database.prepare(`
        SELECT request_json, request_digest FROM tool_v1_requests
        WHERE request_id = ? OR (run_id = ? AND idempotency_key = ?)
        ORDER BY CASE WHEN request_id = ? THEN 0 ELSE 1 END
        LIMIT 1
      `).get(request.requestId, request.runId, request.idempotencyKey, request.requestId);
      if (existing?.request_json === encoded && existing.request_digest === requestDigest) {
        return Object.freeze({ created: false, request, requestDigest });
      }
      if (!existing) storageFailure('request registration', error);
      fail(
        M2ToolAuthorityErrorCode.REQUEST_CONFLICT,
        'Tool request identity is already bound to different bytes',
        { requestId: request.requestId, cause: error.message },
      );
    }
  }

  getToolRequest(requestId) {
    const row = this.database.prepare(`
      SELECT * FROM tool_v1_requests WHERE request_id = ?
    `).get(requestId);
    const request = parseStored(row, 'request_json', validateM2ToolRequest, 'ToolRequest');
    if (!request) return null;
    try {
      registryDescriptorFor(request);
      const exact = request.requestId === row.request_id
        && computeM2ToolRequestDigest(request) === row.request_digest
        && request.runId === row.run_id
        && request.origin.projectId === row.project_id
        && request.actor.type === row.actor_type
        && request.actor.id === row.actor_id
        && request.origin.surface === row.surface
        && request.origin.sessionId === row.session_id
        && request.origin.conversationId === row.conversation_id
        && request.toolId === row.tool_id
        && request.toolVersion === row.tool_version
        && request.riskClass === row.risk_class
        && request.inputSchema === row.input_schema
        && request.inputDigest === row.input_digest
        && request.requiredEffectKind === row.required_effect_kind
        && request.timeoutMs === row.timeout_ms
        && request.idempotencyKey === row.idempotency_key
        && timestampMs(request.createdAt, 'ToolRequest.createdAt') === row.created_at_ms;
      if (!exact) throw new Error('stored ToolRequest index or digest mismatch');
      return request;
    } catch (error) {
      storageFailure('ToolRequest identity read', error);
    }
  }

  getToolRequestByOperation(runId, idempotencyKey) {
    const row = this.database.prepare(`
      SELECT request_id FROM tool_v1_requests
      WHERE run_id = ? AND idempotency_key = ?
    `).get(runId, idempotencyKey);
    return row ? this.getToolRequest(row.request_id) : null;
  }

  getExactEffectRequest(effectRequestId) {
    const row = this.database.prepare(`
      SELECT * FROM m2_effect_requests WHERE effect_id = ?
    `).get(effectRequestId);
    const request = parseStored(row, 'request_json', validateEffectRequest, 'EffectRequest');
    if (!request) return null;
    try {
      const exact = request.effectId === row.effect_id
        && request.runId === row.run_id
        && request.origin.projectId === row.project_id
        && request.kind === row.kind
        && request.payloadDigest === row.payload_digest
        && request.payloadBytes === row.payload_bytes
        && computeEffectRequestDigest(request) === row.request_digest
        && request.workspaceRevision === row.workspace_revision
        && request.idempotencyKey === row.idempotency_key
        && timestampMs(request.createdAt, 'EffectRequest.createdAt') === row.created_at_ms;
      if (!exact) throw new Error('stored EffectRequest index or digest mismatch');
      return request;
    } catch (error) {
      storageFailure('EffectRequest link read', error);
    }
  }

  getExactEffectResult(effectRequestId) {
    const row = this.database.prepare(`
      SELECT * FROM m2_effect_results WHERE effect_id = ?
    `).get(effectRequestId);
    const result = parseStored(row, 'result_json', validateEffectResult, 'EffectResult');
    if (!result) return null;
    const request = this.getExactEffectRequest(effectRequestId);
    if (
      !request
      || !validateEffectResultForRequest(request, result).valid
      || result.effectId !== request.effectId
      || result.effectId !== row.effect_id
      || result.runId !== request.runId
      || result.runId !== row.run_id
      || result.projectId !== request.origin.projectId
      || result.projectId !== row.project_id
      || result.requestDigest !== computeEffectRequestDigest(request)
      || result.requestDigest !== row.request_digest
      || result.approvalGrantId !== row.approval_grant_id
      || result.terminalStatus !== row.terminal_status
      || timestampMs(result.completedAt, 'EffectResult.completedAt') !== row.completed_at_ms
    ) storageFailure('EffectResult link identity read', new Error('EffectResult authority mismatch'));
    return result;
  }

  bindToolEffect({ requestId, effectRequestId, effectRequest: suppliedEffectRequest = null } = {}) {
    const request = this.getToolRequest(requestId);
    const effectRequest = this.getExactEffectRequest(effectRequestId);
    if (!request || !effectRequest) {
      fail(
        M2ToolAuthorityErrorCode.EFFECT_LINK_MISMATCH,
        'Tool/effect link references missing durable authority',
        { requestId, effectRequestId },
      );
    }
    if (this.getToolResult(requestId)) {
      fail(
        M2ToolAuthorityErrorCode.EFFECT_LINK_CONFLICT,
        'A terminal ToolResult cannot acquire later effect authority',
        { requestId, effectRequestId },
      );
    }
    const invalidationTablesInstalled = this.database.prepare(`
      SELECT count(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name IN (
        'm2_effect_invalidations',
        'm2_tool_effect_operation_invalidations'
      )
    `).get().count === 2;
    if (invalidationTablesInstalled && (
      this.getToolEffectOperationInvalidation(requestId)
      || this.database.prepare(`
        SELECT 1 FROM m2_effect_invalidations WHERE effect_id = ?
      `).get(effectRequestId)
    )) {
      fail(
        M2ToolAuthorityErrorCode.EFFECT_LINK_CONFLICT,
        'Invalidated effect authority cannot acquire a Tool/effect link',
        { requestId, effectRequestId },
      );
    }
    if (
      suppliedEffectRequest
      && canonicalizeM2ToolValue(suppliedEffectRequest) !== canonicalizeM2ToolValue(effectRequest)
    ) {
      fail(
        M2ToolAuthorityErrorCode.EFFECT_LINK_MISMATCH,
        'Supplied EffectRequest differs from durable effect authority',
        { requestId, effectRequestId },
      );
    }
    const descriptor = registryDescriptorFor(request);
    if (!effectMatchesToolRequest(request, descriptor, effectRequest)) {
      fail(
        M2ToolAuthorityErrorCode.EFFECT_LINK_MISMATCH,
        'EffectRequest does not exactly translate the ToolRequest',
        { requestId, effectRequestId },
      );
    }
    const toolRequestDigest = computeM2ToolRequestDigest(request);
    const effectRequestDigest = computeEffectRequestDigest(effectRequest);
    const digest = translationDigest(request, effectRequest);
    const linkedAtMs = this.clock();
    if (!Number.isSafeInteger(linkedAtMs) || linkedAtMs < 0) {
      fail(M2ToolAuthorityErrorCode.INPUT_INVALID, 'Tool authority clock returned an invalid timestamp');
    }
    const existing = this.getEffectLinkByRequest(requestId)
      || this.getEffectLinkByEffect(effectRequestId);
    const link = Object.freeze({
      requestId,
      effectId: effectRequestId,
      toolRequestDigest,
      effectRequestDigest,
      translationDigest: digest,
      linkedAtMs: existing?.linkedAtMs ?? linkedAtMs,
    });
    const encoded = canonicalizeM2ToolValue(link);
    try {
      this.database.prepare(`
        INSERT INTO m2_tool_effect_links (
          request_id, effect_id, tool_request_digest, effect_request_digest,
          translation_digest, link_json, linked_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        requestId,
        effectRequestId,
        toolRequestDigest,
        effectRequestDigest,
        digest,
        encoded,
        link.linkedAtMs,
      );
      return Object.freeze({ created: true, link });
    } catch (error) {
      const stored = this.getEffectLinkByRequest(requestId)
        || this.getEffectLinkByEffect(effectRequestId);
      const storedValue = stored ? {
        requestId: stored.requestId,
        effectId: stored.effectId,
        toolRequestDigest: stored.toolRequestDigest,
        effectRequestDigest: stored.effectRequestDigest,
        translationDigest: stored.translationDigest,
        linkedAtMs: stored.linkedAtMs,
      } : null;
      if (storedValue && canonicalizeM2ToolValue(storedValue) === encoded) {
        return Object.freeze({ created: false, link: stored });
      }
      if (!stored) storageFailure('tool/effect link registration', error);
      fail(
        M2ToolAuthorityErrorCode.EFFECT_LINK_CONFLICT,
        'Tool/effect authority is already linked to different bytes',
        { requestId, effectRequestId, cause: error.message },
      );
    }
  }

  invalidatePendingEffect({ requestId, effectRequestId, reasonCode = 'TOOL_EFFECT_TRANSLATION_INVALID' } = {}) {
    const request = this.getToolRequest(requestId);
    const effectRequest = this.getExactEffectRequest(effectRequestId);
    if (!request || !effectRequest) {
      fail(
        M2ToolAuthorityErrorCode.EFFECT_LINK_MISMATCH,
        'Effect invalidation references missing durable authority',
        { requestId, effectRequestId },
      );
    }
    const identityMatches = effectRequest.runId === request.runId
      && effectRequest.origin.projectId === request.origin.projectId
      && effectRequest.actor.type === request.actor.type
      && effectRequest.actor.id === request.actor.id
      && effectRequest.origin.surface === request.origin.surface
      && effectRequest.origin.sessionId === request.origin.sessionId
      && effectRequest.origin.conversationId === request.origin.conversationId
      && effectRequest.kind === request.requiredEffectKind
      && effectRequest.idempotencyKey === expectedM2EffectOperationKey(request);
    if (!identityMatches || !/^[A-Z][A-Z0-9_:-]{0,63}$/.test(reasonCode)) {
      fail(
        M2ToolAuthorityErrorCode.EFFECT_LINK_MISMATCH,
        'Effect invalidation does not match its ToolRequest authority',
        { requestId, effectRequestId },
      );
    }
    const transaction = this.database.transaction(() => {
      const existing = this.database.prepare(`
        SELECT * FROM m2_effect_invalidations WHERE effect_id = ?
      `).get(effectRequestId);
      const atMs = existing?.invalidated_at_ms ?? this.clock();
      if (!Number.isSafeInteger(atMs) || atMs < 0) {
        fail(M2ToolAuthorityErrorCode.INPUT_INVALID, 'Tool authority clock returned an invalid timestamp');
      }
      if (!existing) {
        this.database.prepare(`
          INSERT INTO m2_effect_invalidations (
            effect_id, request_digest, source_tool_request_id, reason_code, invalidated_at_ms
          ) VALUES (?, ?, ?, ?, ?)
        `).run(
          effectRequestId,
          computeEffectRequestDigest(effectRequest),
          requestId,
          reasonCode,
          atMs,
        );
      } else if (
        existing.request_digest !== computeEffectRequestDigest(effectRequest)
        || existing.source_tool_request_id !== requestId
        || existing.reason_code !== reasonCode
      ) {
        fail(M2ToolAuthorityErrorCode.EFFECT_LINK_CONFLICT, 'Effect invalidation bytes conflict', {
          requestId,
          effectRequestId,
        });
      }
      this.database.prepare(`
        DELETE FROM m2_pending_effect_payloads WHERE effect_id = ?
      `).run(effectRequestId);
      return Object.freeze({
        effectId: effectRequestId,
        requestId,
        reasonCode,
        invalidatedAtMs: atMs,
      });
    });
    try {
      return transaction.immediate();
    } catch (error) {
      if (error instanceof M2ToolAuthorityError) throw error;
      storageFailure('pending effect invalidation', error);
    }
  }

  invalidateToolEffectOperation({
    requestId,
    reasonCode = 'TOOL_EFFECT_PREPARATION_INTERRUPTED',
  } = {}) {
    const request = this.getToolRequest(requestId);
    if (
      !request
      || request.authorityMode !== 'effect'
      || !Number.isSafeInteger(request.origin.projectId)
      || request.origin.projectId <= 0
      || !/^[A-Z][A-Z0-9_:-]{0,63}$/.test(reasonCode)
    ) {
      fail(
        M2ToolAuthorityErrorCode.EFFECT_LINK_MISMATCH,
        'Tool effect operation invalidation lacks exact durable authority',
        { requestId },
      );
    }
    const existingEffectInvalidation = this.getToolEffectInvalidation(requestId);
    if (existingEffectInvalidation) return existingEffectInvalidation;
    const operationKey = expectedM2EffectOperationKey(request);
    const requestDigest = computeM2ToolRequestDigest(request);
    const transaction = this.database.transaction(() => {
      const existing = this.database.prepare(`
        SELECT * FROM m2_tool_effect_operation_invalidations
        WHERE source_tool_request_id = ?
      `).get(requestId);
      const atMs = existing?.invalidated_at_ms ?? this.clock();
      if (
        !Number.isSafeInteger(atMs)
        || atMs < timestampMs(request.createdAt, 'ToolRequest.createdAt')
      ) {
        fail(M2ToolAuthorityErrorCode.INPUT_INVALID, 'Tool effect invalidation timestamp is invalid');
      }
      if (!existing) {
        this.database.prepare(`
          INSERT INTO m2_tool_effect_operation_invalidations (
            source_tool_request_id, tool_request_digest, run_id, project_id,
            effect_idempotency_key, reason_code, invalidated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          requestId,
          requestDigest,
          request.runId,
          request.origin.projectId,
          operationKey,
          reasonCode,
          atMs,
        );
      } else if (
        existing.tool_request_digest !== requestDigest
        || existing.run_id !== request.runId
        || existing.project_id !== request.origin.projectId
        || existing.effect_idempotency_key !== operationKey
      ) {
        fail(
          M2ToolAuthorityErrorCode.EFFECT_LINK_CONFLICT,
          'Tool effect operation invalidation bytes conflict',
          { requestId },
        );
      }
      const canonicalReasonCode = existing?.reason_code || reasonCode;

      const effectRow = this.database.prepare(`
        SELECT effect_id FROM m2_effect_requests
        WHERE run_id = ? AND idempotency_key = ?
      `).get(request.runId, operationKey);
      if (effectRow) {
        const effectRequest = this.getExactEffectRequest(effectRow.effect_id);
        // The operation tuple itself is the containment boundary. A buggy
        // adapter may have persisted canonical EffectRequest bytes with a
        // forged target/payload while retaining this exact tuple; those bytes
        // must be invalidated, not left approvable because translation fails.
        if (
          !effectRequest
          || effectRequest.runId !== request.runId
          || effectRequest.origin.projectId !== request.origin.projectId
          || effectRequest.idempotencyKey !== operationKey
        ) {
          fail(
            M2ToolAuthorityErrorCode.EFFECT_LINK_MISMATCH,
            'Durable effect operation does not exactly translate its ToolRequest',
            { requestId, effectRequestId: effectRow.effect_id },
          );
        }
        const existingInvalidation = this.database.prepare(`
          SELECT * FROM m2_effect_invalidations WHERE effect_id = ?
        `).get(effectRequest.effectId);
        if (!existingInvalidation) {
          this.database.prepare(`
            INSERT INTO m2_effect_invalidations (
              effect_id, request_digest, source_tool_request_id, reason_code, invalidated_at_ms
            ) VALUES (?, ?, ?, ?, ?)
          `).run(
            effectRequest.effectId,
            computeEffectRequestDigest(effectRequest),
            requestId,
            canonicalReasonCode,
            atMs,
          );
        } else if (
          existingInvalidation.request_digest !== computeEffectRequestDigest(effectRequest)
          || existingInvalidation.source_tool_request_id !== requestId
          || existingInvalidation.reason_code !== canonicalReasonCode
        ) {
          fail(
            M2ToolAuthorityErrorCode.EFFECT_LINK_CONFLICT,
            'Effect invalidation bytes conflict with its operation tombstone',
            { requestId, effectRequestId: effectRequest.effectId },
          );
        }
        this.database.prepare(`
          DELETE FROM m2_pending_effect_payloads WHERE effect_id = ?
        `).run(effectRequest.effectId);
      }
      return Object.freeze({
        requestId,
        effectId: effectRow?.effect_id || null,
        operationKey,
        reasonCode: canonicalReasonCode,
        invalidatedAtMs: atMs,
      });
    });
    try {
      return transaction.immediate();
    } catch (error) {
      if (error instanceof M2ToolAuthorityError) throw error;
      storageFailure('tool effect operation invalidation', error);
    }
  }

  getToolEffectOperationInvalidation(requestId) {
    const row = this.database.prepare(`
      SELECT * FROM m2_tool_effect_operation_invalidations
      WHERE source_tool_request_id = ?
    `).get(requestId);
    if (!row) return null;
    const request = this.getToolRequest(requestId);
    const exact = request
      && row.tool_request_digest === computeM2ToolRequestDigest(request)
      && row.run_id === request.runId
      && row.project_id === request.origin.projectId
      && row.effect_idempotency_key === expectedM2EffectOperationKey(request)
      && /^[A-Z][A-Z0-9_:-]{0,63}$/.test(row.reason_code)
      && Number.isSafeInteger(row.invalidated_at_ms)
      && row.invalidated_at_ms >= timestampMs(request.createdAt, 'ToolRequest.createdAt');
    if (!exact) {
      storageFailure('tool effect operation invalidation read', new Error('invalidation authority mismatch'));
    }
    const effectRow = this.database.prepare(`
      SELECT effect_id FROM m2_effect_requests
      WHERE run_id = ? AND idempotency_key = ?
    `).get(row.run_id, row.effect_idempotency_key);
    if (effectRow) {
      const effectRequest = this.getExactEffectRequest(effectRow.effect_id);
      const invalidation = this.database.prepare(`
        SELECT * FROM m2_effect_invalidations WHERE effect_id = ?
      `).get(effectRow.effect_id);
      const dangling = this.database.prepare(`
        SELECT
          (SELECT count(*) FROM m2_pending_effect_payloads WHERE effect_id = ?) AS pending,
          (SELECT count(*) FROM m2_approval_grants WHERE effect_id = ?) AS grants,
          (SELECT count(*) FROM m2_effect_results WHERE effect_id = ?) AS results,
          (SELECT count(*) FROM m2_tool_effect_links WHERE effect_id = ?) AS links
      `).get(effectRow.effect_id, effectRow.effect_id, effectRow.effect_id, effectRow.effect_id);
      if (
        !effectRequest
        || effectRequest.runId !== row.run_id
        || effectRequest.origin.projectId !== row.project_id
        || effectRequest.idempotencyKey !== row.effect_idempotency_key
        || !invalidation
        || invalidation.request_digest !== computeEffectRequestDigest(effectRequest)
        || invalidation.source_tool_request_id !== requestId
        || invalidation.reason_code !== row.reason_code
        || dangling.pending !== 0
        || dangling.grants !== 0
        || dangling.results !== 0
        || dangling.links !== 0
      ) {
        storageFailure(
          'tool effect operation invalidation containment read',
          new Error('operation tombstone left live effect authority'),
        );
      }
    }
    return Object.freeze({
      requestId,
      effectId: effectRow?.effect_id || null,
      operationKey: row.effect_idempotency_key,
      reasonCode: row.reason_code,
      invalidatedAtMs: row.invalidated_at_ms,
    });
  }

  getToolEffectInvalidation(requestId) {
    const rows = this.database.prepare(`
      SELECT
        invalidation.effect_id,
        invalidation.request_digest,
        invalidation.source_tool_request_id,
        invalidation.reason_code,
        invalidation.invalidated_at_ms
      FROM m2_effect_invalidations invalidation
      WHERE invalidation.source_tool_request_id = ?
      ORDER BY invalidation.effect_id
    `).all(requestId);
    if (rows.length === 0) return null;
    if (rows.length !== 1) {
      storageFailure(
        'tool effect invalidation read',
        new Error('multiple invalidations reference one ToolRequest'),
      );
    }
    const row = rows[0];
    const request = this.getToolRequest(requestId);
    const effectRequest = this.getExactEffectRequest(row.effect_id);
    const dangling = this.database.prepare(`
      SELECT
        (SELECT count(*) FROM m2_pending_effect_payloads WHERE effect_id = ?) AS pending,
        (SELECT count(*) FROM m2_approval_grants WHERE effect_id = ?) AS grants,
        (SELECT count(*) FROM m2_effect_results WHERE effect_id = ?) AS results,
        (SELECT count(*) FROM m2_tool_effect_links WHERE effect_id = ?) AS links
    `).get(row.effect_id, row.effect_id, row.effect_id, row.effect_id);
    const exact = request
      && effectRequest
      && request.authorityMode === 'effect'
      && row.source_tool_request_id === requestId
      && row.request_digest === computeEffectRequestDigest(effectRequest)
      && effectRequest.runId === request.runId
      && effectRequest.origin.projectId === request.origin.projectId
      && effectRequest.idempotencyKey === expectedM2EffectOperationKey(request)
      && /^[A-Z][A-Z0-9_:-]{0,63}$/.test(row.reason_code)
      && Number.isSafeInteger(row.invalidated_at_ms)
      && row.invalidated_at_ms >= timestampMs(request.createdAt, 'ToolRequest.createdAt')
      && dangling.pending === 0
      && dangling.grants === 0
      && dangling.results === 0
      && dangling.links === 0;
    if (!exact) {
      storageFailure(
        'tool effect invalidation containment read',
        new Error('effect invalidation left live or mismatched authority'),
      );
    }
    return Object.freeze({
      requestId,
      effectId: effectRequest.effectId,
      operationKey: effectRequest.idempotencyKey,
      reasonCode: row.reason_code,
      invalidatedAtMs: row.invalidated_at_ms,
    });
  }

  #effectLinkFromRow(row) {
    if (!row) return null;
    const link = parseStored(row, 'link_json', value => {
      const errors = [];
      const keys = Object.keys(value || {}).sort().join(',');
      if (keys !== 'effectId,effectRequestDigest,linkedAtMs,requestId,toolRequestDigest,translationDigest') {
        errors.push('tool-effect-link:invalid-keys');
      }
      return { valid: errors.length === 0, errors };
    }, 'ToolEffectLink');
    try {
      const request = this.getToolRequest(link.requestId);
      const effectRequest = this.getExactEffectRequest(link.effectId);
      const descriptor = request ? registryDescriptorFor(request) : null;
      const exact = request
        && effectRequest
        && descriptor
        && link.requestId === row.request_id
        && link.effectId === row.effect_id
        && link.toolRequestDigest === row.tool_request_digest
        && link.effectRequestDigest === row.effect_request_digest
        && link.translationDigest === row.translation_digest
        && link.linkedAtMs === row.linked_at_ms
        && link.toolRequestDigest === computeM2ToolRequestDigest(request)
        && link.effectRequestDigest === computeEffectRequestDigest(effectRequest)
        && link.translationDigest === translationDigest(request, effectRequest)
        && effectMatchesToolRequest(request, descriptor, effectRequest);
      if (!exact) throw new Error('stored tool/effect link identity mismatch');
      return Object.freeze({ ...link, request, effectRequest });
    } catch (error) {
      storageFailure('ToolEffectLink identity read', error);
    }
  }

  getEffectLinkByRequest(requestId) {
    const row = this.database.prepare(`
      SELECT * FROM m2_tool_effect_links WHERE request_id = ?
    `).get(requestId);
    return this.#effectLinkFromRow(row);
  }

  getEffectLinkByEffect(effectRequestId) {
    const row = this.database.prepare(`
      SELECT * FROM m2_tool_effect_links WHERE effect_id = ?
    `).get(effectRequestId);
    return this.#effectLinkFromRow(row);
  }

  getToolRequestByEffect(effectRequestId) {
    return this.getEffectLinkByEffect(effectRequestId)?.request || null;
  }

  getToolExecutionClaim(requestId) {
    const row = this.database.prepare(`
      SELECT * FROM tool_v1_execution_claims
      WHERE request_id = ? ORDER BY generation DESC LIMIT 1
    `).get(requestId);
    if (!row) return null;
    const request = this.getToolRequest(requestId);
    const owner = {
      ownerId: row.owner_id,
      pid: row.owner_pid,
      bootId: row.owner_boot_id,
      startIdentity: row.owner_start_identity,
    };
    try {
      requireExecutionOwner(owner);
    } catch (error) {
      storageFailure('ToolExecutionClaim owner read', error);
    }
    if (
      !request
      || row.request_digest !== computeM2ToolRequestDigest(request)
      || !Number.isSafeInteger(row.generation)
      || row.generation < 1
      || !Number.isSafeInteger(row.claimed_at_ms)
      || row.claimed_at_ms < timestampMs(request.createdAt, 'ToolRequest.createdAt')
    ) storageFailure('ToolExecutionClaim identity read', new Error('claim authority mismatch'));
    return Object.freeze({
      requestId: row.request_id,
      requestDigest: row.request_digest,
      generation: row.generation,
      ownerId: row.owner_id,
      ownerPid: row.owner_pid,
      ownerBootId: row.owner_boot_id,
      ownerStartIdentity: row.owner_start_identity,
      claimedAtMs: row.claimed_at_ms,
    });
  }

  claimToolExecution({ requestId, executionOwner: ownerValue } = {}) {
    const owner = requireExecutionOwner(ownerValue);
    const transaction = this.database.transaction(() => {
      const request = this.getToolRequest(requestId);
      if (!request) {
        fail(M2ToolAuthorityErrorCode.REQUEST_NOT_FOUND, 'Execution claim has no ToolRequest', {
          requestId,
        });
      }
      if (this.getToolResult(requestId) || this.getEffectLinkByRequest(requestId)) {
        fail(
          M2ToolAuthorityErrorCode.RESULT_CONFLICT,
          'Terminal or linked tool authority cannot acquire a new execution generation',
          { requestId },
        );
      }
      const existing = this.getToolExecutionClaim(requestId);
      if (existing && this.executionLiveness.isProvablyDead(existing) !== true) {
        return Object.freeze({ acquired: false, claim: existing });
      }
      const claimedAtMs = this.clock();
      if (!Number.isSafeInteger(claimedAtMs) || claimedAtMs < 0) {
        fail(M2ToolAuthorityErrorCode.INPUT_INVALID, 'Tool authority clock returned an invalid timestamp');
      }
      if (claimedAtMs < timestampMs(request.createdAt, 'ToolRequest.createdAt')) {
        fail(
          M2ToolAuthorityErrorCode.INPUT_INVALID,
          'Tool execution claim cannot predate its durable ToolRequest',
          { requestId },
        );
      }
      const generation = (existing?.generation || 0) + 1;
      try {
        this.database.prepare(`
          INSERT INTO tool_v1_execution_claims (
            request_id, request_digest, generation, owner_id, owner_pid,
            owner_boot_id, owner_start_identity, claimed_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          requestId,
          computeM2ToolRequestDigest(request),
          generation,
          owner.ownerId,
          owner.pid,
          owner.bootId,
          owner.startIdentity,
          claimedAtMs,
        );
      } catch (error) {
        const winner = this.getToolExecutionClaim(requestId);
        if (winner) return Object.freeze({ acquired: false, claim: winner });
        storageFailure('tool execution claim', error);
      }
      return Object.freeze({ acquired: true, claim: this.getToolExecutionClaim(requestId) });
    });
    try {
      return transaction.immediate();
    } catch (error) {
      if (error instanceof M2ToolAuthorityError) throw error;
      storageFailure('tool execution claim transaction', error);
    }
  }

  recordToolResult(resultValue, { executionClaim: suppliedClaim = null } = {}) {
    const result = requireValid(resultValue, validateM2ToolResult, 'ToolResult');
    const request = this.getToolRequest(result.requestId);
    if (!request) {
      fail(M2ToolAuthorityErrorCode.REQUEST_NOT_FOUND, 'ToolResult has no stored ToolRequest', {
        requestId: result.requestId,
      });
    }
    const requestDigest = computeM2ToolRequestDigest(request);
    const executionClaim = this.getToolExecutionClaim(request.requestId);
    if (
      !executionClaim
      || !suppliedClaim
      || suppliedClaim.requestId !== executionClaim.requestId
      || suppliedClaim.requestDigest !== executionClaim.requestDigest
      || suppliedClaim.generation !== executionClaim.generation
      || suppliedClaim.ownerId !== executionClaim.ownerId
    ) {
      fail(
        M2ToolAuthorityErrorCode.RESULT_REQUEST_MISMATCH,
        'ToolResult is not fenced by the latest durable execution claim',
        { requestId: result.requestId },
      );
    }
    const descriptor = registryDescriptorFor(request);
    const identityMatches = result.requestDigest === requestDigest
      && result.runId === request.runId
      && result.projectId === request.origin.projectId
      && result.toolId === request.toolId
      && result.toolVersion === request.toolVersion
      && result.outputSchema === request.outputSchema;
    if (!identityMatches) {
      fail(
        M2ToolAuthorityErrorCode.RESULT_REQUEST_MISMATCH,
        'ToolResult identity does not match its durable ToolRequest',
        { requestId: result.requestId },
      );
    }

    if (result.status === 'ok' && descriptor.validateOutput(result.output).length > 0) {
      fail(
        M2ToolAuthorityErrorCode.RESULT_REQUEST_MISMATCH,
        'ToolResult output does not match its registered output schema',
        { requestId: result.requestId },
      );
    }
    const link = this.getEffectLinkByRequest(request.requestId);
    if (link) {
      const effectRequest = link.effectRequest;
      const effectResult = effectRequest
        ? this.getExactEffectResult(effectRequest.effectId)
        : null;
      if (
        link.effectId !== result.effectRequestId
        || !effectResult
        || !effectMatchesToolRequest(request, descriptor, effectRequest)
      ) {
        fail(
          M2ToolAuthorityErrorCode.RESULT_REQUEST_MISMATCH,
          'ToolResult is not backed by its exact durable effect authority',
          { requestId: result.requestId, effectRequestId: result.effectRequestId },
        );
      }
      const projection = projectM2EffectToolTerminal(
        request,
        descriptor,
        effectRequest,
        effectResult,
        this.getEffectOutputEvidence(effectRequest, effectResult),
      );
      if (!effectProjectionMatches(result, projection)) {
        fail(
          M2ToolAuthorityErrorCode.RESULT_REQUEST_MISMATCH,
          'ToolResult terminal does not exactly project its EffectResult',
          { requestId: result.requestId, effectRequestId: result.effectRequestId },
        );
      }
    } else if (result.effectRequestId !== null) {
      fail(
        M2ToolAuthorityErrorCode.RESULT_REQUEST_MISMATCH,
        'ToolResult references effect authority without an exact durable link',
        { requestId: result.requestId, effectRequestId: result.effectRequestId },
      );
    } else if (result.status === 'ok' && request.authorityMode !== 'direct') {
      fail(
        M2ToolAuthorityErrorCode.RESULT_REQUEST_MISMATCH,
        'Non-direct ToolResult success requires an exact linked effect',
        { requestId: result.requestId },
      );
    }
    const encoded = canonicalizeM2ToolValue(result);
    try {
      this.database.prepare(`
        INSERT INTO tool_v1_results (
          request_id, request_digest, run_id, project_id, tool_id, tool_version,
          status, output_schema, output_json, output_digest, effect_request_id,
          error_json, started_at_ms, completed_at_ms, evidence_json,
          late_completion_rejected, execution_generation, execution_owner_id,
          result_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        result.requestId,
        result.requestDigest,
        result.runId,
        result.projectId,
        result.toolId,
        result.toolVersion,
        result.status,
        result.outputSchema,
        result.output === null ? null : canonicalizeM2ToolValue(result.output),
        result.outputDigest,
        result.effectRequestId,
        result.error === null ? null : canonicalizeM2ToolValue(result.error),
        timestampMs(result.startedAt, 'ToolResult.startedAt'),
        timestampMs(result.completedAt, 'ToolResult.completedAt'),
        canonicalizeM2ToolValue(result.evidenceRefs),
        result.lateCompletionRejected ? 1 : 0,
        executionClaim.generation,
        executionClaim.ownerId,
        encoded,
      );
      return Object.freeze({ created: true, result });
    } catch (error) {
      const existing = this.database.prepare(`
        SELECT result_json FROM tool_v1_results WHERE request_id = ?
      `).get(result.requestId);
      if (existing?.result_json === encoded) {
        return Object.freeze({ created: false, result });
      }
      if (!existing) storageFailure('result commit', error);
      fail(
        M2ToolAuthorityErrorCode.RESULT_CONFLICT,
        'ToolRequest already has a different terminal ToolResult',
        { requestId: result.requestId, cause: error.message },
      );
    }
  }

  getToolResult(requestId) {
    const row = this.database.prepare(`
      SELECT * FROM tool_v1_results WHERE request_id = ?
    `).get(requestId);
    const result = parseStored(row, 'result_json', validateM2ToolResult, 'ToolResult');
    if (!result) return null;
    try {
      const request = this.getToolRequest(requestId);
      const descriptor = request ? registryDescriptorFor(request) : null;
      const exact = request
        && descriptor
        && result.requestId === row.request_id
        && result.requestDigest === row.request_digest
        && result.requestDigest === computeM2ToolRequestDigest(request)
        && result.runId === row.run_id
        && result.projectId === row.project_id
        && result.toolId === row.tool_id
        && result.toolVersion === row.tool_version
        && result.status === row.status
        && result.outputSchema === row.output_schema
        && result.outputSchema === request.outputSchema
        && (result.output === null ? null : canonicalizeM2ToolValue(result.output)) === row.output_json
        && result.outputDigest === row.output_digest
        && result.effectRequestId === row.effect_request_id
        && (result.error === null ? null : canonicalizeM2ToolValue(result.error)) === row.error_json
        && timestampMs(result.startedAt, 'ToolResult.startedAt') === row.started_at_ms
        && timestampMs(result.completedAt, 'ToolResult.completedAt') === row.completed_at_ms
        && canonicalizeM2ToolValue(result.evidenceRefs) === row.evidence_json
        && (result.lateCompletionRejected ? 1 : 0) === row.late_completion_rejected
        && row.execution_generation === this.getToolExecutionClaim(requestId)?.generation
        && row.execution_owner_id === this.getToolExecutionClaim(requestId)?.ownerId
        && row.started_at_ms >= this.getToolExecutionClaim(requestId)?.claimedAtMs
        && (result.status !== 'ok' || descriptor.validateOutput(result.output).length === 0);
      if (!exact) throw new Error('stored ToolResult index, digest or schema mismatch');
      const link = this.getEffectLinkByRequest(requestId);
      if (link) {
        const effectResult = link ? this.getExactEffectResult(link.effectId) : null;
        if (link.effectId !== result.effectRequestId || !effectResult) {
          throw new Error('stored ToolResult effect link mismatch');
        }
        const projection = projectM2EffectToolTerminal(
          request,
          descriptor,
          link.effectRequest,
          effectResult,
          this.getEffectOutputEvidence(link.effectRequest, effectResult),
        );
        if (!effectProjectionMatches(result, projection)) {
          throw new Error('stored ToolResult effect projection mismatch');
        }
      } else if (result.effectRequestId !== null) {
        throw new Error('stored ToolResult references unlinked effect authority');
      } else if (result.status === 'ok' && request.authorityMode !== 'direct') {
        throw new Error('stored non-direct success lacks effect authority');
      }
      return result;
    } catch (error) {
      storageFailure('ToolResult identity read', error);
    }
  }
}

export default M2ToolAuthorityRepository;
