// C.3 Architect Mode - LLM Client
// ══════════════════════════════════════════════════════════════════════════════
//
// ArchitectLLM = ADVISOR
// - Radí, navrhuje, NIKDY nerozhoduje
// - Žádné generování kódu (to je CoderLLM)
// - Žádné rozhodování o next step (to je Orchestrator)
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { config } from '../config.js';
import { PROMPTS } from './prompts.js';

const OLLAMA_URL = config.ollama?.url || 'http://127.0.0.1:11434';
const ARCHITECT_MODEL = 'qwen2.5:32b';

/**
 * Call Ollama API
 */
async function callOllama(model, prompt, systemPrompt = null, options = {}) {
  const {
    timeout = 120000,
    temperature = 0.7,
    jsonMode = false,
  } = options;

  const messages = [];
  
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  
  messages.push({ role: 'user', content: prompt });

  const body = {
    model,
    messages,
    stream: false,
    options: {
      temperature,
      num_predict: jsonMode ? 4096 : 2048,
    },
  };

  if (jsonMode) {
    body.format = 'json';
  }

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
    
    logger.debug('ArchitectLLM', `Response in ${duration.toFixed(1)}s`, { model });

    return {
      content: data.message?.content || '',
      model,
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
 * Extract JSON from LLM response
 */
function extractJSON(text) {
  if (!text) return null;

  // Try direct parse
  try {
    return JSON.parse(text.trim());
  } catch {}

  // Try from code block
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {}
  }

  // Try finding JSON object
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
 * ArchitectLLM - ADVISOR role only
 * 
 * What it CAN do:
 * - converse() - vést konverzaci
 * - proposeDefinition() - navrhnout definici
 * - suggestConfidence() - NAVRHNOUT confidence (ne nastavit!)
 * - extractDecisions() - extrahovat rozhodnutí z konverzace
 * - createSessionSummary() - shrnout session
 * 
 * What it CANNOT do:
 * - rozhodovat o next step
 * - generovat kód
 * - dělat review
 */
export class ArchitectLLM {
  constructor() {
    this.conversationHistory = [];
    this.maxHistoryLength = 20;
  }

  /**
   * Add message to conversation history
   */
  addToHistory(role, content) {
    this.conversationHistory.push({ role, content, timestamp: new Date().toISOString() });
    
    if (this.conversationHistory.length > this.maxHistoryLength) {
      this.conversationHistory = this.conversationHistory.slice(-this.maxHistoryLength);
    }
  }

  /**
   * Clear conversation history
   */
  clearHistory() {
    this.conversationHistory = [];
  }

  /**
   * Get formatted history for prompt
   */
  getFormattedHistory(lastN = 10) {
    const recent = this.conversationHistory.slice(-lastN);
    return recent.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
  }

  /**
   * Konverzace - hlavní metoda pro dialog s uživatelem
   * Vrací POUZE odpověď, žádné rozhodnutí
   */
  async converse(message, context) {
    const prompt = PROMPTS.CONVERSATION
      .replace('{system}', PROMPTS.ARCHITECT_SYSTEM)
      .replace('{context}', context)
      .replace('{message}', message);

    try {
      const response = await callOllama(ARCHITECT_MODEL, prompt, null, {
        timeout: 60000,
        temperature: 0.8,
      });

      this.addToHistory('user', message);
      this.addToHistory('assistant', response.content);

      return {
        response: response.content,
        duration: response.duration,
      };

    } catch (err) {
      logger.error('ArchitectLLM', `Converse error: ${err.message}`);
      throw err;
    }
  }

  /**
   * NAVRHNOUT confidence - Orchestrator rozhodne co s tím
   * Vrací návrh, ne finální hodnotu
   */
  async suggestConfidence(definition) {
    if (!definition || definition.trim().length < 50) {
      return {
        suggested: 0.1,
        missing: ['Definice je prázdná nebo příliš krátká'],
        reasoning: 'Definice potřebuje doplnit',
      };
    }

    const prompt = PROMPTS.EVALUATE_CONFIDENCE.replace('{definition}', definition);

    try {
      const response = await callOllama(ARCHITECT_MODEL, prompt, null, {
        timeout: 30000,
        jsonMode: true,
        temperature: 0.3,
      });

      const result = extractJSON(response.content);
      
      if (result) {
        return {
          suggested: Math.max(0, Math.min(1, result.confidence || 0)),
          missing: result.missing || [],
          reasoning: result.summary || '',
        };
      }

      // Fallback - heuristic
      return this.heuristicConfidence(definition);

    } catch (err) {
      logger.warn('ArchitectLLM', `Confidence suggestion failed: ${err.message}`);
      return this.heuristicConfidence(definition);
    }
  }

  /**
   * Heuristic confidence (fallback)
   */
  heuristicConfidence(definition) {
    let suggested = 0.2;
    const missing = [];

    if (definition.includes('## Cíl') || definition.includes('## Popis')) {
      suggested += 0.15;
    } else {
      missing.push('Chybí cíl nebo popis');
    }

    if (definition.includes('## Funkc') || definition.includes('## Chování')) {
      suggested += 0.2;
    } else {
      missing.push('Chybí popis funkcionality');
    }

    if (definition.includes('## Vzhled') || definition.includes('## Design') || definition.includes('## UI')) {
      suggested += 0.15;
    }

    if (definition.includes('## Závislosti')) {
      suggested += 0.1;
    }

    if (definition.length > 500) suggested += 0.1;
    if (definition.length > 1000) suggested += 0.1;

    return {
      suggested: Math.min(suggested, 1.0),
      missing,
      reasoning: suggested >= 0.7 ? 'Definice vypadá kompletní' : 'Definice potřebuje doplnit',
    };
  }

  /**
   * Navrhnout definici bloku
   */
  async proposeDefinition(blockPath, projectContext, conversation = '') {
    const blockName = blockPath.split('/').pop().replace(/^\d+-/, '');
    
    const prompt = PROMPTS.PROPOSE_DEFINITION
      .replace('{projectContext}', projectContext)
      .replace('{blockPath}', blockPath)
      .replace('{blockName}', blockName)
      .replace('{conversation}', conversation || this.getFormattedHistory());

    try {
      const response = await callOllama(ARCHITECT_MODEL, prompt, PROMPTS.ARCHITECT_SYSTEM, {
        timeout: 90000,
        temperature: 0.7,
      });

      return {
        definition: response.content,
        duration: response.duration,
      };

    } catch (err) {
      logger.error('ArchitectLLM', `Propose definition error: ${err.message}`);
      throw err;
    }
  }

  /**
   * Extrahovat rozhodnutí z konverzace
   */
  async extractDecisions(conversation = null) {
    const conv = conversation || this.getFormattedHistory();
    
    const prompt = PROMPTS.EXTRACT_DECISIONS.replace('{conversation}', conv);

    try {
      const response = await callOllama(ARCHITECT_MODEL, prompt, null, {
        timeout: 60000,
        jsonMode: true,
        temperature: 0.3,
      });

      return extractJSON(response.content) || { decided: [], rejected: [], open: [] };

    } catch (err) {
      logger.warn('ArchitectLLM', `Extract decisions failed: ${err.message}`);
      return { decided: [], rejected: [], open: [] };
    }
  }

  /**
   * Vytvořit session summary
   */
  async createSessionSummary(blockPath, changes = []) {
    const prompt = PROMPTS.SESSION_SUMMARY
      .replace('{blockPath}', blockPath)
      .replace('{conversation}', this.getFormattedHistory())
      .replace('{changes}', changes.length > 0 
        ? changes.map(c => `- ${c.action}: ${c.path}`).join('\n')
        : 'Žádné změny souborů');

    try {
      const response = await callOllama(ARCHITECT_MODEL, prompt, null, {
        timeout: 60000,
        jsonMode: true,
        temperature: 0.3,
      });

      return extractJSON(response.content) || {
        goal: 'Neznámý',
        steps: [],
        result: 'Session dokončena',
        files: changes,
      };

    } catch (err) {
      logger.warn('ArchitectLLM', `Session summary failed: ${err.message}`);
      return {
        goal: blockPath,
        steps: [],
        result: 'Session dokončena',
        files: changes,
      };
    }
  }
}

export default ArchitectLLM;
