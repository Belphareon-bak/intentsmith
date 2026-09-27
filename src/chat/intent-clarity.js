// Material words in a hardware request are control data. Normalize only for
// recognition; the original user message remains the input to every handler.
function fold(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const GPU = /\b(?:gpu|gup|grafik(?:a|y|u|ou)|grafick(?:a|e|ou|ych)?\s+kart(?:a|u|y|ou)|graphics?\s+card)\b/u;
const CHANGE = /\b(?:sniz|snizte|snizit|nastav|nastavte|nastavit|omez|omezte|omezit|zmen|zmente|zmenit|uprav|upravte|upravit|set|reduce|lower|limit|undervolt)\b/u;
const NEGATED_CHANGE = /\b(?:nesniz|nesnizuj|nesnizujte|nenastav|nenastavuj|nenastavujte|neomez|neomezuj|nezmen|nemen|nemente|neuprav|neupravuj|do\s+not\s+(?:set|reduce|lower|limit)|nechci\s+(?:snizovat|snizit|nastavovat|nastavit|omezovat|omezit|menit|zmenit))\b/u;
const INFORMATIONAL = /^(?:jak|co|proc|vysvetli|popis|napis|naprogramuj|navrhni|analyzuj|porad|what|how|explain|write|describe)\b/u;
const INFORMATIONAL_WRAPPER = /^(?:muzes|muzete)\s+(?:mi\s+)?(?:rict|vysvetlit|popsat|poradit|ukazat)\b/u;
const LATER_DIRECT_CHANGE = /\b(?:a|pak|potom|and|then)\s+(?:mi\s+)?(?:sniz|nastav|omez|zmen|uprav|set|reduce|lower|limit)\b/u;
const VOLTAGE = /\b(?:napeti|voltaz|voltage|volt|voltu|voltech|undervolt)\b/u;
const POWER = /\b(?:prikon|vykon|power|watt|wattu|wattech)\b/u;
const HALF = /\b(?:na|o)\s+polovinu\b|\bhalf\b|\b50\s*%/u;
const QUANTITY_REPLY = Object.freeze({
  prikon: 'příkon',
  vykon: 'příkon',
  power: 'příkon',
  napeti: 'napětí',
  voltage: 'napětí',
});

const CLARIFY_QUANTITY = 'Napětí GPU a limit příkonu jsou různé veličiny. Myslíš napětí, nebo limit příkonu ve wattech? Celý požadavek zatím pozastavuji.';
const CLARIFY_VALUE = 'Procentní hodnota musí být v rozsahu 0–100 %. Jakou konkrétní hodnotu chceš? Celý požadavek zatím pozastavuji.';
const UNSUPPORTED_CONTROL = 'Požadavek na změnu nastavení GPU jsem rozpoznal, ale nemám ověřený nástroj, který by ji v IntentSmith provedl. Nic jsem nenastavil.';
const PAUSED_REQUEST = 'Původní požadavek jsem nespustil. Pokud chceš pokračovat bez změny GPU, zadej zbývající úkol samostatně.';

function informational(text) {
  const request = text.replace(/^(?:(?:prosim|please)\s+)/u, '');
  return INFORMATIONAL.test(request) || INFORMATIONAL_WRAPPER.test(request);
}

/** Pure, conservative preflight for an explicit GPU hardware change. */
export function assessIntentClarity(input, pendingSlots = []) {
  const raw = String(input || '');
  const text = fold(raw).trim();

  const pendingQuantity = pendingSlots.includes('gpu_quantity');
  const pendingValue = pendingSlots.includes('gpu_value');
  if (pendingQuantity || pendingValue) {
    if (/^(?:ne|nechci|nic|zrus|zrusit|stop|cancel|do\s+not)\b/u.test(text)) {
      return { kind: 'resolved', reason: 'user_cancelled', answer: 'Rozumím. GPU neměním.' };
    }
    const answer = pendingQuantity && QUANTITY_REPLY[text.replace(/[.!?\s]+$/u, '')];
    const value = pendingValue && text.match(/^(\d+(?:[.,]\d+)?)\s*%?\s*[.!?]?$/u);
    if (answer || (value && Number(value[1].replace(',', '.')) <= 100)) {
      return {
        kind: 'resolved',
        reason: answer ? 'quantity_clarified' : 'value_clarified',
        answer: `${answer ? `Rozumím, myslíš ${answer} GPU. ` : `Rozumím, chceš ${value[1]} %. `}${UNSUPPORTED_CONTROL} ${PAUSED_REQUEST}`,
      };
    }
    if (/^(?:ano|jo|ok|yes|potvrzuji|schvaluji)\b/u.test(text) || (pendingValue && /^[+\-\d.,%\s!?]+$/u.test(text))) {
      return {
        kind: 'clarify',
        reason: 'clarification_not_specific',
        slot: pendingQuantity ? 'gpu_quantity' : 'gpu_value',
        question: pendingQuantity ? CLARIFY_QUANTITY : CLARIFY_VALUE,
      };
    }
    // A full new request supersedes the pending question. Never treat its
    // content as approval of the earlier hardware operation.
  }

  if (!GPU.test(text)) return null;
  // A question about a setting, or a request to write code about it, is not
  // itself authority to touch the device. Keep the original text for CRE.
  if (informational(text) && !LATER_DIRECT_CHANGE.test(text)) return null;
  if (NEGATED_CHANGE.test(text)) {
    return { kind: 'no_effect', reason: 'negated_gpu_change', answer: 'Rozumím. Nastavení GPU neměním.' };
  }
  if (!CHANGE.test(text)) return null;

  const voltage = VOLTAGE.test(text);
  const power = POWER.test(text);
  const half = HALF.test(text);
  const percentages = [...text.matchAll(/[+\-]?\d+(?:[.,]\d+)?\s*%/gu)]
    .map(match => Number(match[0].replace('%', '').replace(',', '.').trim()));
  const invalidPercent = percentages.some(value => !Number.isFinite(value) || value < 0 || value > 100);

  if (invalidPercent) {
    return { kind: 'clarify', reason: 'invalid_percentage', slot: 'gpu_value', question: CLARIFY_VALUE };
  }
  if ((voltage && (power || half || percentages.length > 0)) || (!voltage && !power)) {
    return { kind: 'clarify', reason: 'gpu_quantity_ambiguous', slot: 'gpu_quantity', question: CLARIFY_QUANTITY };
  }

  return { kind: 'no_effect', reason: 'gpu_control_unavailable', answer: `${UNSUPPORTED_CONTROL} ${PAUSED_REQUEST}` };
}
