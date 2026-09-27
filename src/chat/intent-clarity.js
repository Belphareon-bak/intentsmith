// Material words in a hardware request are control data. Normalize only for
// recognition; the original user message remains the input to every handler.
function fold(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const GPU = /\b(?:gpu|gup|grafik(?:a|y|u|ou)|grafick(?:a|e|ou|ych)?\s+kart(?:a|u|y|ou)|graphics?\s+card)\b/u;
const CHANGE = /\b(?:sniz|snizte|snizit|nastav|nastavte|nastavit|omez|omezte|omezit|zmen|zmente|zmenit|uprav|upravte|upravit|set|reduce|lower|limit|undervolt)\b/u;
const NEGATED_CHANGE = /\b(?:nesniz|nesnizuj|nesnizujte|nenastav|nenastavuj|nenastavujte|neomez|neomezuj|nezmen|nemen|nemente|neuprav|neupravuj|do\s+not\s+(?:set|reduce|lower|limit))\b/u;
const INFORMATIONAL = /^(?:jak|co|proc|vysvetli|popis|napis|naprogramuj|navrhni|analyzuj|porad|what|how|explain|write|describe)\b/u;
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

const CLARIFY_QUANTITY = 'Napětí GPU a limit příkonu jsou různé veličiny. Myslíš napětí, nebo limit příkonu ve wattech? GPU zatím neměním.';
const UNSUPPORTED_CONTROL = 'Požadavek na změnu nastavení GPU jsem rozpoznal, ale nemám ověřený nástroj, který by ji v IntentSmith provedl. Nic jsem nenastavil.';

/** Pure, conservative preflight for an explicit GPU hardware change. */
export function assessIntentClarity(input, pendingSlots = []) {
  const raw = String(input || '');
  const text = fold(raw).trim();

  if (pendingSlots.includes('gpu_quantity')) {
    if (/^(?:ne|nic|zrus|zrusit|stop|cancel|do\s+not)\b/u.test(text)) {
      return { kind: 'resolved', reason: 'user_cancelled', answer: 'Rozumím. GPU neměním.' };
    }
    const answer = QUANTITY_REPLY[text.replace(/[.!?\s]+$/u, '')];
    if (answer) {
      return {
        kind: 'resolved',
        reason: 'quantity_clarified',
        answer: `Rozumím, myslíš ${answer} GPU. ${UNSUPPORTED_CONTROL}`,
      };
    }
    if (/^(?:ano|jo|ok|yes|potvrzuji|schvaluji)\b/u.test(text)) {
      return { kind: 'clarify', reason: 'generic_confirmation_is_not_quantity', question: CLARIFY_QUANTITY };
    }
    // A full new request supersedes the pending question. Never treat its
    // content as approval of the earlier hardware operation.
  }

  if (!GPU.test(text)) return null;
  // A question about a setting, or a request to write code about it, is not
  // itself authority to touch the device. Keep the original text for CRE.
  if (INFORMATIONAL.test(text) && !LATER_DIRECT_CHANGE.test(text)) return null;
  if (NEGATED_CHANGE.test(text)) {
    return { kind: 'no_effect', reason: 'negated_gpu_change', answer: 'Rozumím. Nastavení GPU neměním.' };
  }
  if (!CHANGE.test(text)) return null;

  const voltage = VOLTAGE.test(text);
  const power = POWER.test(text);
  const half = HALF.test(text);
  const percentages = [...text.matchAll(/\b(\d+(?:[.,]\d+)?)\s*%/gu)].map(match => Number(match[1].replace(',', '.')));
  const invalidPercent = percentages.some(value => !Number.isFinite(value) || value < 0 || value > 100);

  if ((voltage && (power || half)) || (!voltage && !power) || invalidPercent) {
    return { kind: 'clarify', reason: invalidPercent ? 'invalid_percentage' : 'gpu_quantity_ambiguous', question: CLARIFY_QUANTITY };
  }

  return { kind: 'no_effect', reason: 'gpu_control_unavailable', answer: UNSUPPORTED_CONTROL };
}
