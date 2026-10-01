export function validate(amount, category) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || !(amount > 0)) {
    throw new TypeError('amount must be a finite positive number');
  }

  if (typeof category !== 'string') {
    throw new TypeError('category must be a string');
  }

  const trimmed = category.trim();
  if (!trimmed) {
    throw new RangeError('category must not be blank');
  }
}
