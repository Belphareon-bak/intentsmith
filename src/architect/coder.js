// C.3 Architect Mode - Coder LLM
// ══════════════════════════════════════════════════════════════════════════════
//
// CoderLLM = IZOLOVANÝ GENERÁTOR KÓDU
// - Pouze: definice → soubory
// - Žádný kontext konverzace
// - Žádné přemýšlení o next step
// - Voláno pouze přes Orchestrator po splnění všech gates
//
// v36.9.1: Migrated to LLMGateway with WORKFLOW_CODER auth token
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { callWithAuth } from '../llm/gateway.js';
import { createAuthToken, LLMCallerRole } from '../llm/auth-types.js';
import { extractJSON } from '../llm/client.js';

const CODER_MODEL = 'qwen2.5-coder:32b';

/**
 * CODER PROMPT - minimální, zaměřený pouze na kód
 */
const CODER_PROMPT = `Jsi CODER. Implementuj PŘESNĚ podle definice.

## DEFINICE BLOKU

{definition}

## KONTEXT PROJEKTU

{projectContext}

## EXISTUJÍCÍ STRUKTURA

{existingFiles}

---

Vygeneruj kompletní implementaci. Odpověz POUZE platným JSON:

{
  "files": [
    {
      "path": "relativní/cesta/soubor.js",
      "content": "kompletní obsah souboru"
    }
  ],
  "notes": "krátké poznámky k implementaci"
}

PRAVIDLA:
- Kompletní, spustitelný kód (ne pseudokód, ne TODO)
- Všechny potřebné soubory v jednom JSON
- ES modules (import/export)
- Žádné vysvětlování, jen kód`;

/**
 * CoderLLM - Izolovaný generátor kódu
 *
 * Vstup: definice + kontext
 * Výstup: pole souborů
 *
 * Žádná konverzace, žádná historie, žádné rozhodování.
 *
 * HARDENING: Všechny vstupy jsou serializované (immutable)
 */
export class CoderLLM {

  /**
   * Generuj soubory z definice
   *
   * @param {string} definition - Markdown definice bloku
   * @param {string} projectContext - Spec projektu
   * @param {string[]} existingFiles - Seznam existujících souborů
   * @returns {Promise<{files: Array, notes: string, duration: number}>}
   */
  async generate(definition, projectContext = '', existingFiles = []) {
    // HARDENING: Immutable inputs - serialize to prevent side effects
    const immutableDefinition = JSON.parse(JSON.stringify(definition || ''));
    const immutableContext = JSON.parse(JSON.stringify(projectContext || ''));
    const immutableFiles = JSON.parse(JSON.stringify(existingFiles || []));

    if (!immutableDefinition || immutableDefinition.trim().length < 50) {
      throw new Error('Definition is too short or empty');
    }

    const prompt = CODER_PROMPT
      .replace('{definition}', immutableDefinition)
      .replace('{projectContext}', immutableContext || 'Není specifikován')
      .replace('{existingFiles}', immutableFiles.length > 0
        ? immutableFiles.map(f => `- ${f}`).join('\n')
        : 'Prázdný projekt');

    logger.info('CoderLLM', 'Generating code...', {
      definitionLength: immutableDefinition.length,
      existingFiles: immutableFiles.length
    });

    try {
      const token = createAuthToken({
        role: LLMCallerRole.WORKFLOW_CODER,
        decisionId: `coder_${Date.now()}`,
        auditContext: { sessionId: 'architect' }
      });

      const response = await callWithAuth(token, prompt, {
        model: CODER_MODEL,
        temperature: 0.2,
        timeout: 180000,
        format: 'json',
        maxTokens: 8000
      });

      const result = extractJSON(response.content);

      if (!result?.files || !Array.isArray(result.files)) {
        logger.error('CoderLLM', 'Invalid response structure', {
          hasFiles: !!result?.files,
          responseLength: response.content?.length
        });
        throw new Error('Invalid response: missing files array');
      }

      // Validace souborů
      const validFiles = result.files.filter(f => {
        if (!f.path || !f.content) {
          logger.warn('CoderLLM', 'Skipping invalid file', { path: f.path });
          return false;
        }
        return true;
      });

      if (validFiles.length === 0) {
        throw new Error('No valid files generated');
      }

      logger.info('CoderLLM', 'Code generated', {
        fileCount: validFiles.length,
        duration: response.duration
      });

      return {
        files: validFiles,
        notes: result.notes || '',
        duration: response.duration,
      };

    } catch (err) {
      logger.error('CoderLLM', `Generation failed: ${err.message}`);
      throw err;
    }
  }
}

export default CoderLLM;
