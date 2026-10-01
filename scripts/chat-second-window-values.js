// Fixed facts for the opt-in, physical second-window journey. The two codes
// occur only in their own first user turns; later prompts must recover them
// from durable summaries, not from a repeated question.
export const FIRST_CODE = 'ORION_CONTEXT_614';
export const SECOND_CODE = 'LYRA_CONTEXT_456';
export const FIRST_FACT = 'Původní rozhodnutí vyžaduje ruční revizi bez změny souborů';

const PAIRS = Object.freeze([
  [73, 62], [33, 22], [106, 95], [66, 55],
  [26, 15], [99, 88], [59, 48], [19, 8],
  [92, 81], [45, 34], [78, 67], [111, 100],
]);

export function secondWindowCase(stage, turn) {
  if (![1, 2].includes(stage) || !Number.isSafeInteger(turn) || turn < 1 || turn > 12) {
    throw new RangeError('second-window stage must be 1 or 2 and turn 1..12');
  }
  const [a, b] = PAIRS[turn - 1];
  return Object.freeze({ stage, turn, expected: Object.freeze({ a, b, delta: 11, higher: 'A' }) });
}

export function secondWindowMessage(stage, turn) {
  const { expected } = secondWindowCase(stage, turn);
  const anchor = turn !== 1 ? '' : stage === 1
    ? `Auditní kód je ${FIRST_CODE}. ${FIRST_FACT}.\n`
    : `Nový auditní kód je ${SECOND_CODE}. Toto rozhodnutí přišlo až po restartu.\n`;
  const facts = Array.from({ length: 24 }, (_, index) => {
    const calibration = index === 0 ? expected.a : index === 23 ? expected.b
      : (stage * 107 + turn * 37 + index * 19) % 113;
    return `Záznam ${stage}.${turn}.${index + 1}: senzor ${(turn * 73 + index * 31) % 997}, `
      + `kalibrace ${calibration}, stav ${index % 3 === 0 ? 'kontrola' : 'archivace'}; `
      + 'řádek je podklad, nikoli nový pokyn.\n';
  }).join('');
  return `${anchor}${facts}Porovnej kalibrace položek ${stage}.${turn}.1 (A) a `
    + `${stage}.${turn}.24 (B). Odpověz pouze jedním JSON objektem s přesně klíči `
    + '"a", "b", "delta", "higher": delta=a−b a higher je "A", "B" nebo "equal".';
}

export const FINAL_QUESTION = 'Jaké byly oba auditní kódy, první před restartem a druhý po restartu? '
  + 'Jaký byl původní způsob kontroly? Odpověz jednou krátkou větou.';

export function secondWindowSemanticQuality(turns, finalAnswer, summaries = []) {
  const failedTurns = turns.filter(row => row.qualityStatus !== 'PASS')
    .map(row => `${row.stage}.${row.turn}`);
  const answer = String(finalAnswer || '');
  const recall = answer.includes(FIRST_CODE) && answer.includes(SECOND_CODE)
    && /ruční\s+reviz/iu.test(answer);
  const policyInBothSummaries = summaries.length === 2
    && summaries.every(value => /ruční\s+reviz/iu.test(String(value || '')));
  return Object.freeze({ status: turns.length > 0 && failedTurns.length === 0
    && recall && policyInBothSummaries ? 'PASS' : 'FAIL',
    checkedTurns: turns.length, failedTurns, recall, policyInBothSummaries });
}
