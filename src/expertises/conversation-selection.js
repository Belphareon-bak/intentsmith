import { createHash } from 'node:crypto';
import { mergeExpertisePrompt } from './merge-engine.js';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export class ConversationSelectionError extends Error {
  constructor(message, status = 400, code = 'EXPERTISE_SELECTION_INVALID') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function revision(rows) {
  const canonical = rows.map(row => [row.id, row.weight]);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function readConversationSelection(database, conversationId) {
  if (typeof conversationId !== 'string' || !ID.test(conversationId)) {
    throw new ConversationSelectionError('Invalid conversation ID');
  }
  const rows = database.conversationExpertises.getExpertises(conversationId)
    .map(row => ({ id: row.expertise_id, weight: row.weight }));
  if (rows.length > 3 || new Set(rows.map(row => row.id)).size !== rows.length
    || rows.some(row => typeof row.id !== 'string' || !ID.test(row.id)
      || !Number.isFinite(row.weight) || row.weight < 0.1 || row.weight > 1)) {
    throw new ConversationSelectionError('Stored expertise selection is invalid', 409,
      'EXPERTISE_SELECTION_CORRUPT');
  }
  return { conversationId, expertises: rows, revision: revision(rows) };
}

/** A durable selection for future turns; no caller supplied prompt reaches ChatController. */
export function writeConversationSelection(database, registry, conversationId, request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)
    || !Array.isArray(request.expertises) || request.expertises.length > 3
    || typeof request.expectedRevision !== 'string') {
    throw new ConversationSelectionError('Expected a revision and zero to three expertises');
  }
  readConversationSelection(database, conversationId);
  const ids = new Set();
  const selected = request.expertises.map((item, position) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || typeof item.id !== 'string' || !ID.test(item.id) || ids.has(item.id)
      || typeof item.weight !== 'number' || !Number.isFinite(item.weight)
      || item.weight < 0.1 || item.weight > 1) {
      throw new ConversationSelectionError(`Invalid expertise at position ${position + 1}`);
    }
    ids.add(item.id);
    const registered = registry?.get(item.id);
    if (!registered) throw new ConversationSelectionError(`Unknown expertise: ${item.id}`, 404, 'EXPERTISE_NOT_FOUND');
    const definition = typeof registered.toJSON === 'function' ? registered.toJSON() : structuredClone(registered);
    return { id: item.id, weight: item.weight, definition: { ...definition, weight: item.weight } };
  });
  let preview = null;
  if (selected.length > 1) {
    try {
      const merged = mergeExpertisePrompt(selected.map(item => item.definition), null, null, { registry });
      preview = { compatibility: merged.metadata.compatibility,
        requiresConfirmation: merged.metadata.requiresConfirmation === true,
        promptPreview: merged.prompt.slice(0, 500) };
    } catch (error) {
      if (error.name === 'CompatibilityBlockError') {
        throw new ConversationSelectionError('Incompatible expertise combination', 409, 'EXPERTISE_INCOMPATIBLE');
      }
      throw error;
    }
    if (preview.requiresConfirmation && request.confirmCompatibility !== true) {
      throw new ConversationSelectionError('Combination requires explicit confirmation', 409, 'EXPERTISE_CONFIRMATION_REQUIRED');
    }
  }
  const projectId = request.projectId == null ? null : Number(request.projectId);
  if (projectId !== null && (!Number.isSafeInteger(projectId) || projectId < 1
    || !database.projects.findById.get(projectId))) {
    throw new ConversationSelectionError('Unknown project', 404, 'PROJECT_NOT_FOUND');
  }
  if (projectId !== null) {
    throw new ConversationSelectionError('Project conversations currently use the project handler', 409,
      'EXPERTISE_PROJECT_MODE_UNSUPPORTED');
  }
  const commit = database.db.transaction(() => {
    const before = readConversationSelection(database, conversationId);
    if (before.revision !== request.expectedRevision) {
      throw new ConversationSelectionError('Expertise selection changed; reload before saving', 409, 'EXPERTISE_REVISION_CONFLICT');
    }
    const conversation = database.conversations.findById.get(conversationId);
    if (conversation?.project_id != null && projectId !== null && Number(conversation.project_id) !== projectId) {
      throw new ConversationSelectionError('Conversation belongs to another project', 409, 'CONVERSATION_PROJECT_CONFLICT');
    }
    if (conversation?.project_id != null) {
      throw new ConversationSelectionError('Project conversations currently use the project handler', 409,
        'EXPERTISE_PROJECT_MODE_UNSUPPORTED');
    }
    if (!conversation) database.conversations.create.run(conversationId, projectId, null, null);
    database.conversationExpertises.setExpertises(conversationId,
      selected.map((item, position) => ({ id: item.id, weight: item.weight, position })));
    return readConversationSelection(database, conversationId);
  });
  return { ...commit(), preview };
}
