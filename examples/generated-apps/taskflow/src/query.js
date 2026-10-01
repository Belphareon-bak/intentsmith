export function select(tasks, options) {
  if (!Array.isArray(tasks)) throw new TypeError('tasks must be an array');
  const opts = options && typeof options === 'object' ? options : {};

  let rows = tasks.filter((row) => {
    if (opts.status !== undefined && row.status !== opts.status) return false;
    return true;
  });

  const sort = opts.sort === 'priority' ? 'priority' : 'created';

  rows = rows.slice().sort((a, b) => {
    if (sort === 'priority') {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.id - b.id;
    }
    return a.id - b.id;
  });

  return rows.map((row) => ({ id: row.id, title: row.title, priority: row.priority, status: row.status }));
}
