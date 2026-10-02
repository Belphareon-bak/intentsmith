export function searchRows(rows, query) {
  if (!Array.isArray(rows)) return [];
  const q = String(query);
  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const sku = row.sku == null ? '' : String(row.sku);
    const name = row.name == null ? '' : String(row.name);
    if (sku.includes(q) || name.includes(q)) {
      out.push({
        id: row.id,
        sku: row.sku,
        name: row.name,
        quantity: row.quantity,
        priceCents: row.priceCents
      });
    }
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}