import { canonicalStringify, computeEffectRequestDigest } from '../../contracts/m2/effect-current.js';
import {
  createM2FileListOutputEvidence, isM2FileListOutputRequest, m2FileListConversationOrigin,
  m2FileListOutputBytesMatch, validateM2FileListOutputEvidence,
} from '../../contracts/m2/file-list-output-v1.js';

function invalid(reason) {
  throw Object.assign(new Error(`Immutable listing output rejected: ${reason}`), {
    code: 'EFFECT_FILE_LIST_OUTPUT_INVALID',
  });
}

export function registerM2FileListOutputFunctions(database) {
  database.function('m2_file_list_conversation_origin_v1', { deterministic: true }, value => {
    try { return m2FileListConversationOrigin(value); } catch { return null; }
  });
  database.function('m2_file_list_output_request_v1', { deterministic: true }, requestJson => {
    try { return isM2FileListOutputRequest(JSON.parse(requestJson)) ? 1 : 0; } catch { return 0; }
  });
  database.function('m2_file_list_output_bytes_match_v1', { deterministic: true },
    (requestJson, metadataJson, bytes) => {
      try {
        const metadata = JSON.parse(metadataJson);
        return metadataJson === canonicalStringify(metadata)
          && m2FileListOutputBytesMatch(JSON.parse(requestJson), metadata, bytes) ? 1 : 0;
      } catch { return 0; }
    });
  database.function('m2_file_list_output_result_match_v1', { deterministic: true },
    (requestJson, resultJson, metadataJson) => {
      try {
        return validateM2FileListOutputEvidence(
          JSON.parse(requestJson), JSON.parse(resultJson), JSON.parse(metadataJson),
        ) ? 1 : 0;
      } catch { return 0; }
    });
}

// Explicit request/result arguments make provenance visible at every caller.
// This function does not authorize a UI caller; it verifies durable bytes for
// the canonical projection. The public resolver additionally checks its caller.
export function readM2FileListOutput(database, request, result) {
  if (!isM2FileListOutputRequest(request) || result?.terminalStatus !== 'succeeded') return null;
  const row = database.prepare(`
    SELECT effect_id, project_id, conversation_id, project_path, request_digest, metadata_json, payload
    FROM m2_file_list_outputs WHERE effect_id = ?
  `).get(request.effectId);
  if (!row) invalid('successful read has no immutable output');
  const metadata = JSON.parse(row.metadata_json);
  const tombstone = database.prepare('SELECT * FROM m2_file_list_output_tombstones WHERE effect_id = ?').get(request.effectId);
  if (row.effect_id !== request.effectId || row.project_id !== request.origin.projectId
    || row.request_digest !== computeEffectRequestDigest(request)
    || row.project_path !== request.target.canonicalRoot
    || row.metadata_json !== canonicalStringify(metadata)
    || m2FileListConversationOrigin(row.conversation_id) !== request.origin.conversationId
    || (tombstone ? row.payload !== null : !m2FileListOutputBytesMatch(request, metadata, row.payload))
    || !validateM2FileListOutputEvidence(request, result, metadata)) invalid('stored bytes or binding');
  return Object.freeze({ evidence: Object.freeze(metadata), bytes: tombstone ? null : Buffer.from(row.payload),
    conversationId: row.conversation_id, projectPath: row.project_path, contentDeleted: Boolean(tombstone) });
}

export class EffectFileListOutputRepository {
  constructor(authorityRepository) {
    if (!authorityRepository?.db || typeof authorityRepository.recordEffectResult !== 'function') {
      invalid('canonical effect authority repository required');
    }
    this.authorityRepository = authorityRepository;
    this.database = authorityRepository.db;
    registerM2FileListOutputFunctions(this.database);
  }

  recordSuccessfulFileList({ request, result, bytes }) {
    const exactRequest = this.authorityRepository.getEffectRequest(request?.effectId);
    if (!exactRequest || canonicalStringify(exactRequest) !== canonicalStringify(request)) {
      invalid('caller request differs from durable authority');
    }
    if (!Buffer.isBuffer(bytes)) invalid('provider bytes must be a Buffer');
    const payload = Buffer.from(bytes);
    const evidence = createM2FileListOutputEvidence(exactRequest, result, payload);
    const transaction = this.database.transaction(() => {
      const existing = this.authorityRepository.getEffectResult(request.effectId);
      if (existing) {
        const output = readM2FileListOutput(this.database, exactRequest, existing);
        if (canonicalStringify(existing) !== canonicalStringify(result)
          || !output?.bytes?.equals(payload)) invalid('terminal replay conflict');
        return existing;
      }
      const parent = this.database.prepare(`
        SELECT conversation.id AS conversationId, project.path AS projectPath
        FROM conversations conversation JOIN projects project ON project.id = conversation.project_id
        WHERE m2_file_list_conversation_origin_v1(conversation.id) = ? AND project.id = ? AND project.path = ?
          AND conversation.state IN ('active', 'archived') AND project.status IN ('active', 'archived')
      `).get(request.origin.conversationId, request.origin.projectId, request.target.canonicalRoot);
      if (!parent) invalid('current registered project conversation required');
      this.database.prepare(`
        INSERT INTO m2_file_list_outputs(effect_id, project_id, conversation_id, project_path,
          request_digest, metadata_json, payload) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(request.effectId, request.origin.projectId, parent.conversationId, parent.projectPath,
        result.requestDigest, canonicalStringify(evidence), payload);
      // Existing exact grant, execution claim, result semantics and audit
      // checks remain the owner of terminal authority. Failure rolls back bytes.
      this.authorityRepository.recordEffectResult(result);
      readM2FileListOutput(this.database, exactRequest, result);
      return result;
    });
    return transaction.immediate();
  }
}
