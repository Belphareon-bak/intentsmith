export function validateSku(value) {
  if (typeof value !== 'string') throw new TypeError('sku must be a string');
  if (value.trim() === '') throw new TypeError('sku must not be whitespace-only');
}

export function validateName(value) {
  if (typeof value !== 'string') throw new TypeError('name must be a string');
  if (value.trim() === '') throw new TypeError('name must not be whitespace-only');
}

export function validateQuantity(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError('quantity must be a safe integer');
  if (value < 0) throw new TypeError('quantity must be nonnegative');
}

export function validatePriceCents(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError('priceCents must be a safe integer');
  if (value < 0) throw new TypeError('priceCents must be nonnegative');
}

export function validateId(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError('id must be a safe integer');
  if (value <= 0) throw new TypeError('id must be positive');
}

export function validateQuery(value) {
  if (typeof value !== 'string') throw new TypeError('query must be a string');
  if (value.trim() === '') throw new TypeError('query must not be whitespace-only');
}

const PATCH_FIELDS = ['name', 'quantity', 'priceCents'];

export function validatePatch(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('patch must be a plain object');
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new TypeError('patch must be a plain object');
  const keys = Object.keys(value);
  if (keys.length === 0) throw new TypeError('patch must not be empty');
  for (const key of keys) {
    if (!PATCH_FIELDS.includes(key)) throw new TypeError(`unknown patch field: ${key}`);
  }
  if ('name' in value) validateName(value.name);
  if ('quantity' in value) validateQuantity(value.quantity);
  if ('priceCents' in value) validatePriceCents(value.priceCents);
}
