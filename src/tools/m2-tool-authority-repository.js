import {
  canonicalizeM2ToolValue,
  computeM2ToolRequestDigest,
  validateM2ToolRequest,
  validateM2ToolResult,
} from '../../contracts/m2/tool-v1.js';

export const M2ToolAuthorityErrorCode = Object.freeze({
  INPUT_INVALID: 'TOOL_AUTHORITY_INPUT_INVALID',
  REQUEST_CONFLICT: 'TOOL_REQUEST_CONFLICT',
  REQUEST_NOT_FOUND: 'TOOL_REQUEST_NOT_FOUND',
  RESULT_CONFLICT: 'TOOL_RESULT_CONFLICT',
  RESULT_REQUEST_MISMATCH: 'TOOL_RESULT_REQUEST_MISMATCH',
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

export class M2ToolAuthorityRepository {
  constructor(database) {
    this.database = requireDatabase(database);
  }

  registerToolRequest(requestValue) {
    const request = requireValid(requestValue, validateM2ToolRequest, 'ToolRequest');
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
      SELECT request_json FROM tool_v1_requests WHERE request_id = ?
    `).get(requestId);
    return parseStored(row, 'request_json', validateM2ToolRequest, 'ToolRequest');
  }

  getToolRequestByOperation(runId, idempotencyKey) {
    const row = this.database.prepare(`
      SELECT request_json FROM tool_v1_requests
      WHERE run_id = ? AND idempotency_key = ?
    `).get(runId, idempotencyKey);
    return parseStored(row, 'request_json', validateM2ToolRequest, 'ToolRequest');
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
    const identityMatches = result.requestDigest === requestDigest
      && result.runId === request.runId
      && result.projectId === request.origin.projectId
      && result.toolId === request.toolId
      && result.toolVersion === request.toolVersion;
    if (!identityMatches) {
      fail(
        M2ToolAuthorityErrorCode.RESULT_REQUEST_MISMATCH,
        'ToolResult identity does not match its durable ToolRequest',
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
      SELECT result_json FROM tool_v1_results WHERE request_id = ?
    `).get(requestId);
    return parseStored(row, 'result_json', validateM2ToolResult, 'ToolResult');
  }
}

export default M2ToolAuthorityRepository;
