import assert from 'node:assert/strict';

// This oracle proves list cardinality and distinct named items. It does not
// establish factual correctness, popularity, or the quality of descriptions.
export function assertFiveDistinctFrameworks(response) {
  const items = response.split(/\r?\n/u).filter(line => /^\s*(?:\d+[.)]|[-*•])\s+/u.test(line));
  assert.equal(items.length, 5, 'the request requires exactly five visible list items');
  const aliases = /^(react(?:\.?js)?|vue(?:\.?js)?|angular|svelte(?:kit)?|next(?:\.?js)?|nuxt(?:\.?js)?|express(?:\.?js)?|nest(?:\.?js)?|ember(?:\.?js)?|backbone(?:\.?js)?)\b/iu;
  const identities = items.map(line => {
    const label = line.replace(/^\s*(?:\d+[.)]|[-*•])\s+/u, '').replace(/[*_`]/gu, '').trim();
    const match = label.match(aliases);
    assert(match, `each item must start with an identifiable framework: ${label}`);
    return match[1].toLowerCase().replace(/\.?js$/u, '').replace(/kit$/u, '');
  });
  assert.equal(new Set(identities).size, 5, 'aliases and repeated names cannot fill missing items');
}
