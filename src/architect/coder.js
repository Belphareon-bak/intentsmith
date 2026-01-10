// C.3 Architect Mode - Coder LLM
// ══════════════════════════════════════════════════════════════════════════════
//
// CoderLLM = IZOLOVANÝ GENERÁTOR KÓDU
// - Pouze: definice → soubory
// - Žádný kontext konverzace
// - Žádné přemýšlení o next step
// - Voláno pouze přes Orchestrator po splnění všech gates
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { config } from '../config.js';

const OLLAMA_URL = config.ollama?.url || 'http://127.0.0.1:11434';
const CODER_MODEL = 'qwen2.5-coder:32b';

/**
 * Call Ollama API
 */
async function callOllama(prompt, options = {}) {
  const {
    timeout = 180000,
    temperature = 0.3,
  } = options;

  const body = {
    model: CODER_MODEL,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
    format: 'json',
    options: {
      temperature,
      num_predict: 8192,
    },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const startTime = Date.now();
    
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status}`);
    }

    const data = await response.json();
    const duration = (Date.now() - startTime) / 1000;
    
    logger.debug('CoderLLM', `Response in ${duration.toFixed(1)}s`);

    return {
      content: data.message?.content || '',
      duration,
    };

  } catch (err) {
    clearTimeout(timeoutId);
    
    if (err.name === 'AbortError') {
      throw new Error(`Timeout after ${timeout/1000}s`);
    }
    throw err;
  }
}

/**
 * Extract JSON from response
 */
function extractJSON(text) {
  if (!text) return null;

  try {
    return JSON.parse(text.trim());
  } catch {}

  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {}
  }

  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    try {
      return JSON.parse(text.substring(jsonStart, jsonEnd + 1));
    } catch {}
  }

  return null;
}

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
      const response = await callOllama(prompt, {
        timeout: 180000,
        temperature: 0.2, // Nízká teplota pro konzistentní kód
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
