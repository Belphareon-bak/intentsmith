export function total(rows) {
  if (!Array.isArray(rows)) return 0;
  let sum = 0;
  for (const row of rows) {
    const amount = row && typeof row.amount === 'number' ? row.amount : NaN;
    if (Number.isFinite(amount)) sum += amount;
  }
  return sum;
}

export function categories(rows) {
  const out = {};
  if (!Array.isArray(rows)) return out;
  for (const row of rows) {
    if (!row || typeof row.category !== 'string') continue;
    const amount = typeof row.amount === 'number' ? row.amount : NaN;
    if (!Number.isFinite(amount)) continue;
    out[row.category] = (out[row.category] ?? 0) + amount;
  }
  return out;
}
