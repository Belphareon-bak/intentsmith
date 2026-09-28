// Exact price/money operations. Probabilities deliberately remain numbers.
export function fail(code, message, fieldPath = null) {
  throw Object.assign(new Error(message), { code, fieldPath });
}
export function record(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('INVALID_REQUEST', 'Očekáván objekt.', path);
  return value;
}
export function keys(value, required, optional, path) {
  record(value, path);
  for (const key of required) if (!Object.hasOwn(value, key)) fail('NEEDS_INPUT', `Chybí ${key}.`, `${path}.${key}`);
  for (const key of Object.keys(value)) if (![...required, ...optional].includes(key)) fail('INVALID_REQUEST', `Neznámé pole ${key}.`, `${path}.${key}`);
}
export function text(value, path, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/u.test(value)) fail('INVALID_REQUEST', 'Neplatný text.', path);
  return value;
}
export function integer(value, min, max, path) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('INVALID_REQUEST', `Požadováno celé číslo ${min}–${max}.`, path);
  return value;
}
export function probability(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) fail('INVALID_REQUEST', 'Pravděpodobnost musí být číslo 0–1 (70 % = 0.70).', path);
  return value;
}
export function choice(value, allowed, path) {
  if (!allowed.includes(value)) fail('INVALID_REQUEST', `Povoleno: ${allowed.join(', ')}.`, path);
  return value;
}
export function strings(value, path, {empty = true, max = 200} = {}) {
  if (!Array.isArray(value) || value.length > max || (!empty && !value.length)) fail('INVALID_REQUEST', 'Neplatný seznam.', path);
  value.forEach((v, i) => text(v, `${path}[${i}]`));
  if (new Set(value).size !== value.length) fail('INVALID_REQUEST', 'Duplicitní identifikátor.', path);
  return value;
}
export function instant(value, path) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) fail('INVALID_REQUEST', 'Požadován UTC čas RFC3339.', path);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z')) fail('INVALID_REQUEST', 'Neplatné datum.', path);
  return ms;
}
export function decimal(value, path) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,31})(?:\.\d{1,6})?$/.test(value)) fail('INVALID_REQUEST', 'Kurz musí být desetinný string.', path);
  const [a, b = ''] = value.split('.');
  const result = { n: BigInt(a + b), d: 10n ** BigInt(b.length) };
  if (result.n <= result.d) fail('INVALID_REQUEST', 'Kurz musí být vyšší než 1.', path);
  return result;
}
export const multiply = (a, b) => ({ n: a.n * b.n, d: a.d * b.d });
export const compare = (a, b) => a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
export const number = a => Number(a.n) / Number(a.d);
export function decimalString(a) {
  const whole = a.n / a.d;
  let rem = a.n % a.d, fraction = '';
  while (rem) { rem *= 10n; fraction += String(rem / a.d); rem %= a.d; }
  return fraction ? `${whole}.${fraction}` : String(whole);
}
export function payout(minor, odds) {
  const n = BigInt(minor) * odds.n;
  const result = (2n * n + odds.d) / (2n * odds.d);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) fail('INVALID_REQUEST', 'Výplata překračuje bezpečný rozsah peněz.', 'stake');
  return Number(result);
}
export function escapeMarkdown(value) {
  return String(value).replace(/[\r\n|<>\[\]`*_\\]/g, ' ');
}
