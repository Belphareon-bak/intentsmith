// ═══════════════════════════════════════════════════════════════════════════════
// C3-Agent — Response Sanitization (Q5)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Fix: LLM occasionally returns raw JSON object as response instead of text.
//      1× observed in conv-czech output. Defensive sanitization layer.
//
// Integration: call sanitizeResponse() on every LLM response in controller.js
//              BEFORE returning to user.
//
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sanitize LLM response before delivering to user.
 *
 * Handles:
 *   1. Raw JSON objects → extract .content or .text or .response field
 *   2. Markdown code fence wrapping entire response → unwrap
 *   3. Empty/whitespace-only → fallback message
 *   4. Trim excessive whitespace
 *
 * @param {string} response - Raw LLM response text
 * @param {string} lang - User language for fallback messages ('cs'|'en')
 * @returns {string} Sanitized response
 */
export function sanitizeResponse(response, lang = 'cs') {
  if (!response || typeof response !== 'string') {
    return lang === 'cs'
      ? 'Omlouvám se, nepodařilo se vygenerovat odpověď. Zkuste to prosím znovu.'
      : 'Sorry, I was unable to generate a response. Please try again.';
  }

  let text = response.trim();

  // ─── 1. Raw JSON detection ─────────────────────────────────────────────
  // If response starts with { and ends with } → try to parse and extract text
  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      const parsed = JSON.parse(text);
      // Try common LLM response fields
      const extracted = parsed.content || parsed.text || parsed.response
                     || parsed.message || parsed.answer || parsed.result;
      if (typeof extracted === 'string' && extracted.length > 0) {
        text = extracted.trim();
      }
      // If parsed but no text field → stringify nicely as fallback
      // (shouldn't happen, but better than raw JSON)
    } catch {
      // Not valid JSON but starts with { — leave it, could be code/template
    }
  }

  // ─── 2. JSON array detection ───────────────────────────────────────────
  if (text.startsWith('[') && text.endsWith(']')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // If array of strings, join them
        if (parsed.every(item => typeof item === 'string')) {
          text = parsed.join('\n');
        }
        // If array of objects with .content, extract
        else if (parsed[0]?.content) {
          text = parsed.map(item => item.content).join('\n');
        }
      }
    } catch {
      // Not valid JSON array — leave as-is
    }
  }

  // ─── 3. Markdown code fence wrapping entire response ───────────────────
  // If the ENTIRE response is wrapped in ```...``` → unwrap
  const fenceMatch = text.match(/^```(?:json|text|markdown|md)?\n?([\s\S]*?)\n?```$/);
  if (fenceMatch && fenceMatch[1].trim().length > 0) {
    // Only unwrap if the content inside isn't actual code the user asked for
    // Heuristic: if it looks like JSON that we already tried to parse, unwrap
    const inner = fenceMatch[1].trim();
    if (inner.startsWith('{') || inner.startsWith('[')) {
      // Recursively sanitize the unwrapped content
      return sanitizeResponse(inner, lang);
    }
  }

  // ─── 4. Empty after processing ─────────────────────────────────────────
  if (!text || text.length === 0) {
    return lang === 'cs'
      ? 'Omlouvám se, nepodařilo se vygenerovat odpověď. Zkuste to prosím znovu.'
      : 'Sorry, I was unable to generate a response. Please try again.';
  }

  // ─── 5. Trim excessive whitespace ──────────────────────────────────────
  // Replace 3+ consecutive newlines with 2
  text = text.replace(/\n{3,}/g, '\n\n');

  return text;
}

/**
 * Quick check if a response looks like it needs sanitization.
 * Useful for logging/metrics without full processing.
 *
 * @param {string} response
 * @returns {{ needsSanitization: boolean, reason: string|null }}
 */
export function checkResponseHealth(response) {
  if (!response || typeof response !== 'string') {
    return { needsSanitization: true, reason: 'empty_response' };
  }
  const trimmed = response.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return { needsSanitization: true, reason: 'raw_json_object' };
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return { needsSanitization: true, reason: 'raw_json_array' };
  }
  if (trimmed.length === 0) {
    return { needsSanitization: true, reason: 'whitespace_only' };
  }
  return { needsSanitization: false, reason: null };
}

export default {
  sanitizeResponse,
  checkResponseHealth,
};
