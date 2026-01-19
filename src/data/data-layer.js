// C.3 v34.4 - Data Layer Contract
// ══════════════════════════════════════════════════════════════════════════════
// Společný kontrakt pro všechny doménové data sources
// Každá doména implementuje vlastní modul s vlastními pravidly

/**
 * @typedef {'high' | 'medium' | 'low'} ConfidenceLevel
 * @typedef {'web' | 'api' | 'cache' | 'heuristic' | 'manual'} DataSourceType
 */

/**
 * Společný výstupní kontrakt pro všechny data sources
 * @template T - typ položky (GPUItem, CarItem, RealEstateItem, ...)
 */
export class DataSourceResult {
  /**
   * @param {Object} options
   * @param {T[]} options.items - Načtená data
   * @param {string} options.market - Cílový trh (CZ, SK, DE, ...)
   * @param {string} options.currency - Měna (CZK, EUR, ...)
   * @param {ConfidenceLevel} options.confidence - Celková spolehlivost
   * @param {DataSourceType} options.source - Zdroj dat
   * @param {string} [options.sourceUrl] - URL zdroje (pokud web)
   * @param {Date} [options.updatedAt] - Čas získání dat
   * @param {string[]} [options.warnings] - Varování (sanity checks, ...)
   */
  constructor({
    items,
    market,
    currency,
    confidence,
    source,
    sourceUrl = null,
    updatedAt = new Date(),
    warnings = []
  }) {
    this.items = items;
    this.market = market;
    this.currency = currency;
    this.confidence = confidence;
    this.source = source;
    this.sourceUrl = sourceUrl;
    this.updatedAt = updatedAt;
    this.warnings = warnings;
  }
  
  /**
   * Serializace pro artifact pipeline
   */
  toArtifactData() {
    return {
      data: this.items,
      metadata: {
        confidence: this.confidence,
        market: this.market,
        source: this.source,
        sourceUrl: this.sourceUrl,
        generated_at: this.updatedAt.toISOString()
      },
      notes: this.warnings.length > 0 ? this.warnings : undefined
    };
  }
}

/**
 * Abstraktní base class pro doménové data sources
 * Každá doména (GPU, auta, reality) dědí a implementuje vlastní logiku
 */
export class DataSource {
  constructor(config = {}) {
    this.name = config.name || 'unknown';
    this.market = config.market || 'CZ';
    this.currency = config.currency || 'CZK';
    this.cacheTimeout = config.cacheTimeout || 3600000; // 1 hodina default
    this.cache = new Map();
  }
  
  /**
   * Hlavní fetch metoda - volá se z pipeline
   * @param {Object} query - Dotaz (specifický pro doménu)
   * @returns {Promise<DataSourceResult>}
   */
  async fetch(query) {
    const cacheKey = this.getCacheKey(query);
    
    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      console.log(`[DataSource:${this.name}] Cache hit for ${cacheKey}`);
      return cached.result;
    }
    
    // Try sources in order: web → api → heuristic
    let result;
    
    try {
      result = await this.fetchFromWeb(query);
      if (result && result.items.length > 0) {
        console.log(`[DataSource:${this.name}] Web fetch: ${result.items.length} items`);
      }
    } catch (err) {
      console.warn(`[DataSource:${this.name}] Web fetch failed: ${err.message}`);
    }
    
    // Fallback to heuristic if web failed
    if (!result || result.items.length === 0) {
      console.log(`[DataSource:${this.name}] Using heuristic fallback`);
      result = this.getHeuristicData(query);
    }
    
    // Apply sanity checks
    result = this.applySanityChecks(result);
    
    // Cache result
    this.cache.set(cacheKey, { result, timestamp: Date.now() });
    
    return result;
  }
  
  /**
   * Generuj cache key z query
   * @abstract
   */
  getCacheKey(query) {
    return JSON.stringify(query);
  }
  
  /**
   * Fetch data z webu (implementuje každá doména)
   * @abstract
   * @returns {Promise<DataSourceResult>}
   */
  async fetchFromWeb(query) {
    throw new Error('fetchFromWeb must be implemented by domain');
  }
  
  /**
   * Heuristická data jako fallback (implementuje každá doména)
   * @abstract
   * @returns {DataSourceResult}
   */
  getHeuristicData(query) {
    throw new Error('getHeuristicData must be implemented by domain');
  }
  
  /**
   * Aplikuj sanity checks na data (implementuje každá doména)
   * @abstract
   * @returns {DataSourceResult}
   */
  applySanityChecks(result) {
    return result;
  }
  
  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }
}

/**
 * Registry pro doménové data sources
 */
class DataSourceRegistry {
  constructor() {
    this.sources = new Map();
  }
  
  /**
   * Registruj data source pro doménu
   * @param {string} domain - Název domény (gpu, cars, realestate, ...)
   * @param {DataSource} source - Instance data source
   */
  register(domain, source) {
    this.sources.set(domain, source);
    console.log(`[DataRegistry] Registered: ${domain}`);
  }
  
  /**
   * Získej data source pro doménu
   * @param {string} domain
   * @returns {DataSource | null}
   */
  get(domain) {
    return this.sources.get(domain) || null;
  }
  
  /**
   * Detekuj doménu z query/topic
   * @param {string} topic
   * @returns {string | null}
   */
  detectDomain(topic) {
    const lower = topic.toLowerCase();
    
    // GPU patterns
    if (/rtx|gtx|radeon|rx\s?\d|grafik|gpu|nvidia|amd/i.test(lower)) {
      return 'gpu';
    }
    
    // Cars patterns
    if (/škoda|skoda|volkswagen|vw|bmw|audi|mercedes|toyota|auto|vozidl|motor/i.test(lower)) {
      return 'cars';
    }
    
    // Real estate patterns
    if (/byt|dům|dům|nemovitost|reality|pronájem|prodej.*m²|metr/i.test(lower)) {
      return 'realestate';
    }
    
    return null;
  }
  
  /**
   * Seznam registrovaných domén
   */
  listDomains() {
    return Array.from(this.sources.keys());
  }
}

// Singleton instance
export const dataRegistry = new DataSourceRegistry();

export default {
  DataSourceResult,
  DataSource,
  dataRegistry
};
