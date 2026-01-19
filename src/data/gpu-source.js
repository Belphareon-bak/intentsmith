// C.3 v34.4 - GPU Domain Data Source
// ══════════════════════════════════════════════════════════════════════════════
// Referenční implementace doménového data source
// Obsahuje: heuristická data, sanity checks, coverage rules

import { DataSource, DataSourceResult, dataRegistry } from './data-layer.js';

/**
 * GPU Item struktura
 * @typedef {Object} GPUItem
 * @property {string} produkt - Název GPU
 * @property {string} specifikace - Specifikace (VRAM, etc.)
 * @property {number} cena_min - Minimální cena
 * @property {number} cena_max - Maximální cena
 * @property {'retail' | 'bazar' | 'odhad'} typ_ceny
 * @property {'high' | 'medium' | 'low'} jistota
 * @property {string} [generace] - Generace (50xx, 40xx, 30xx)
 */

/**
 * Referenční data pro GPU (CZ trh, 2024-2025)
 * Slouží jako:
 * 1. Heuristický fallback
 * 2. Sanity check reference
 */
const GPU_REFERENCE_DATA = {
  // RTX 50xx (odhady - ještě nevydáno / čerstvě vydáno)
  'RTX 5090': {
    specifikace: '32 GB GDDR7',
    cena_min: 55000,
    cena_max: 75000,
    typ_ceny: 'odhad',
    jistota: 'low',
    generace: '50xx'
  },
  'RTX 5080': {
    specifikace: '16 GB GDDR7',
    cena_min: 35000,
    cena_max: 50000,
    typ_ceny: 'odhad',
    jistota: 'low',
    generace: '50xx'
  },
  'RTX 5070 Ti': {
    specifikace: '16 GB GDDR7',
    cena_min: 22000,
    cena_max: 30000,
    typ_ceny: 'odhad',
    jistota: 'low',
    generace: '50xx'
  },
  'RTX 5070': {
    specifikace: '12 GB GDDR7',
    cena_min: 16000,
    cena_max: 22000,
    typ_ceny: 'odhad',
    jistota: 'low',
    generace: '50xx'
  },
  
  // RTX 40xx (retail)
  'RTX 4090': {
    specifikace: '24 GB GDDR6X',
    cena_min: 45000,
    cena_max: 60000,
    typ_ceny: 'retail',
    jistota: 'medium',
    generace: '40xx'
  },
  'RTX 4080 Super': {
    specifikace: '16 GB GDDR6X',
    cena_min: 30000,
    cena_max: 40000,
    typ_ceny: 'retail',
    jistota: 'medium',
    generace: '40xx'
  },
  'RTX 4080': {
    specifikace: '16 GB GDDR6X',
    cena_min: 28000,
    cena_max: 38000,
    typ_ceny: 'retail',
    jistota: 'medium',
    generace: '40xx'
  },
  'RTX 4070 Ti Super': {
    specifikace: '16 GB GDDR6X',
    cena_min: 24000,
    cena_max: 30000,
    typ_ceny: 'retail',
    jistota: 'medium',
    generace: '40xx'
  },
  'RTX 4070 Ti': {
    specifikace: '12 GB GDDR6X',
    cena_min: 22000,
    cena_max: 28000,
    typ_ceny: 'retail',
    jistota: 'medium',
    generace: '40xx'
  },
  'RTX 4070 Super': {
    specifikace: '12 GB GDDR6X',
    cena_min: 17000,
    cena_max: 22000,
    typ_ceny: 'retail',
    jistota: 'medium',
    generace: '40xx'
  },
  'RTX 4070': {
    specifikace: '12 GB GDDR6X',
    cena_min: 16000,
    cena_max: 20000,
    typ_ceny: 'retail',
    jistota: 'medium',
    generace: '40xx'
  },
  'RTX 4060 Ti': {
    specifikace: '8/16 GB GDDR6',
    cena_min: 12000,
    cena_max: 15000,
    typ_ceny: 'retail',
    jistota: 'medium',
    generace: '40xx'
  },
  'RTX 4060': {
    specifikace: '8 GB GDDR6',
    cena_min: 9000,
    cena_max: 12000,
    typ_ceny: 'retail',
    jistota: 'medium',
    generace: '40xx'
  },
  
  // RTX 30xx (bazar)
  'RTX 3090 Ti': {
    specifikace: '24 GB GDDR6X',
    cena_min: 20000,
    cena_max: 28000,
    typ_ceny: 'bazar',
    jistota: 'medium',
    generace: '30xx'
  },
  'RTX 3090': {
    specifikace: '24 GB GDDR6X',
    cena_min: 18000,
    cena_max: 25000,
    typ_ceny: 'bazar',
    jistota: 'medium',
    generace: '30xx'
  },
  'RTX 3080 Ti': {
    specifikace: '12 GB GDDR6X',
    cena_min: 14000,
    cena_max: 20000,
    typ_ceny: 'bazar',
    jistota: 'medium',
    generace: '30xx'
  },
  'RTX 3080': {
    specifikace: '10/12 GB GDDR6X',
    cena_min: 12000,
    cena_max: 18000,
    typ_ceny: 'bazar',
    jistota: 'medium',
    generace: '30xx'
  },
  'RTX 3070 Ti': {
    specifikace: '8 GB GDDR6X',
    cena_min: 9000,
    cena_max: 13000,
    typ_ceny: 'bazar',
    jistota: 'medium',
    generace: '30xx'
  },
  'RTX 3070': {
    specifikace: '8 GB GDDR6',
    cena_min: 8000,
    cena_max: 12000,
    typ_ceny: 'bazar',
    jistota: 'medium',
    generace: '30xx'
  },
  'RTX 3060 Ti': {
    specifikace: '8 GB GDDR6',
    cena_min: 7000,
    cena_max: 10000,
    typ_ceny: 'bazar',
    jistota: 'medium',
    generace: '30xx'
  },
  'RTX 3060': {
    specifikace: '12 GB GDDR6',
    cena_min: 6000,
    cena_max: 9000,
    typ_ceny: 'bazar',
    jistota: 'medium',
    generace: '30xx'
  }
};

/**
 * GPU Data Source
 */
class GPUDataSource extends DataSource {
  constructor(config = {}) {
    super({
      name: 'gpu',
      market: config.market || 'CZ',
      currency: config.currency || 'CZK',
      cacheTimeout: config.cacheTimeout || 3600000 // 1 hodina
    });
  }
  
  getCacheKey(query) {
    return `gpu:${query.brand || 'all'}:${query.generation || 'all'}:${this.market}`;
  }
  
  /**
   * Fetch z webu - TODO: implementovat web scraping
   * Pro teď vracíme null (fallback na heuristiku)
   */
  async fetchFromWeb(query) {
    // TODO: Implementovat:
    // - Alza.cz scraping
    // - CZC.cz scraping
    // - Bazos.cz pro bazar
    
    // Pro teď vracíme null = použije se heuristika
    return null;
  }
  
  /**
   * Heuristická data jako fallback
   */
  getHeuristicData(query) {
    let items = [];
    
    // Filtruj podle query
    for (const [name, data] of Object.entries(GPU_REFERENCE_DATA)) {
      // Filter by brand
      if (query.brand) {
        const brandLower = query.brand.toLowerCase();
        if (brandLower === 'nvidia' && !name.includes('RTX') && !name.includes('GTX')) continue;
        if (brandLower === 'amd' && !name.includes('RX')) continue;
      }
      
      // Filter by generation
      if (query.generation) {
        if (!data.generace?.includes(query.generation)) continue;
      }
      
      // Filter by VRAM
      if (query.minVram) {
        const vramMatch = data.specifikace.match(/(\d+)\s*GB/);
        if (vramMatch && parseInt(vramMatch[1]) < query.minVram) continue;
      }
      
      items.push({
        produkt: name,
        specifikace: data.specifikace,
        cena_min: data.cena_min,
        cena_max: data.cena_max,
        typ_ceny: data.typ_ceny,
        jistota: data.jistota
      });
    }
    
    // Sort by price (descending)
    items.sort((a, b) => b.cena_max - a.cena_max);
    
    return new DataSourceResult({
      items,
      market: this.market,
      currency: this.currency,
      confidence: 'medium',
      source: 'heuristic',
      warnings: ['Ceny jsou odhadové na základě znalosti trhu CZ (leden 2025)']
    });
  }
  
  /**
   * Sanity checks pro GPU ceny
   */
  applySanityChecks(result) {
    const warnings = [...result.warnings];
    let fixedCount = 0;
    
    const checkedItems = result.items.map(item => {
      const ref = GPU_REFERENCE_DATA[item.produkt];
      if (!ref) return item;
      
      let fixed = { ...item };
      
      // Check min price
      if (item.cena_min < ref.cena_min * 0.5) {
        fixed.cena_min = ref.cena_min;
        fixedCount++;
      }
      if (item.cena_min > ref.cena_max * 1.5) {
        fixed.cena_min = ref.cena_min;
        fixedCount++;
      }
      
      // Check max price
      if (item.cena_max < ref.cena_min * 0.5) {
        fixed.cena_max = ref.cena_max;
        fixedCount++;
      }
      if (item.cena_max > ref.cena_max * 1.5) {
        fixed.cena_max = ref.cena_max;
        fixedCount++;
      }
      
      // Ensure min <= max
      if (fixed.cena_min > fixed.cena_max) {
        [fixed.cena_min, fixed.cena_max] = [fixed.cena_max, fixed.cena_min];
      }
      
      return fixed;
    });
    
    if (fixedCount > 0) {
      warnings.push(`Automatické korekce: ${fixedCount} cen upraveno podle referenčních dat`);
    }
    
    return new DataSourceResult({
      ...result,
      items: checkedItems,
      warnings
    });
  }
  
  /**
   * Rozšiř data o chybějící generace (coverage policy)
   */
  ensureCoverage(result, query = {}) {
    const items = [...result.items];
    const existingProducts = new Set(items.map(i => i.produkt));
    
    // Zajisti pokrytí všech generací
    const requiredGenerations = ['50xx', '40xx', '30xx'];
    
    for (const gen of requiredGenerations) {
      const hasGen = items.some(i => {
        const ref = GPU_REFERENCE_DATA[i.produkt];
        return ref?.generace === gen;
      });
      
      if (!hasGen) {
        // Přidej alespoň jeden model z této generace
        for (const [name, data] of Object.entries(GPU_REFERENCE_DATA)) {
          if (data.generace === gen && !existingProducts.has(name)) {
            items.push({
              produkt: name,
              specifikace: data.specifikace,
              cena_min: data.cena_min,
              cena_max: data.cena_max,
              typ_ceny: data.typ_ceny,
              jistota: data.jistota
            });
            break;
          }
        }
      }
    }
    
    return new DataSourceResult({
      ...result,
      items
    });
  }
}

// Vytvoř a registruj instanci
const gpuDataSource = new GPUDataSource();
dataRegistry.register('gpu', gpuDataSource);

export { GPUDataSource, GPU_REFERENCE_DATA, gpuDataSource };
export default gpuDataSource;
