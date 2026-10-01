// Trusted offline controls only. Physical model journey never imports these bytes.
export const REFERENCE_LEDGER_OUTPUTS = Object.freeze({
  'src/app.js': "export { run } from './cli.js';\n",
  'src/cli.js': `import { createService } from './service.js';
export function run(commands) {
  const service = createService();
  return commands.map(([operation, ...args]) => {
    if (operation === 'add') return service.add(...args);
    if (operation === 'list') return service.list();
    if (operation === 'total') return service.total();
    if (operation === 'categories') return service.categories();
    throw new Error('unknown operation');
  });
}
`,
  'src/service.js': `import { createLedger } from './storage.js';
import { total, categories } from './totals.js';
export function createService() {
  const ledger = createLedger();
  return { add: (amount, category) => ledger.add(amount, category), list: () => ledger.list(),
    total: () => total(ledger.list()), categories: () => categories(ledger.list()) };
}
`,
  'src/storage.js': `import { validate } from './validate.js';
export function createLedger() {
  const rows = [];
  return { add(amount, category) { validate(amount, category); const row = { amount, category };
    rows.push(row); return { ...row }; }, list() { return rows.map(row => ({ ...row })); } };
}
`,
  'src/totals.js': `export function total(rows) { return rows.reduce((sum, row) => sum + row.amount, 0); }
export function categories(rows) { const result = {}; for (const row of rows)
  result[row.category] = (result[row.category] ?? 0) + row.amount; return result; }
`,
  'src/validate.js': `export function validate(amount, category) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0
    || typeof category !== 'string' || !category.trim()) throw new TypeError('invalid expense');
}
`,
});
