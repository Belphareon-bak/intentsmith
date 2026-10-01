export function validateTitle(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('title must be a nonblank string');
  }
}

export function validatePriority(value) {
  if (!Number.isInteger(value) || value < 1 || value > 3) {
    throw new TypeError('priority must be an integer between 1 and 3');
  }
}

export function validateId(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError('id must be a positive safe integer');
  }
}

export function validateStatus(value) {
  if (value !== 'todo' && value !== 'doing' && value !== 'done') {
    throw new TypeError('status must be todo, doing or done');
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

export function validatePatch(patch) {
  if (!isPlainObject(patch)) {
    throw new TypeError('patch must be a plain object');
  }
  const keys = Object.keys(patch);
  if (keys.length === 0) {
    throw new TypeError('patch must not be empty');
  }
  for (const key of keys) {
    if (key !== 'title' && key !== 'priority') {
      throw new TypeError(`patch has invalid field: ${key}`);
    }
  }
  if ('title' in patch) validateTitle(patch.title);
  if ('priority' in patch) validatePriority(patch.priority);
}

export function validateOptions(options) {
  if (!isPlainObject(options)) {
    throw new TypeError('options must be a plain object');
  }
  const keys = Object.keys(options);
  for (const key of keys) {
    if (key !== 'status' && key !== 'sort') {
      throw new TypeError(`options has invalid field: ${key}`);
    }
  }
  if ('status' in options) validateStatus(options.status);
  if ('sort' in options && options.sort !== 'created' && options.sort !== 'priority') {
    throw new TypeError('sort must be created or priority');
  }
}
