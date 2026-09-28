// C.3 Architect Mode - LLM Client
// ══════════════════════════════════════════════════════════════════════════════
//
// ArchitectLLM = ADVISOR
// - Radí, navrhuje, NIKDY nerozhoduje
// - Žádné generování kódu (to je CoderLLM)
// - Žádné rozhodování o next step (to je Orchestrator)
//
// v36.9.1: Migrated to LLMGateway with WORKFLOW_THINKER auth token
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { PROMPTS } from './prompts.js';
import { callWithAuth } from '../llm/gateway.js';
import { createAuthToken, LLMCallerRole } from '../llm/auth-types.js';
import { extractJSON } from '../llm/client.js';

const ARCHITECT_MODEL = 'qwen3.5:27b';

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
      const token = createAuthToken({
        role: LLMCallerRole.WORKFLOW_THINKER,
        decisionId: `architect_converse_${Date.now()}`,
        auditContext: { sessionId: 'architect' }
      });

      const response = await callWithAuth(token, prompt, {
        model: ARCHITECT_MODEL,
        temperature: 0.8,
        timeout: 60000
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
      const token = createAuthToken({
        role: LLMCallerRole.WORKFLOW_THINKER,
        decisionId: `architect_confidence_${Date.now()}`,
        auditContext: { sessionId: 'architect' }
      });

      const response = await callWithAuth(token, prompt, {
        model: ARCHITECT_MODEL,
        temperature: 0.3,
        timeout: 30000,
        format: 'json'
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
      const token = createAuthToken({
        role: LLMCallerRole.WORKFLOW_THINKER,
        decisionId: `architect_definition_${Date.now()}`,
        auditContext: { sessionId: 'architect' }
      });

      const response = await callWithAuth(token, prompt, {
        model: ARCHITECT_MODEL,
        systemPrompt: PROMPTS.ARCHITECT_SYSTEM,
        temperature: 0.7,
        timeout: 90000
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
      const token = createAuthToken({
        role: LLMCallerRole.WORKFLOW_THINKER,
        decisionId: `architect_decisions_${Date.now()}`,
        auditContext: { sessionId: 'architect' }
      });

      const response = await callWithAuth(token, prompt, {
        model: ARCHITECT_MODEL,
        temperature: 0.3,
        timeout: 60000,
        format: 'json'
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
      const token = createAuthToken({
        role: LLMCallerRole.WORKFLOW_THINKER,
        decisionId: `architect_summary_${Date.now()}`,
        auditContext: { sessionId: 'architect' }
      });

      const response = await callWithAuth(token, prompt, {
        model: ARCHITECT_MODEL,
        temperature: 0.3,
        timeout: 60000,
        format: 'json'
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
