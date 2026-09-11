import { registerConversationWebWriter } from '../../network/conversation-web-repository.js';

export const version = '2026_09_11_111_conversation_web';
export const description = 'Single-use conversation HTTPS approval and durable bounded response';

export function up(database) {
  registerConversationWebWriter(database);
  database.exec(`
    CREATE TABLE conversation_web_requests (
      request_id TEXT PRIMARY KEY CHECK (length(request_id) = 68 AND substr(request_id,1,4) = 'web:'),
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      subject_id TEXT NOT NULL CHECK (subject_id = 'local-operator'),
      user_message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      input_digest TEXT NOT NULL CHECK (length(input_digest) = 64),
      url TEXT NOT NULL CHECK (length(CAST(url AS BLOB)) BETWEEN 9 AND 2048),
      created_at_ms INTEGER NOT NULL,
      expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms = created_at_ms + 300000),
      approval_message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
      consumed_at_ms INTEGER,
      status TEXT NOT NULL CHECK (status IN ('pending','executing','succeeded','failed','revoked')),
      http_status INTEGER,
      content_type TEXT,
      resolved_address TEXT,
      output BLOB CHECK (output IS NULL OR (typeof(output) = 'blob' AND length(output) <= 1048576)),
      output_digest TEXT,
      error_code TEXT,
      CHECK ((status = 'succeeded') = (output IS NOT NULL)),
      CHECK ((consumed_at_ms IS NULL) = (approval_message_id IS NULL)),
      CHECK (status NOT IN ('executing','succeeded','failed') OR consumed_at_ms IS NOT NULL),
      CHECK (status != 'succeeded' OR (http_status IS NOT NULL AND http_status = 200
        AND output_digest IS NOT NULL AND length(output_digest) = 64))
    );
    CREATE INDEX conversation_web_conversation ON conversation_web_requests(conversation_id, created_at_ms);
    CREATE UNIQUE INDEX conversation_web_one_executing ON conversation_web_requests(conversation_id) WHERE status = 'executing';
    CREATE TRIGGER conversation_web_insert_writer BEFORE INSERT ON conversation_web_requests
    WHEN conversation_web_writer() != 1 OR NEW.status != 'pending' OR NEW.consumed_at_ms IS NOT NULL
    BEGIN SELECT RAISE(ABORT, 'WEB_TYPED_WRITER_REQUIRED'); END;
    CREATE TRIGGER conversation_web_update_writer BEFORE UPDATE ON conversation_web_requests
    WHEN NEW.status != 'revoked' AND conversation_web_writer() != 1
    BEGIN SELECT RAISE(ABORT, 'WEB_TYPED_WRITER_REQUIRED'); END;
    CREATE TRIGGER conversation_web_immutable BEFORE UPDATE ON conversation_web_requests
    WHEN NEW.request_id IS NOT OLD.request_id OR NEW.conversation_id IS NOT OLD.conversation_id
      OR NEW.subject_id IS NOT OLD.subject_id OR NEW.user_message_id IS NOT OLD.user_message_id
      OR NEW.input_digest IS NOT OLD.input_digest OR NEW.url IS NOT OLD.url
      OR NEW.created_at_ms IS NOT OLD.created_at_ms OR NEW.expires_at_ms IS NOT OLD.expires_at_ms
      OR (OLD.status != 'pending' AND (NEW.consumed_at_ms IS NOT OLD.consumed_at_ms OR NEW.approval_message_id IS NOT OLD.approval_message_id))
      OR NOT ((OLD.status = 'pending' AND NEW.status IN ('executing','revoked'))
        OR (OLD.status = 'executing' AND NEW.status IN ('succeeded','failed','revoked'))
        OR (OLD.status IN ('succeeded','failed') AND NEW.status = 'revoked'))
    BEGIN SELECT RAISE(ABORT, 'WEB_REQUEST_IMMUTABLE'); END;
    CREATE TRIGGER conversation_web_conversation_changed AFTER UPDATE OF state, project_id, deleted_at ON conversations
    WHEN NEW.state IS NOT OLD.state OR NEW.project_id IS NOT OLD.project_id OR NEW.deleted_at IS NOT OLD.deleted_at
    BEGIN
      UPDATE conversation_web_requests SET status = 'revoked', output = NULL, output_digest = NULL, error_code = 'WEB_CONVERSATION_CHANGED'
      WHERE conversation_id = OLD.id AND status != 'revoked';
    END;
    CREATE TRIGGER conversation_web_message_changed AFTER UPDATE OF content, role, conversation_id ON messages
    WHEN NEW.content IS NOT OLD.content OR NEW.role IS NOT OLD.role OR NEW.conversation_id IS NOT OLD.conversation_id
    BEGIN
      UPDATE conversation_web_requests SET status = 'revoked', output = NULL, output_digest = NULL, error_code = 'WEB_MESSAGE_CHANGED'
      WHERE (user_message_id = OLD.id OR approval_message_id = OLD.id) AND status != 'revoked';
    END;
  `);
}
