const PIPELINE_ERROR_PATTERN = /LLM failed|fetch failed|circuit breaker|Chyba zpracování|nemohl zpracovat|Nepodařilo se zpracovat|error processing|could not process|Failed to process|No search results|toJSON is not a function/i;

// Explicit allowlist of the live-data prompts in the registered journeys.
// Generic words such as "current" are intentionally insufficient: otherwise
// a misrouted request like "review the current implementation" could become a
// false-green authority terminal.
const EXPECTED_LIVE_AUTHORITY_PATTERNS = Object.freeze([
  /^kolik\s+tam\s+[zž]ije\s+lid[ií]\s*[?!.]?$/iu,
  /^how\s+many\s+people\s+live\s+there\s*[?!.]?$/iu,
  /^jak[eé]\s+jsou\s+trendy\s+v\s+IT\s+podnik[aá]n[ií]\s*[?!.]?$/iu,
  /^what\s+are\s+the\s+current\s+trends\s+in\s+IT\s+business\s*[?!.]?$/iu,
  /^ahoj[!,]?\s+co\s+je\s+nov[eé]ho\s+v\s+technologi[ií]ch\s*[?!.]?$/iu,
  /^hello[!,]?\s+what\s+is\s+new\s+in\s+technology\s*[?!.]?$/iu,
  /^jak[yý]\s+je\s+aktu[aá]ln[ií]\s+ekosyst[eé]m\s+knihoven\s+pro\s+ka[zž]d[yý]\s+framework\s*[?!.]?$/iu,
  /^jak[eé]\s+jsou\s+trendy\s+pro\s+rok\s+\d{4}\?\s+kter[yý]\s+framework\s+roste\s+nejrychleji\s*[?!.]?$/iu,
]);

const STRONG_CZECH_RESPONSE_MARKERS = Object.freeze([
  /[ěščřžýáíéúůďťň]/iu,
  /\b(výsledek|výpočtu|jedná\s+se|protože|který|odpověď|můžete|doporučuji|vytvořit|všiml|používáš|posledních)\b/iu,
]);

function assertExpectedJourneyLanguage(response, expectedLanguage) {
  if (expectedLanguage !== 'en') return;

  const markerCount = STRONG_CZECH_RESPONSE_MARKERS
    .reduce((count, pattern) => count + (pattern.test(response) ? 1 : 0), 0);
  if (markerCount >= 2) {
    throw new Error(`Expected English response but received Czech content: ${response.substring(0, 150)}`);
  }
}

export function inspectChatJourneyResult(input, result, { expectedLanguage = null } = {}) {
  if (!result || typeof result.response !== 'string' || result.response.trim().length === 0) {
    throw new Error('Empty chat response');
  }

  const response = result.response.trim();
  if (PIPELINE_ERROR_PATTERN.test(response)) {
    throw new Error(`Pipeline error: ${response.substring(0, 150)}`);
  }

  if (result.metadata?.finishReason === 'length') {
    throw new Error(`Truncated model response: ${response.substring(0, 150)}`);
  }

  if (result.metadata?.awaitingClarification === true) {
    throw new Error(`Unexpected clarification instead of a terminal answer: ${response.substring(0, 150)}`);
  }

  if (result.metadata?.proposalShown === true) {
    throw new Error(`Unexpected skill proposal instead of a terminal answer: ${response.substring(0, 150)}`);
  }

  const terminal = result.metadata?.securityBlocked === true
    || result.metadata?.fallbackSuppressed === true
    || result.metadata?.handler === 'tool.authority';
  const expectsLiveAuthority = EXPECTED_LIVE_AUTHORITY_PATTERNS
    .some(pattern => pattern.test(input.trim()));
  if (!terminal) {
    if (expectsLiveAuthority) {
      throw new Error(`Expected live-authority terminal but received a model answer: ${response.substring(0, 150)}`);
    }
    assertExpectedJourneyLanguage(response, expectedLanguage);
    return Object.freeze({ kind: 'answer', response });
  }

  if (!expectsLiveAuthority) {
    throw new Error(
      `Unexpected authority terminal ${result.metadata?.error || 'UNKNOWN'}: ${response.substring(0, 150)}`,
    );
  }

  if (result.metadata?.fallbackSuppressed !== true) {
    throw new Error('Authority terminal did not suppress the fallback model response');
  }

  return Object.freeze({
    kind: 'expected_authority_terminal',
    response,
    errorCode: result.metadata?.error || 'UNKNOWN',
  });
}
