// Connection-local retrieval cache. Original messages remain authoritative;
// neither this FTS index nor its temporal neighbours grant action authority.
const indexes = new WeakMap();
const MAX_CACHED_CONVERSATIONS = 4;

export function archiveTerms(text) {
  return [...new Set(String(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .match(/[\p{L}\p{N}_]{3,}/gu)?.map(word => word.length > 4 ? word.slice(0, 4) : word) || [])];
}

export function getArchiveIndex(database) {
  let index = indexes.get(database);
  if (index) return index;
  // TEMP only: no migration, persistent messages or model policy is changed.
  database.exec(`
    CREATE VIRTUAL TABLE temp.chat_archive_search USING fts5(content, conversation_id UNINDEXED,
      tokenize='unicode61 remove_diacritics 2', prefix='3 4');
    CREATE TEMP TRIGGER chat_archive_search_delete AFTER DELETE ON main.messages BEGIN
      DELETE FROM chat_archive_search WHERE rowid = old.id;
    END;
    CREATE TEMP TRIGGER chat_archive_search_update AFTER UPDATE OF content, metadata, role, conversation_id, id
      ON main.messages WHEN EXISTS(SELECT 1 FROM chat_archive_search WHERE rowid = old.id) BEGIN
      DELETE FROM chat_archive_search WHERE rowid = old.id;
      INSERT INTO chat_archive_search(rowid, content, conversation_id)
        SELECT new.id, new.content, new.conversation_id WHERE new.role = 'user';
    END;
  `);
  const scopes = new Map();
  let version = database.pragma('data_version', { simple: true });
  const fill = database.prepare(`INSERT OR REPLACE INTO temp.chat_archive_search(rowid, content, conversation_id)
    SELECT id, content, conversation_id FROM main.messages
    WHERE conversation_id = ? AND role = 'user' AND id > ? AND id <= ? ORDER BY id`);
  index = {
    prepare(id, upTo) {
      const current = database.pragma('data_version', { simple: true });
      // TEMP triggers see writes on this connection only. Other connections
      // invalidate the cache, including edits/deletes, before any selection.
      if (current !== version) {
        database.prepare('DELETE FROM temp.chat_archive_search').run();
        scopes.clear(); version = current;
      }
      let after = scopes.get(id) || 0;
      if (after > upTo) {
        database.prepare('DELETE FROM temp.chat_archive_search WHERE conversation_id = ?').run(id);
        after = 0;
      }
      if (upTo > after) fill.run(id, after, upTo);
      scopes.delete(id); scopes.set(id, upTo);
      while (scopes.size > MAX_CACHED_CONVERSATIONS) {
        const evicted = scopes.keys().next().value;
        database.prepare('DELETE FROM temp.chat_archive_search WHERE conversation_id = ?').run(evicted);
        scopes.delete(evicted);
      }
    },
    candidates(id, upTo, projectId, terms) {
      if (!terms.length) return [];
      // Terms are tokenized data; quote each one rather than interpreting user
      // operators as FTS syntax. SQL parameters carry the complete expression.
      const expression = terms.map(term => `"${term.replaceAll('"', '""')}"*`).join(' OR ');
      // Force FTS first: the conversation index otherwise makes SQLite repeat
      // a full MATCH scan for each main-table row on dense terms.
      const query = `SELECT m.id, m.content, m.metadata FROM temp.chat_archive_search AS f
        CROSS JOIN main.messages AS m
        WHERE m.id = f.rowid AND chat_archive_search MATCH ? AND m.conversation_id = ? AND m.role = 'user' AND m.id <= ?
        AND CASE WHEN json_valid(m.metadata) THEN json_type(m.metadata, '$.projectId') END IS NOT NULL
        AND CASE WHEN json_valid(m.metadata) THEN json_extract(m.metadata, '$.projectId') END IS ?`;
      // Bounded ranking shortlist plus latest/oldest anchors. Original content
      // is re-read from main.messages; no cached text is exposed to the model.
      const params = [expression, id, upTo, projectId];
      const rows = database.prepare(query + ' ORDER BY bm25(chat_archive_search), m.id DESC LIMIT 16').all(...params);
      rows.push(...database.prepare(query + ' ORDER BY m.id DESC LIMIT 1').all(...params),
        ...database.prepare(query + ' ORDER BY m.id ASC LIMIT 1').all(...params));
      return [...new Map(rows.map(row => [row.id, row])).values()];
    },
  };
  indexes.set(database, index);
  return index;
}
