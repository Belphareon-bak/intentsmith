// C.3 Agent System - Agent Builder
// ══════════════════════════════════════════════════════════════════════════════
// LLM service that converts natural language descriptions into agent definitions
// This is the ONLY place where LLM is used for agent creation logic

import { validateAgentDefinition } from './schema.js';

/**
 * Agent Builder - creates agent definitions from natural language
 */
export class AgentBuilder {
  constructor({ llmClient }) {
    this.llm = llmClient;
  }

  /**
   * Build agent definition from user description
   * @param {string} description - Natural language description
   * @returns {Promise<{definition: object, explanation: string, questions?: string[]}>}
   */
  async buildFromDescription(description) {
    const systemPrompt = `Jsi C.3 Agent Builder. Tvým úkolem je převést uživatelův popis na strukturovanou definici agenta.

TYPY AGENTŮ:
- MONITOR: Sleduje podmínku a notifikuje při splnění (počasí, ceny, dostupnost)
- HUNTER: Hledá nové položky matching kritéria (inzeráty, nabídky)
- TRACKER: Sleduje vlastní položky v čase (záruky, platnosti, termíny)
- DIGEST: Pravidelně sbírá a sumarizuje informace (zprávy, updaty)
- SCOUT: Prozkoumává a navrhuje (AI novinky, vylepšení)

SCHEDULE FORMÁTY:
- cron: "0 8 * * *" (denně v 8:00), "0 */4 * * *" (každé 4h), "0 9 * * 1" (pondělí 9:00)
- interval: "1h", "30m", "4h", "1d"

SOURCE TYPY:
- http: REST API volání (vrací JSON)
- scraper: Web scraping HTML stránek - automaticky extrahuje položky z HTML
  - Scraper VŽDY vrací objekt: { items: [...], count: N, min_price, max_price }
  - Každá položka má: { id, title, price, area, land_area, location, link }
  - Pro reality weby (sreality, reality.cz, idnes reality) použij vždy TYPE "scraper"
- rss: RSS feed
- database: Interní DB dotaz

DŮLEŽITÉ PRO SCRAPER:
- URL může obsahovat filtry z webu (např. cena, lokalita) - to je OK
- Data jsou v sources.SOURCE_ID.items (array) a sources.SOURCE_ID.count
- Pro filtrování použij podmínky na sources.SOURCE_ID.items[*].price apod.
- Pro detekci nových položek použij condition type "new_items"

CONDITION OPERÁTORY (deterministické, ne LLM):
- compare: sources.X.items[*].price < 5000000 (filtruje položky)
- new_items: detekuje nové položky v array (pro HUNTER agenty)
- changed: hodnota se změnila od posledního běhu
- exists: pole existuje a není prázdné
- contains: field contains "text"

Odpověz POUZE tímto JSON formátem:
{
  "definition": {
    "id": "slug-format-id",
    "name": "Název agenta",
    "description": "Co agent dělá",
    "icon": "emoji",
    "type": "MONITOR|HUNTER|TRACKER|DIGEST|SCOUT",
    
    "schedule": {
      "type": "cron|interval",
      "value": "expression"
    },
    
    "sources": [
      {
        "id": "source_id",
        "type": "http|scraper|rss|database",
        "config": { ... }
      }
    ],
    
    "conditions": [
      {
        "id": "condition_id", 
        "type": "compare|date_diff|changed|exists|contains|new_items",
        "field": "sources.source_id.path.to.value",
        "operator": "<|>|==|<=|>=|!=",
        "value": "threshold",
        "array_mode": "any|all|min|max|avg (REQUIRED for fields with [*])",
        "params": {}
      }
    ],
    
    "triggers": [
      {
        "id": "trigger_id",
        "condition_id": "condition_id",
        "edge": "rising|falling|any",
        "cooldown": 300,
        "max_fires_per_day": 10
      }
    ],
    
    "actions": [
      {
        "type": "notify|store|webhook",
        "trigger_id": "trigger_id",
        "config": {
          "title": "Šablona s {{field}}",
          "body": "Text s {{proměnnými}}",
          "use_llm": true/false,
          "priority": "low|normal|high"
        }
      }
    ],
    
    "state_schema": {
      "seen_ids": [],
      "last_value": null,
      "history": []
    },
    
    "params": [
      {
        "name": "param_name",
        "type": "string|number|location|date|select",
        "label": "Popisek",
        "required": true/false,
        "default": "hodnota"
      }
    ]
  },
  
  "explanation": "Vysvětlení co agent bude dělat a jak",
  
  "questions": ["Případné doplňující otázky pokud popis není jasný"],
  
  "missing_info": ["Co ještě potřebuji vědět pro kompletní konfiguraci"]
}`;

    const response = await this.llm.chat({
      model: 'qwen3.5:27b',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: description }
      ],
      format: 'json'
    });

    try {
      const result = JSON.parse(response.content);
      
      // Post-process: auto-add array_mode for conditions with [*] in field path
      if (result.definition?.conditions) {
        for (const cond of result.definition.conditions) {
          if (cond.type === 'compare' && cond.field?.includes('[*]') && !cond.array_mode) {
            cond.array_mode = 'any'; // Default to "any" for arrays
          }
        }
      }
      
      // Validate the generated definition
      if (result.definition) {
        const validation = validateAgentDefinition(result.definition);
        if (!validation.valid) {
          result.validation_errors = validation.errors;
        }
      }
      
      return result;
    } catch (err) {
      return {
        error: 'Failed to parse LLM response',
        raw: response.content
      };
    }
  }

  /**
   * Refine agent definition based on user feedback
   * @param {object} currentDefinition - Current agent definition
   * @param {string} feedback - User's feedback/changes
   * @returns {Promise<object>}
   */
  async refineDefinition(currentDefinition, feedback) {
    const systemPrompt = `Jsi C.3 Agent Builder. Uživatel chce upravit existující definici agenta.

AKTUÁLNÍ DEFINICE:
${JSON.stringify(currentDefinition, null, 2)}

Uprav definici podle feedbacku uživatele. Zachovej strukturu, změň jen to co uživatel chce.

Odpověz POUZE JSON s upravenou definicí a vysvětlením změn:
{
  "definition": { ... upravená definice ... },
  "changes": ["Seznam provedených změn"],
  "explanation": "Co se změnilo a proč"
}`;

    const response = await this.llm.chat({
      model: 'qwen3.5:27b',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: feedback }
      ],
      format: 'json'
    });

    try {
      return JSON.parse(response.content);
    } catch (err) {
      return { error: 'Failed to parse response', raw: response.content };
    }
  }

  /**
   * Suggest improvements for an agent based on its run history
   * @param {object} agent - Agent with run history
   * @returns {Promise<object>}
   */
  async suggestImprovements(agent) {
    const systemPrompt = `Analyzuj agenta a jeho historii běhů. Navrhni vylepšení.

AGENT:
${JSON.stringify(agent, null, 2)}

Odpověz JSON:
{
  "suggestions": [
    {
      "type": "schedule|condition|source|action",
      "description": "Co změnit",
      "reason": "Proč",
      "priority": "high|medium|low"
    }
  ],
  "performance_summary": "Jak agent funguje",
  "issues_detected": ["Problémy"]
}`;

    const response = await this.llm.chat({
      model: 'qwen3.5:27b',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Analyzuj tohoto agenta a navrhni vylepšení.' }
      ],
      format: 'json'
    });

    try {
      return JSON.parse(response.content);
    } catch (err) {
      return { error: 'Failed to parse response' };
    }
  }
}

export default AgentBuilder;
