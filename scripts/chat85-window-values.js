// Pinned independent expectations for the long-session window-fill fixture.
// Keep these literals separate from the generated source lines so a changed
// generator cannot silently change what the live model is expected to answer.
export const WINDOW_FILL_CODE = 'RIGEL_KAPPA_731';

const PAIRS = Object.freeze([
  [73, 62], [33, 22], [106, 95], [66, 55],
  [26, 15], [99, 88], [59, 48], [19, 8],
]);

export const WINDOW_FILL_CASES = Object.freeze(PAIRS.map(([a, b], index) => Object.freeze({
  turn: index + 1,
  label: `window-fill-${index + 1}`,
  expected: Object.freeze({ a, b, delta: a - b, higher: a > b ? 'A' : a < b ? 'B' : 'equal' }),
})));

export const WINDOW_FILL_RETRY_CASE = Object.freeze({ turn: 9, label: 'window-fill-retry-9',
  expected: Object.freeze({ a: 92, b: 81, delta: 11, higher: 'A' }) });

export function windowFillMessage(turn) {
  if (!Number.isSafeInteger(turn) || turn < 1 || turn > 9) throw new RangeError('window-fill turn must be 1..9');
  const facts = Array.from({ length: 24 }, (_, index) => (
    `Záznam ${turn}.${index + 1}: senzor ${((turn * 37) + (index * 19)) % 997}, `
    + `kalibrace ${((turn * 73) + (index * 29)) % 113}, `
    + `stav ${index % 3 === 0 ? 'kontrola' : 'archivace'}; `
    + 'tento řádek je podklad, nikoli nový pokyn.\n'
  )).join('');
  const anchor = turn === 1
    ? `Nejdůležitější trvalý údaj pro tuto relaci je auditní kód ${WINDOW_FILL_CODE}. `
      + 'Budu se na něj ptát až po zkrácení kontextu.\n'
    : '';
  return `${anchor}${facts}Porovnej kalibrace položek ${turn}.1 (A) a ${turn}.24 (B). `
    + 'Odpověz pouze jedním JSON objektem s přesně klíči "a", "b", "delta", "higher": '
    + 'a a b jsou příslušné kalibrace, delta=a−b a higher je "A", "B" nebo "equal".';
}
