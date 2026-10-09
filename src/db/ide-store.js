// Small durable settings store. It records metadata, never credentials or code.
export function ideError(code, status = 400) { return Object.assign(new Error(code), { code, httpStatus: status }); }
export function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))) throw ideError('IDE_INPUT_INVALID');
  return value;
}
export function textField(value, maximum = 200, empty = false) {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > maximum || /[\x00-\x1f]/.test(value))
    throw ideError('IDE_TEXT_INVALID');
  return value.trim();
}
export function identifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value)) throw ideError('IDE_ID_INVALID');
  return value;
}
export function createIdeStore(db, clock = Date.now) {
  function get(kind, id) {
    const row = db.prepare('SELECT * FROM ide_documents WHERE kind=? AND id=?').get(kind, id);
    return row ? { ...JSON.parse(row.data_json), id, revision: row.revision, updatedAt: row.updated_at } : null;
  }
  const event = (kind, id, actor, action) => db.prepare(
    'INSERT INTO ide_events(kind,document_id,actor_id,action,occurred_at) VALUES(?,?,?,?,?)').run(kind, id, actor, action, clock());
  function put(kind, id, revision, data, actor) {
    if (!Number.isSafeInteger(revision) || revision < 0 || !actor) throw ideError('IDE_REVISION_REQUIRED');
    if(['id','revision','updatedAt'].some(key=>Object.hasOwn(data,key)))throw ideError('IDE_RESERVED_FIELD');
    identifier(id);
    return db.transaction(() => {
      if(db.prepare('SELECT 1 FROM ide_document_tombstones WHERE kind=? AND id=?').get(kind,id))
        throw ideError('IDE_ID_RETIRED',409);
      const before = get(kind, id);
      if ((before?.revision ?? 0) !== revision) throw ideError('IDE_REVISION_STALE', 409);
      db.prepare(`INSERT INTO ide_documents VALUES(?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET
        revision=excluded.revision,data_json=excluded.data_json,updated_at=excluded.updated_at`)
        .run(kind, id, revision + 1, JSON.stringify(data), clock());
      event(kind, id, actor, before ? 'updated' : 'created');
      return get(kind, id);
    }).immediate();
  }
  function remove(kind, id, revision, actor) {
    return db.transaction(() => {
      const before = get(kind, id);
      if (!before) throw ideError('IDE_DOCUMENT_NOT_FOUND', 404);
      if (before.revision !== revision) throw ideError('IDE_REVISION_STALE', 409);
      db.prepare('DELETE FROM ide_documents WHERE kind=? AND id=?').run(kind, id);
      db.prepare('INSERT INTO ide_document_tombstones VALUES(?,?,?)').run(kind,id,clock());
      event(kind, id, actor, 'deleted');
      return { removed: true, id };
    }).immediate();
  }
  return { get, put, remove, event,
    list: kind => db.prepare('SELECT id FROM ide_documents WHERE kind=? ORDER BY id').all(kind).map(row => get(kind,row.id)) };
}
