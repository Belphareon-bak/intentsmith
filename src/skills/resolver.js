// Skill Resolver — LLM-based skill identification and parameter extraction
// ══════════════════════════════════════════════════════════════════════════════
//
// Given user input and available skills, identifies which skill to run
// and extracts parameters. Returns null if no match or low confidence.
//
// Post-LLM validation:
//   1. skillId must exist in registry
//   2. All required params must be present
//   3. Extra params are stripped
//   4. Confidence clamped to [0, 1]
//
// ══════════════════════════════════════════════════════════════════════════════

import { callWithAuth } from '../llm/gateway.js';
import { createAuthToken, LLMCallerRole } from '../llm/auth-types.js';
import { extractJSON } from '../llm/client.js';
import { config } from '../config.js';
import { skillRegistry } from './registry.js';

/**
 * Resolve user input to a specific skill + parameters.
 *
 * @param {string} input - User message
 * @param {Array} skillSummaries - [{id, description, version}]
 * @param {Object} [logger] - Optional logger
 * @returns {{ skillId: string, params: Object, confidence: number } | null}
 */
export async function resolveSkill(input, skillSummaries, logger) {
  if (!skillSummaries || skillSummaries.length === 0) {
    return null;
  }

  const skillList = skillSummaries
    .map(s => `- ${s.id}: ${s.description}`)
    .join('\n');

  const systemPrompt = `Identifikuj, který skill odpovídá uživatelovu požadavku.
Vrať POUZE JSON: {"skillId":"X","params":{"key":"value"},"confidence":0.8}

Dostupné skilly:
${skillList}

Pravidla:
- confidence 0-1: jak jistý si jsi, že uživatel chce právě tento skill
- params: extrahuj parametry z uživatelova vstupu (klíče musí odpovídat definici skillu)
- pokud žádný skill nesedí, vrať {"skillId":null,"params":{},"confidence":0}
- NIKDY nevymýšlej skill ID které není v seznamu`;

  const token = createAuthToken({
    role: LLMCallerRole.SKILL_RESOLVER,
    decisionId: `skill-resolve-${Date.now()}`,
    auditContext: { sessionId: `resolver-${Date.now()}` },
  });

  try {
    const result = await callWithAuth(token, input, {
      systemPrompt,
      model: config.models?.FAST || config.models?.CHAT,
      format: 'json',
      temperature: 0.1,
      maxTokens: 200,
      num_ctx: 1024,
    });

    if (!result?.content) {
      if (logger) logger.debug('SkillResolver', 'LLM returned empty content');
      return null;
    }

    const parsed = extractJSON(result.content);
    if (!parsed || !parsed.skillId) {
      if (logger) logger.debug('SkillResolver', `No skillId in response: ${result.content.substring(0, 100)}`);
      return null;
    }

    // ── Post-LLM validation ──

    // 1. Validate skillId exists in registry
    const skillDef = skillRegistry.get(parsed.skillId);
    if (!skillDef) {
      if (logger) logger.info('SkillResolver', `Hallucinated skillId "${parsed.skillId}" — not in registry`);
      return null;
    }

    // 2. Validate required params
    const requiredParams = skillRegistry.getRequiredParams(parsed.skillId);
    const resolvedParams = parsed.params || {};
    for (const req of requiredParams) {
      if (resolvedParams[req] === undefined || resolvedParams[req] === null || resolvedParams[req] === '') {
        if (logger) logger.info('SkillResolver', `Missing required param "${req}" for skill "${parsed.skillId}"`);
        return null;
      }
    }

    // 3. Strip extra params not in skill definition
    const validParamNames = new Set(skillRegistry.getParamNames(parsed.skillId));
    const cleanParams = {};
    for (const [key, value] of Object.entries(resolvedParams)) {
      if (validParamNames.has(key)) {
        cleanParams[key] = value;
      }
    }

    // 4. Clamp confidence
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));

    return { skillId: parsed.skillId, params: cleanParams, confidence };
  } catch (err) {
    if (logger) logger.error('SkillResolver', `Resolution failed: ${err.message}`);
    return null;
  }
}
