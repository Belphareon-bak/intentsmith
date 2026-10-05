/**
 * validation.mjs
 * Pure input normalization and validation for the item service.
 */

const MAX_NAME_LENGTH = 80;
const MIN_QUANTITY = 0;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER; // 9007199254740991

/**
 * Creates a typed error for invalid input.
 * @param {string} message - Error description.
 * @returns {Error}
 */
function createInvalidInputError(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = 'invalid_input';
  return err;
}

/**
 * Checks if a string contains any NUL characters.
 * @param {string} str - The string to check.
 * @returns {boolean}
 */
function hasNul(str) {
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) === 0) return true;
  }
  return false;
}

/**
 * Checks if a string contains any lone surrogates.
 * @param {string} str - The string to check.
 * @returns {boolean}
 */
function hasLoneSurrogate(str) {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate, must be followed by low surrogate
      if (i + 1 >= str.length || !(str.charCodeAt(i + 1) >= 0xdc00 && str.charCodeAt(i + 1) <= 0xdfff)) {
        return true;
      }
      i++; // Skip the low surrogate
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      // Low surrogate without preceding high surrogate
      return true;
    }
  }
  return false;
}

/**
 * Validates and normalizes a single item input object.
 * @param {*} value - The raw input value.
 * @returns {{name: string, quantity: number}} Canonical item without id.
 */
export function normalizeItemInput(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw createInvalidInputError('Input must be a non-null object');
  }

  const keys = Object.keys(value);
  if (keys.length !== 2) {
    throw createInvalidInputError('Exactly two keys required: name and quantity');
  }

  if (!Object.prototype.hasOwnProperty.call(value, 'name') || !Object.prototype.hasOwnProperty.call(value, 'quantity')) {
    throw createInvalidInputError('Keys must be exactly name and quantity');
  }

  const { name, quantity } = value;

  // Validate name
  if (typeof name !== 'string') {
    throw createInvalidInputError('name must be a string');
  }

  const trimmedName = name.trim();

  if (hasNul(trimmedName)) {
    throw createInvalidInputError('name must not contain NUL characters');
  }

  if (hasLoneSurrogate(trimmedName)) {
    throw createInvalidInputError('name must be valid Unicode without lone surrogates');
  }

  // Count code points
  let codePointCount = 0;
  for (const _ of trimmedName) {
    codePointCount++;
  }

  if (codePointCount < 1 || codePointCount > MAX_NAME_LENGTH) {
    throw createInvalidInputError('name must be between 1 and 80 Unicode code points');
  }

  // Validate quantity
  if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity)) {
    throw createInvalidInputError('quantity must be a safe integer');
  }

  if (quantity < MIN_QUANTITY || quantity > MAX_SAFE_INTEGER) {
    throw createInvalidInputError('quantity must be between 0 and 9007199254740991');
  }

  return { name: trimmedName, quantity };
}

/**
 * Parses and validates an item ID from a raw string.
 * @param {*} raw - The raw ID value (expected to be a string).
 * @returns {number} Canonical positive safe integer ID.
 */
export function parseItemId(raw) {
  if (typeof raw !== 'string') {
    throw createInvalidInputError('ID must be a string');
  }

  // Must match canonical decimal format: one or more digits, no leading zeros unless the number is exactly "0" (but ID must be positive)
  // Actually, API says: "Decimal id URL is canonical positive safe integer (no zero/leading zero/sign/fraction/encoded component)."
  // So it must match /^[1-9][0-9]*$/
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw createInvalidInputError('ID must be a canonical positive integer string');
  }

  const id = Number(raw);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw createInvalidInputError('ID must be a positive safe integer');
  }

  return id;
}

/**
 * Validates and normalizes a batch input object.
 * @param {*} value - The raw batch input value.
 * @returns {Array<{name: string, quantity: number}>} Array of canonical item inputs in original order.
 */
export function normalizeBatchInput(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw createInvalidInputError('Batch input must be a non-null object');
  }

  const keys = Object.keys(value);
  if (keys.length !== 1) {
    throw createInvalidInputError('Exactly one key required: items');
  }

  if (!Object.prototype.hasOwnProperty.call(value, 'items')) {
    throw createInvalidInputError('Key must be exactly items');
  }

  const { items } = value;

  if (!Array.isArray(items)) {
    throw createInvalidInputError('items must be an array');
  }

  if (items.length < 1 || items.length > 8) {
    throw createInvalidInputError('items must contain between 1 and 8 elements');
  }

  const normalizedItems = [];
  for (const item of items) {
    normalizedItems.push(normalizeItemInput(item));
  }

  return normalizedItems;
}
