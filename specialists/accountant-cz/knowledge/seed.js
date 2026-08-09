// Accountant-CZ Knowledge Seeding
// ══════════════════════════════════════════════════════════════════════════════
//
// Moves tax rate seeding from core knowledge-base.js into the specialist package.
// Called during register(ctx) — seeds KnowledgeBase with domain='tax' facts.
//
// v121: Self-contained specialist knowledge.
//
// ══════════════════════════════════════════════════════════════════════════════

import { RATES, supportedYears } from '../tools/tax-rates.js';

/**
 * @typedef {Object} AccountantKnowledgeBase
 * @property {(facts: Object[]) => void} bulkSetFacts
 */

/**
 * Seed accountant tax knowledge into the KnowledgeBase.
 * Idempotent — uses bulkSetFacts (upsert).
 *
 * @param {AccountantKnowledgeBase} kb
 * @returns {number} Number of facts seeded
 */
export function seedAccountantKnowledge(kb) {
  if (!kb || typeof kb.bulkSetFacts !== 'function') {
    return 0;
  }

  const facts = [];

  for (const [yearStr, yearData] of Object.entries(RATES)) {
    const year = Number(yearStr);
    const meta = yearData._meta || {};

    for (const [category, catData] of Object.entries(yearData)) {
      if (category === '_meta') continue;
      if (typeof catData !== 'object') continue;

      for (const [key, value] of Object.entries(catData)) {
        let valueType = 'number';
        let serialized = value;

        if (typeof value === 'boolean') {
          valueType = 'boolean';
        } else if (typeof value === 'object') {
          valueType = 'json';
          serialized = value;
        } else if (typeof value === 'string') {
          valueType = 'string';
        }

        const isProvisional = meta.provisional?.some(p => p.startsWith(`${category}.${key}`)) || false;

        facts.push({
          domain: 'tax',
          specialist_id: 'accountant',
          category,
          key,
          value: serialized,
          value_type: valueType,
          valid_from: meta.valid_from || null,
          valid_to: meta.valid_to || null,
          year,
          source: meta.source || null,
          confidence: meta.confidence || 'high',
          is_provisional: isProvisional,
          verified_at: meta.verified_at || null,
          verified_by: 'import',
        });
      }
    }
  }

  kb.bulkSetFacts(facts);
  return facts.length;
}
