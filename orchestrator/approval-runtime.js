const approvals = new Map();

export function createApproval(id) {
  return new Promise((resolve, reject) => {
    approvals.set(id, { resolve, reject });
  });
}

export function resolveApproval(id, approved) {
  const entry = approvals.get(id);
  if (!entry) return false;

  entry.resolve(Boolean(approved));
  approvals.delete(id);
  return true;
}
