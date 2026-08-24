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
} from '../../contracts/m2/effect-v1.js';
import {
  getM2ToolDescriptor,
  projectM2EffectToolTerminal,
} from './m2-tool-registry.js';

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
  const descriptor = getM2ToolDescriptor(request.toolId);
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

export class M2ToolAuthorityRepository {
  constructor(database, { clock = Date.now } = {}) {
    this.database = requireDatabase(database);
    this.clock = clock;
    if (typeof clock !== 'function') {
      fail(M2ToolAuthorityErrorCode.INPUT_INVALID, 'A trusted tool authority clock is required');
    }
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

  recordToolResult(resultValue) {
    const result = requireValid(resultValue, validateM2ToolResult, 'ToolResult');
    const request = this.getToolRequest(result.requestId);
    if (!request) {
      fail(M2ToolAuthorityErrorCode.REQUEST_NOT_FOUND, 'ToolResult has no stored ToolRequest', {
        requestId: result.requestId,
      });
    }
    const requestDigest = computeM2ToolRequestDigest(request);
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
    if (result.effectRequestId !== null) {
      const link = this.getEffectLinkByRequest(request.requestId);
      const effectRequest = link?.effectRequest || null;
      const effectResult = effectRequest
        ? this.getExactEffectResult(effectRequest.effectId)
        : null;
      if (
        !link
        || link.effectId !== result.effectRequestId
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
      );
      if (!effectProjectionMatches(result, projection)) {
        fail(
          M2ToolAuthorityErrorCode.RESULT_REQUEST_MISMATCH,
          'ToolResult terminal does not exactly project its EffectResult',
          { requestId: result.requestId, effectRequestId: result.effectRequestId },
        );
      }
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
          late_completion_rejected, result_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        && (result.status !== 'ok' || descriptor.validateOutput(result.output).length === 0);
      if (!exact) throw new Error('stored ToolResult index, digest or schema mismatch');
      if (result.effectRequestId !== null) {
        const link = this.getEffectLinkByRequest(requestId);
        const effectResult = link ? this.getExactEffectResult(link.effectId) : null;
        if (!link || link.effectId !== result.effectRequestId || !effectResult) {
          throw new Error('stored ToolResult effect link mismatch');
        }
        const projection = projectM2EffectToolTerminal(
          request,
          descriptor,
          link.effectRequest,
          effectResult,
        );
        if (!effectProjectionMatches(result, projection)) {
          throw new Error('stored ToolResult effect projection mismatch');
        }
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
