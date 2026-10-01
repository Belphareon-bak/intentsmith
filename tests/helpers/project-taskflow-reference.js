// Offline CPU controls only. These bytes never enter the physical model journey.
export const REFERENCE_TASKFLOW_OUTPUTS = Object.freeze({
  'src/app.js': "export { run } from './cli.js';\n",
  'src/cli.js': `import { createBoard } from './store.js';
export function run(commands) {
  if (!Array.isArray(commands)) throw new TypeError('commands');
  const board = createBoard();
  return commands.map(command => {
    if (!Array.isArray(command)) throw new TypeError('tuple');
    const [op, ...args] = command;
    if (op === 'add' && args.length === 2) return board.add(...args);
    if (op === 'update' && args.length === 2) return board.update(...args);
    if (op === 'transition' && args.length === 2) return board.transition(...args);
    if (op === 'remove' && args.length === 1) return board.remove(...args);
    if (op === 'list' && args.length <= 1) return board.list(...args);
    throw new TypeError('unknown operation or arity');
  });
}
`,
  'src/store.js': `import { validateTitle, validatePriority, validateId, validateStatus, validatePatch, validateOptions } from './validate.js';
import { select } from './query.js';
export function createBoard() {
  let nextId = 1;
  const rows = [];
  const copy = row => ({ id: row.id, title: row.title, priority: row.priority, status: row.status });
  const find = id => { validateId(id); const row = rows.find(row => row.id === id);
    if (!row) throw new TypeError('unknown id'); return row; };
  return {
    add(title, priority) { validateTitle(title); validatePriority(priority);
      const row = { id: nextId++, title, priority, status: 'todo' }; rows.push(row); return copy(row); },
    update(id, patch) { const row = find(id); validatePatch(patch);
      if (Object.hasOwn(patch, 'title')) row.title = patch.title;
      if (Object.hasOwn(patch, 'priority')) row.priority = patch.priority;
      return copy(row); },
    transition(id, status) { const row = find(id); validateStatus(status);
      if (!((row.status === 'todo' && status === 'doing') || (row.status === 'doing' && status === 'done')))
        throw new TypeError('illegal transition'); row.status = status; return copy(row); },
    remove(id) { find(id); rows.splice(rows.findIndex(row => row.id === id), 1); return true; },
    list(options = {}) { validateOptions(options); return select(rows, options); },
  };
}
`,
  'src/query.js': `export function select(tasks, options) {
  const rows = tasks.filter(row => options.status === undefined || row.status === options.status)
    .map(row => ({ id: row.id, title: row.title, priority: row.priority, status: row.status }));
  rows.sort(options.sort === 'priority'
    ? (a, b) => b.priority - a.priority || a.id - b.id
    : (a, b) => a.id - b.id);
  return rows;
}
`,
  'src/validate.js': `const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
export function validateTitle(value) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('title');
}
export function validatePriority(value) {
  if (!Number.isInteger(value) || value < 1 || value > 3) throw new TypeError('priority');
}
export function validateId(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError('id');
}
export function validateStatus(value) {
  if (!['todo', 'doing', 'done'].includes(value)) throw new TypeError('status');
}
export function validatePatch(value) {
  if (!plain(value)) throw new TypeError('patch');
  const keys = Object.keys(value);
  if (!keys.length || keys.some(key => !['title', 'priority'].includes(key))) throw new TypeError('patch keys');
  if (Object.hasOwn(value, 'title')) validateTitle(value.title);
  if (Object.hasOwn(value, 'priority')) validatePriority(value.priority);
}
export function validateOptions(value) {
  if (!plain(value) || Object.keys(value).some(key => !['status', 'sort'].includes(key)))
    throw new TypeError('options');
  if (Object.hasOwn(value, 'status')) validateStatus(value.status);
  if (Object.hasOwn(value, 'sort') && !['created', 'priority'].includes(value.sort))
    throw new TypeError('sort');
}
`,
});

export function taskflowMutant(name, reference = REFERENCE_TASKFLOW_OUTPUTS) {
  const outputs = { ...reference };
  const alter = (file, before, after) => {
    if (!outputs[file].includes(before)) throw new Error('missing mutant anchor ' + name);
    outputs[file] = outputs[file].replace(before, after);
  };
  if (name === 'shared-board') {
    alter('src/cli.js', 'export function run(commands) {', 'const board = createBoard();\nexport function run(commands) {');
    alter('src/cli.js', '  const board = createBoard();\n  return commands.map', '  return commands.map');
  }
  else if (name === 'accept-nonplain') alter('src/validate.js',
    '  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)', '');
  else if (name === 'accept-nonplain-options') alter('src/validate.js',
    'if (!plain(value) ||',
    "if (!(value !== null && typeof value === 'object' && !Array.isArray(value)) ||");
  else if (name === 'ignore-status') alter('src/query.js', 'options.status === undefined || row.status === options.status', 'true');
  else if (name === 'wrong-priority') alter('src/query.js', 'b.priority - a.priority || a.id - b.id', 'a.priority - b.priority || a.id - b.id');
  else if (name === 'recycle-id') alter('src/store.js', 'id: nextId++', 'id: rows.length + 1');
  else if (name === 'skip-transition') alter('src/store.js', "row.status === 'todo' && status === 'doing'", "row.status === 'todo' && ['doing', 'done'].includes(status)");
  else if (name === 'alias-rows') alter('src/query.js', '.map(row => ({ id: row.id, title: row.title, priority: row.priority, status: row.status }))', '.map(row => row)');
  else if (name === 'no-op-remove') alter('src/store.js', 'rows.splice(rows.findIndex(row => row.id === id), 1); return true;', 'return true;');
  else if (name === 'ignore-update') alter('src/store.js', "row.title = patch.title", 'row.title = row.title');
  else if (name === 'last-result') alter('src/cli.js', '  });\n}', '  }).at(-1);\n}');
  else throw new Error('unknown TaskFlow mutant');
  return outputs;
}
