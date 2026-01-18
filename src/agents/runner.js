// C.3 v33 Agent Runner - Execution Engine
// ══════════════════════════════════════════════════════════════════════════════
// Runner je čistě deterministický:
// 1. Fetch data
// 2. Evaluate conditions
// 3. Detect trigger edges
// 4. Dispatch actions
//
// LLM je volán POUZE z akcí (notify s use_llm: true), nikdy z runneru

import { ConditionEvaluator } from './conditions.js';
import { TriggerEvaluator } from './triggers.js';

/**
 * Agent Runner - deterministic execution engine
 */
export class AgentRunner {
  constructor({ repository, llmServices = null, logger = console }) {
    this.repo = repository;
    this.llm = llmServices;
    this.logger = logger;
    this.conditions = new ConditionEvaluator();
    this.triggers = new TriggerEvaluator();
    
    // Source handlers
    this.sourceHandlers = {
      http: this.fetchHttp.bind(this),
      scraper: this.fetchScraper.bind(this),
      rss: this.fetchRss.bind(this),
      database: this.fetchDatabase.bind(this)
    };
  }
  
  /**
   * Execute agent
   * @param {string} agentId
   * @param {object} options - { force: boolean }
   */
  async execute(agentId, options = {}) {
    const agent = this.repo.getAgent(agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);
    if (!agent.enabled && !options.force) {
      return { status: 'skipped', reason: 'disabled' };
    }
    
    const runId = this.repo.createRun(agentId);
    const now = new Date();
    const log = [];
    
    try {
      // ══════════════════════════════════════════════════════════════════════
      // STEP 0: Check schema status
      // ══════════════════════════════════════════════════════════════════════
      const prevSchemaStatus = agent.state?.schemaStatus || 'unknown';
      if (prevSchemaStatus === 'broken' && !options.force) {
        log.push(`[${this.timestamp()}] ⛔ Agent schema is BROKEN - skipping run`);
        this.repo.completeRun(runId, 'skipped', { reason: 'schema_broken' }, log);
        return { status: 'skipped', reason: 'schema_broken', log };
      }
      
      // ══════════════════════════════════════════════════════════════════════
      // STEP 1: Build context
      // ══════════════════════════════════════════════════════════════════════
      log.push(`[${this.timestamp()}] Starting agent: ${agent.name}`);
      
      const def = agent.definition;
      const context = {
        params: agent.params || {},
        state: agent.state || {},
        now,
        sources: {},
        _schemaValidation: { errors: [], warnings: [] }
      };
      
      // ══════════════════════════════════════════════════════════════════════
      // STEP 2: Fetch sources (parallel)
      // ══════════════════════════════════════════════════════════════════════
      log.push(`[${this.timestamp()}] Fetching ${def.sources.length} sources...`);
      
      const sourcePromises = def.sources.map(async (source) => {
        try {
          const handler = this.sourceHandlers[source.type];
          if (!handler) throw new Error(`Unknown source type: ${source.type}`);
          
          const config = this.interpolate(source.config, context);
          const data = await handler(config, context);
          
          // Filter seen items for HUNTER pattern
          const filteredData = this.filterSeenItems(data, source.id, context.state);
          
          context.sources[source.id] = { 
            status: 'ok', 
            data: filteredData,
            raw_count: Array.isArray(data) ? data.length : null,
            filtered_count: Array.isArray(filteredData) ? filteredData.length : null
          };
          log.push(`  ✓ ${source.id}: OK`);
        } catch (err) {
          context.sources[source.id] = { status: 'error', error: err.message };
          log.push(`  ✗ ${source.id}: ${err.message}`);
        }
      });
      await Promise.all(sourcePromises);
      
      // ══════════════════════════════════════════════════════════════════════
      // STEP 3: Evaluate conditions (DETERMINISTIC)
      // ══════════════════════════════════════════════════════════════════════
      log.push(`[${this.timestamp()}] Evaluating ${def.conditions?.length || 0} conditions...`);
      
      const conditionResults = this.conditions.evaluateAll(
        def.conditions || [],
        context
      );
      
      // Track schema status
      let schemaStatus = 'valid';
      let schemaError = null;
      
      // Check for invalid conditions (schema problems)
      let invalidCount = 0;
      for (const d of conditionResults.details) {
        if (d.status === 'invalid') {
          invalidCount++;
          log.push(`  ⛔ ${d.id}: INVALID - ${d.reason}`);
          context._schemaValidation.errors.push({
            condition: d.id,
            error: d.reason,
            fieldStatus: d.fieldStatus
          });
        } else {
          log.push(`  ${d.passed ? '✓' : '○'} ${d.id}: ${d.reason}`);
        }
      }
      
      // If too many conditions are invalid, mark schema as degraded
      const totalConditions = def.conditions?.length || 0;
      if (totalConditions > 0 && invalidCount > 0) {
        const invalidRatio = invalidCount / totalConditions;
        
        if (invalidRatio >= 0.5) {
          // 50%+ conditions invalid = BROKEN
          log.push(`[${this.timestamp()}] ⛔ Schema BROKEN: ${invalidCount}/${totalConditions} conditions invalid`);
          schemaStatus = 'broken';
          schemaError = `${invalidCount}/${totalConditions} conditions are invalid`;
          
          // Auto-disable agent
          this.repo.updateAgent(agentId, { enabled: false });
          log.push(`[${this.timestamp()}] ⛔ Agent automatically DISABLED due to broken schema`);
          
        } else if (invalidRatio > 0) {
          // Some conditions invalid = DEGRADED
          log.push(`[${this.timestamp()}] ⚠️ Schema DEGRADED: ${invalidCount}/${totalConditions} conditions invalid`);
          schemaStatus = 'degraded';
          schemaError = `${invalidCount}/${totalConditions} conditions are invalid`;
        }
      }
      
      // ══════════════════════════════════════════════════════════════════════
      // STEP 4: Detect trigger edges
      // ══════════════════════════════════════════════════════════════════════
      log.push(`[${this.timestamp()}] Evaluating ${def.triggers?.length || 0} triggers...`);
      
      const triggerResults = this.triggers.evaluateAll(
        def.triggers || [],
        conditionResults.results,
        context.state,
        now
      );
      
      for (const d of triggerResults.details) {
        log.push(`  ${d.fired ? '🔔' : '○'} ${d.id}: ${d.reason}`);
      }
      
      // Update state with trigger tracking AND schema status
      const newState = { 
        ...triggerResults.newState, 
        schemaStatus,
        ...(schemaError && { schemaError })
      };
      
      // ══════════════════════════════════════════════════════════════════════
      // STEP 5: Execute actions
      // ══════════════════════════════════════════════════════════════════════
      const executedActions = [];
      
      if (triggerResults.fired.length > 0 || def.actions?.some(a => a.trigger_id === null)) {
        log.push(`[${this.timestamp()}] Executing actions...`);
        
        for (const action of def.actions || []) {
          // Check if action should run
          if (action.trigger_id !== null && !triggerResults.fired.includes(action.trigger_id)) {
            continue;
          }
          
          try {
            await this.executeAction(action, context, agentId, runId, triggerResults);
            executedActions.push({ type: action.type, trigger: action.trigger_id, status: 'ok' });
            log.push(`  ✓ ${action.type}: OK`);
          } catch (err) {
            executedActions.push({ type: action.type, trigger: action.trigger_id, status: 'error', error: err.message });
            log.push(`  ✗ ${action.type}: ${err.message}`);
          }
        }
      } else {
        log.push(`[${this.timestamp()}] No triggers fired, skipping actions`);
      }
      
      // ══════════════════════════════════════════════════════════════════════
      // STEP 6: Update state and complete run
      // ══════════════════════════════════════════════════════════════════════
      newState._last_run = now.toISOString();
      this.repo.updateAgentState(agentId, newState);
      
      const duration = Date.now() - now.getTime();
      log.push(`[${this.timestamp()}] Completed in ${duration}ms`);
      
      // Create explain record
      const explainRecord = {
        run_id: runId,
        timestamp: now.toISOString(),
        sources: Object.keys(context.sources).map(id => ({
          id,
          status: context.sources[id].status,
          count: context.sources[id].filtered_count
        })),
        conditions: conditionResults.details,
        triggers: triggerResults.details.filter(t => t.fired),
        actions: executedActions
      };
      
      this.repo.completeRun(runId, {
        status: 'success',
        triggers_fired: triggerResults.fired,
        actions_executed: executedActions.length,
        explain: explainRecord,
        log: log.join('\n')
      });
      
      return {
        status: 'success',
        runId,
        duration,
        triggered: triggerResults.fired,
        actions: executedActions,
        explain: explainRecord
      };
      
    } catch (err) {
      log.push(`[${this.timestamp()}] ERROR: ${err.message}`);
      
      this.repo.completeRun(runId, {
        status: 'error',
        error: err.message,
        log: log.join('\n')
      });
      
      return {
        status: 'error',
        runId,
        error: err.message,
        log
      };
    }
  }
  
  // ════════════════════════════════════════════════════════════════════════════
  // ACTIONS
  // ════════════════════════════════════════════════════════════════════════════
  
  async executeAction(action, context, agentId, runId, triggerResults) {
    switch (action.type) {
      case 'notify':
        return this.actionNotify(action, context, agentId, runId);
      case 'store':
        return this.actionStore(action, context, agentId);
      case 'webhook':
        return this.actionWebhook(action, context);
      case 'mark_seen':
        return this.actionMarkSeen(action, context, agentId);
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }
  
  async actionNotify(action, context, agentId, runId) {
    const { config } = action;
    
    let title = this.interpolate(config.title || '', context);
    let body = this.interpolate(config.body || '', context);
    
    // LLM pouze pro formátování textu (presentation-only)
    if (config.use_llm && this.llm) {
      body = await this.llm.formatNotification({
        template: body,
        data: {
          sources: context.sources,
          params: context.params
        }
      });
    }
    
    this.repo.createNotification(agentId, runId, {
      title,
      body,
      priority: config.priority || 'normal',
      data: {
        trigger: action.trigger_id,
        context_snapshot: this.createSnapshot(context)
      }
    });
  }
  
  async actionStore(action, context, agentId) {
    const { config } = action;
    const key = config.key;
    let value = this.interpolate(config.value, context);
    
    if (config.append) {
      const current = this.repo.getAgentData(agentId, key) || [];
      if (Array.isArray(current)) {
        value = [...current, value].slice(-(config.max_items || 1000));
      }
    }
    
    this.repo.setAgentData(agentId, key, value);
  }
  
  async actionWebhook(action, context) {
    const { config } = action;
    const url = this.interpolate(config.url, context);
    const body = this.interpolate(config.body || {}, context);
    
    const response = await fetch(url, {
      method: config.method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'C3-Agent/33',
        ...config.headers
      },
      body: JSON.stringify(body),
      timeout: 30000
    });
    
    if (!response.ok) {
      throw new Error(`Webhook failed: HTTP ${response.status}`);
    }
  }
  
  async actionMarkSeen(action, context, agentId) {
    const { config } = action;
    const sourceData = context.sources[config.source_id]?.data;
    
    if (!sourceData || !Array.isArray(sourceData)) return;
    
    const currentSeen = new Set(context.state.seen_ids || []);
    
    for (const item of sourceData) {
      const id = this.getNestedValue(item, config.id_field);
      if (id) currentSeen.add(String(id));
    }
    
    // Keep only last 10000 IDs
    const seenArray = Array.from(currentSeen).slice(-10000);
    this.repo.updateAgentState(agentId, {
      ...context.state,
      seen_ids: seenArray
    });
  }
  
  // ════════════════════════════════════════════════════════════════════════════
  // DATA SOURCES
  // ════════════════════════════════════════════════════════════════════════════
  
  async fetchHttp(config, context) {
    const url = new URL(config.url);
    for (const [k, v] of Object.entries(config.params || {})) {
      url.searchParams.set(k, v);
    }
    
    const response = await fetch(url.toString(), {
      method: config.method || 'GET',
      headers: {
        'User-Agent': 'C3-Agent/33',
        'Accept': 'application/json',
        ...config.headers
      },
      body: config.body ? JSON.stringify(config.body) : undefined,
      timeout: config.timeout || 30000
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const contentType = response.headers.get('content-type') || '';
    return contentType.includes('json') ? response.json() : response.text();
  }
  
  async fetchScraper(config, context) {
    const response = await fetch(config.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'cs,en;q=0.9'
      },
      timeout: config.timeout || 30000
    });
    
    const html = await response.text();
    
    // Try to detect if it's actually JSON
    if (html.trim().startsWith('{') || html.trim().startsWith('[')) {
      try {
        return JSON.parse(html);
      } catch (e) {
        // Not JSON, continue with HTML parsing
      }
    }
    
    // Use cheerio for HTML parsing if available
    let $;
    try {
      const cheerio = await import('cheerio');
      $ = cheerio.load(html);
    } catch (e) {
      // Cheerio not available, use regex fallback
      console.log('Cheerio not available, using regex fallback');
      return this.scrapeWithRegex(html, config);
    }
    
    const result = {
      url: config.url,
      timestamp: new Date().toISOString(),
      items: []
    };
    
    // If selectors are provided, use them
    if (config.selectors) {
      const itemSelector = config.selectors.item || config.selectors.items || '.property, .listing, .item, article';
      const items = $(itemSelector);
      
      items.each((i, el) => {
        if (config.limit && i >= config.limit) return false;
        
        const item = {};
        const $el = $(el);
        
        // Extract ID
        item.id = $el.attr('data-id') || 
                  $el.attr('id') || 
                  $el.find('[data-id]').attr('data-id') ||
                  `item-${i}`;
        
        // Extract link
        const link = $el.find('a').first().attr('href') || $el.attr('href');
        if (link) {
          item.link = link.startsWith('http') ? link : new URL(link, config.url).href;
        }
        
        // Extract price - try multiple patterns
        const priceText = $el.find(config.selectors?.price || '.price, .cena, [class*="price"], [class*="cena"]').first().text();
        const priceMatch = priceText.match(/([0-9\s]+)\s*(Kč|CZK|€|EUR|\$|USD)?/i);
        if (priceMatch) {
          item.price = parseInt(priceMatch[1].replace(/\s/g, '')) || 0;
          item.price_text = priceText.trim();
        }
        
        // Extract area (m²)
        const areaText = $el.find(config.selectors?.area || '.area, .plocha, [class*="area"], [class*="plocha"]').text();
        const areaMatch = areaText.match(/(\d+)\s*m[²2]/i);
        if (areaMatch) {
          item.area = parseInt(areaMatch[1]) || 0;
        }
        
        // Extract land area
        const landText = $el.find(config.selectors?.land_area || '.land, .pozemek, [class*="land"], [class*="pozemek"]').text();
        const landMatch = landText.match(/(\d+)\s*m[²2]/i);
        if (landMatch) {
          item.land_area = parseInt(landMatch[1]) || 0;
        }
        
        // Extract title
        item.title = $el.find(config.selectors?.title || 'h1, h2, h3, .title, .name, .nazev').first().text().trim();
        
        // Extract location
        item.location = $el.find(config.selectors?.location || '.location, .address, .adresa, .lokalita').first().text().trim();
        
        // Extract image
        const img = $el.find('img').first();
        item.image = img.attr('src') || img.attr('data-src');
        
        // Extract all text for fallback parsing
        item._text = $el.text().replace(/\s+/g, ' ').trim().substring(0, 500);
        
        // Try to extract numbers from text if specific fields not found
        if (!item.price || !item.area) {
          const numbers = item._text.match(/\d[\d\s]*\d/g) || [];
          numbers.forEach(num => {
            const val = parseInt(num.replace(/\s/g, ''));
            if (!item.price && val > 100000 && val < 100000000) {
              item.price = val;
            } else if (!item.area && val > 20 && val < 10000) {
              if (!item.area) item.area = val;
              else if (!item.land_area) item.land_area = val;
            }
          });
        }
        
        result.items.push(item);
      });
      
      // Summary stats
      result.count = result.items.length;
      if (result.items.length > 0) {
        result.min_price = Math.min(...result.items.filter(i => i.price).map(i => i.price));
        result.max_price = Math.max(...result.items.filter(i => i.price).map(i => i.price));
        result.avg_price = Math.round(result.items.filter(i => i.price).reduce((a, b) => a + b.price, 0) / result.items.filter(i => i.price).length);
      }
    } else {
      // Auto-detect items without selectors
      result.items = this.autoDetectItems($, config.url, config.limit || 20);
      result.count = result.items.length;
    }
    
    return result;
  }
  
  /**
   * Auto-detect property listings from HTML
   */
  autoDetectItems($, baseUrl, limit) {
    const items = [];
    
    // Common selectors for property listings
    const selectors = [
      '.property', '.listing', '.estate', '.item', '.result',
      '[class*="property"]', '[class*="listing"]', '[class*="estate"]',
      'article', '.card', '.offer'
    ];
    
    for (const selector of selectors) {
      const elements = $(selector);
      if (elements.length > 2) {
        elements.each((i, el) => {
          if (i >= limit) return false;
          
          const $el = $(el);
          const text = $el.text().replace(/\s+/g, ' ').trim();
          
          // Must have some substance
          if (text.length < 20) return;
          
          const item = {
            id: $el.attr('data-id') || $el.attr('id') || `auto-${i}`,
            _text: text.substring(0, 500)
          };
          
          // Find link
          const link = $el.find('a').first().attr('href');
          if (link) {
            item.link = link.startsWith('http') ? link : new URL(link, baseUrl).href;
          }
          
          // Extract numbers
          const priceMatch = text.match(/(\d[\d\s]{2,})\s*(Kč|CZK|,-)/i);
          if (priceMatch) {
            item.price = parseInt(priceMatch[1].replace(/\s/g, ''));
          }
          
          const areaMatches = text.match(/(\d+)\s*m[²2]/gi) || [];
          areaMatches.forEach((m, idx) => {
            const val = parseInt(m);
            if (idx === 0) item.area = val;
            if (idx === 1) item.land_area = val;
          });
          
          items.push(item);
        });
        
        if (items.length > 0) break;
      }
    }
    
    return items;
  }
  
  /**
   * Regex fallback when cheerio not available
   */
  scrapeWithRegex(html, config) {
    const result = {
      url: config.url,
      timestamp: new Date().toISOString(),
      items: [],
      _raw_length: html.length
    };
    
    // Try to extract prices
    const priceMatches = html.match(/(\d[\d\s]{4,})\s*(Kč|CZK|,-)/gi) || [];
    priceMatches.slice(0, 20).forEach((m, i) => {
      const price = parseInt(m.replace(/[^\d]/g, ''));
      if (price > 100000 && price < 100000000) {
        result.items.push({
          id: `price-${i}`,
          price,
          price_text: m.trim()
        });
      }
    });
    
    result.count = result.items.length;
    return result;
  }
  
  async fetchRss(config, context) {
    const response = await fetch(config.url, {
      headers: { 'User-Agent': 'C3-Agent/33' },
      timeout: config.timeout || 30000
    });
    
    const xml = await response.text();
    const items = [];
    const limit = config.limit || 20;
    
    // Simple RSS parsing
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;
    
    while ((match = itemRegex.exec(xml)) !== null && items.length < limit) {
      const item = match[1];
      items.push({
        id: item.match(/<guid[^>]*>(.*?)<\/guid>/i)?.[1]?.trim() || 
            item.match(/<link>(.*?)<\/link>/i)?.[1]?.trim() || 
            `rss-${items.length}`,
        title: item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i)?.[1]?.trim() || '',
        link: item.match(/<link>(.*?)<\/link>/i)?.[1]?.trim() || '',
        description: item.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i)?.[1]
          ?.trim().replace(/<[^>]+>/g, '').substring(0, 500) || '',
        pubDate: item.match(/<pubDate>(.*?)<\/pubDate>/i)?.[1] || ''
      });
    }
    
    return items;
  }
  
  async fetchDatabase(config, context) {
    const { table, where } = config;
    // Use repository to query allowed tables
    return this.repo.queryAgentData(table, where) || [];
  }
  
  // ════════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ════════════════════════════════════════════════════════════════════════════
  
  /**
   * Filter out already seen items (for HUNTER pattern)
   */
  filterSeenItems(data, sourceId, state) {
    if (!Array.isArray(data)) return data;
    
    const seenIds = new Set(state.seen_ids || []);
    if (seenIds.size === 0) return data;
    
    return data.filter(item => {
      const id = item.id || item._id || item.guid;
      return !id || !seenIds.has(String(id));
    });
  }
  
  /**
   * Interpolate {{path}} in strings
   */
  interpolate(template, context) {
    if (typeof template !== 'string') {
      if (Array.isArray(template)) {
        return template.map(t => this.interpolate(t, context));
      }
      if (typeof template === 'object' && template !== null) {
        const result = {};
        for (const [k, v] of Object.entries(template)) {
          result[k] = this.interpolate(v, context);
        }
        return result;
      }
      return template;
    }
    
    return template.replace(/\{\{([\w.[\]*]+)\}\}/g, (match, path) => {
      const value = this.getNestedValue(context, path);
      if (value === undefined) return match;
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    });
  }
  
  getNestedValue(obj, path) {
    return path.split('.').reduce((acc, part) => {
      if (acc === null || acc === undefined) return undefined;
      const indexMatch = part.match(/^(\w+)\[(\d+)\]$/);
      if (indexMatch) return acc[indexMatch[1]]?.[parseInt(indexMatch[2])];
      return acc[part];
    }, obj);
  }
  
  createSnapshot(context) {
    // Create minimal snapshot for explain/audit
    return {
      params: context.params,
      source_status: Object.fromEntries(
        Object.entries(context.sources).map(([k, v]) => [k, v.status])
      )
    };
  }
  
  timestamp() {
    return new Date().toISOString().substring(11, 23);
  }
  
  /**
   * Dry run - execute agent definition without saving state
   * @param {object} definition - Agent definition to test
   * @returns {Promise<object>} - Test results
   */
  async dryRun(definition) {
    const log = [];
    const now = new Date();
    
    try {
      log.push({ time: this.timestamp(), msg: '🧪 Dry run started' });
      
      // Validate definition
      if (!definition) {
        throw new Error('No definition provided');
      }
      
      // Create mock context
      const context = {
        agent: { id: 'dry-run-test', definition },
        params: definition.params || {},
        sources: {},
        conditions: {},
        now
      };
      
      // Fetch sources (with timeout)
      if (definition.sources) {
        for (const source of definition.sources) {
          log.push({ time: this.timestamp(), msg: `📡 Fetching source: ${source.id}` });
          try {
            const handler = this.sourceHandlers[source.type];
            if (handler) {
              const data = await Promise.race([
                handler(source.config),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
              ]);
              context.sources[source.id] = data; // Store data directly, not wrapped
              
              // Better logging for scraper results
              if (data && data.items) {
                log.push({ time: this.timestamp(), msg: `✅ Source ${source.id}: OK (${data.items.length} položek)` });
                if (data.items.length > 0) {
                  const sample = data.items[0];
                  log.push({ time: this.timestamp(), msg: `   📦 Ukázka: price=${sample.price || '?'}, area=${sample.area || '?'}m², land=${sample.land_area || '?'}m²` });
                }
              } else {
                log.push({ time: this.timestamp(), msg: `✅ Source ${source.id}: OK (${JSON.stringify(data).length} bytes)` });
              }
            } else {
              context.sources[source.id] = { status: 'error', error: 'Unknown source type' };
              log.push({ time: this.timestamp(), msg: `❌ Source ${source.id}: Unknown type ${source.type}` });
            }
          } catch (err) {
            context.sources[source.id] = { status: 'error', error: err.message };
            log.push({ time: this.timestamp(), msg: `❌ Source ${source.id}: ${err.message}` });
          }
        }
      }
      
      // Evaluate conditions
      const conditionResults = {};
      if (definition.conditions) {
        for (const cond of definition.conditions) {
          log.push({ time: this.timestamp(), msg: `🔍 Evaluating condition: ${cond.id}` });
          try {
            const result = this.conditions.evaluate(cond, context);
            const passed = result.passed;
            conditionResults[cond.id] = passed;
            context.conditions[cond.id] = passed;
            log.push({ time: this.timestamp(), msg: `  → ${cond.id} = ${passed} (${result.reason || ''})` });
          } catch (err) {
            conditionResults[cond.id] = false;
            log.push({ time: this.timestamp(), msg: `❌ Condition ${cond.id}: ${err.message}` });
          }
        }
      }
      
      // Check triggers (without edge detection - just show what would trigger)
      const wouldTrigger = [];
      if (definition.triggers) {
        for (const trigger of definition.triggers) {
          const condId = trigger.condition_id || trigger.condition; // support both
          const condValue = conditionResults[condId];
          if (condValue) {
            wouldTrigger.push(trigger.id);
            log.push({ time: this.timestamp(), msg: `⚡ Trigger ${trigger.id} WOULD fire (condition ${condId} is true)` });
          } else {
            log.push({ time: this.timestamp(), msg: `💤 Trigger ${trigger.id} would NOT fire (condition ${condId} is false)` });
          }
        }
      }
      
      log.push({ time: this.timestamp(), msg: '🧪 Dry run completed' });
      
      return {
        success: true,
        log,
        summary: {
          sources: Object.keys(context.sources).length,
          sourcesOk: Object.values(context.sources).filter(s => s.status === 'ok').length,
          conditions: Object.keys(conditionResults).length,
          conditionsTrue: Object.values(conditionResults).filter(v => v).length,
          wouldTrigger
        }
      };
      
    } catch (err) {
      log.push({ time: this.timestamp(), msg: `❌ Error: ${err.message}` });
      return {
        success: false,
        error: err.message,
        log
      };
    }
  }
}

export default AgentRunner;
