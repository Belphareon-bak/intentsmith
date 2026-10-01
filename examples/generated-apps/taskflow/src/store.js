import { validateTitle, validatePriority, validateId, validateStatus, validatePatch, validateOptions } from './validate.js';
import { select } from './query.js';

export function createBoard() {
  let nextId = 1;
  const tasks = new Map();

  return {
    add(title, priority) {
      validateTitle(title);
      validatePriority(priority);
      const id = nextId++;
      const task = { id, title: String(title), priority, status: 'todo' };
      tasks.set(id, task);
      return { ...task };
    },

    update(id, patch) {
      validateId(id);
      validatePatch(patch);
      const existing = tasks.get(id);
      if (!existing) throw new TypeError(`unknown id: ${id}`);
      if ('title' in patch) existing.title = String(patch.title);
      if ('priority' in patch) existing.priority = patch.priority;
      return { ...existing };
    },

    transition(id, status) {
      validateId(id);
      validateStatus(status);
      const existing = tasks.get(id);
      if (!existing) throw new TypeError(`unknown id: ${id}`);
      const allowed = {
        todo: ['doing'],
        doing: ['done']
      };
      if (!(allowed[existing.status] || []).includes(status)) {
        throw new TypeError(`illegal transition from ${existing.status} to ${status}`);
      }
      existing.status = status;
      return { ...existing };
    },

    remove(id) {
      validateId(id);
      if (!tasks.has(id)) throw new TypeError(`unknown id: ${id}`);
      tasks.delete(id);
      return true;
    },

    list(options = {}) {
      validateOptions(options);
      const all = Array.from(tasks.values());
      return select(all, options);
    }
  };
}
