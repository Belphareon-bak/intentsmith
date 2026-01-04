const pending = new Map();

export function createApproval(preview) {
  const id = crypto.randomUUID();
  let resolve;
  const promise = new Promise(r => (resolve = r));
  pending.set(id, { resolve, preview });
  return { id, promise };
}

export function resolveApproval(id, ok) {
  const rec = pending.get(id);
  if (!rec) return false;
  rec.resolve(ok);
  pending.delete(id);
  return true;
}

export function listApprovals() {
  return [...pending.entries()].map(([id, v]) => ({ id, preview: v.preview }));
}
