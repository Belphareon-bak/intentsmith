// C.3 v34.4 - Cars Domain Data Source
// ══════════════════════════════════════════════════════════════════════════════
// Doménový data source pro automobily
// Obsahuje: heuristická data pro Škoda, VW, další značky

import { DataSource, DataSourceResult, dataRegistry } from './data-layer.js';

/**
 * Car Item struktura
 * @typedef {Object} CarItem
 * @property {string} model - Název modelu
 * @property {string} kategorie - Segment (SUV, sedan, kombi, ...)
 * @property {string} motorizace - Typ pohonu
 * @property {string} vykon - Výkon
 * @property {number} cena_min - Minimální cena
 * @property {number} cena_max - Maximální cena
 * @property {'nové' | 'bazar' | 'odhad'} typ_ceny
 * @property {'high' | 'medium' | 'low'} jistota
 */

/**
 * Referenční data pro automobily (CZ trh, 2024-2025)
 * Ceny jsou základní, bez výbavy
 */
const CARS_REFERENCE_DATA = {
  // ══════════════════════════════════════════════════════════════════════════
  // ŠKODA
  // ══════════════════════════════════════════════════════════════════════════
  'Škoda Fabia': {
    znacka: 'Škoda',
    kategorie: 'Hatchback',
    motorizace: [
      { typ: '1.0 MPI 59 kW', vykon: '59 kW / 80 PS', cena_min: 399900, cena_max: 450000 },
      { typ: '1.0 TSI 70 kW', vykon: '70 kW / 95 PS', cena_min: 449900, cena_max: 520000 },
      { typ: '1.0 TSI 81 kW', vykon: '81 kW / 110 PS', cena_min: 489900, cena_max: 580000 },
    ],
    typ_ceny: 'nové',
    jistota: 'medium'
  },
  'Škoda Fabia Combi': {
    znacka: 'Škoda',
    kategorie: 'Kombi',
    motorizace: [
      { typ: '1.0 MPI 59 kW', vykon: '59 kW / 80 PS', cena_min: 439900, cena_max: 490000 },
      { typ: '1.0 TSI 70 kW', vykon: '70 kW / 95 PS', cena_min: 489900, cena_max: 560000 },
      { typ: '1.0 TSI 81 kW', vykon: '81 kW / 110 PS', cena_min: 529900, cena_max: 620000 },
    ],
    typ_ceny: 'nové',
    jistota: 'medium'
  },
  'Škoda Scala': {
    znacka: 'Škoda',
    kategorie: 'Hatchback',
    motorizace: [
      { typ: '1.0 TSI 70 kW', vykon: '70 kW / 95 PS', cena_min: 499900, cena_max: 580000 },
      { typ: '1.0 TSI 81 kW', vykon: '81 kW / 110 PS', cena_min: 549900, cena_max: 650000 },
      { typ: '1.5 TSI 110 kW', vykon: '110 kW / 150 PS', cena_min: 649900, cena_max: 750000 },
    ],
    typ_ceny: 'nové',
    jistota: 'medium'
  },
  'Škoda Octavia': {
    znacka: 'Škoda',
    kategorie: 'Liftback',
    motorizace: [
      { typ: '1.5 TSI 110 kW', vykon: '110 kW / 150 PS', cena_min: 699900, cena_max: 820000 },
      { typ: '2.0 TSI 150 kW', vykon: '150 kW / 204 PS', cena_min: 899900, cena_max: 1050000 },
      { typ: '2.0 TDI 110 kW', vykon: '110 kW / 150 PS', cena_min: 799900, cena_max: 950000 },
      { typ: '2.0 TDI 142 kW', vykon: '142 kW / 193 PS', cena_min: 899900, cena_max: 1100000 },
      { typ: 'RS 2.0 TSI 195 kW', vykon: '195 kW / 265 PS', cena_min: 1149900, cena_max: 1350000 },
    ],
    typ_ceny: 'nové',
    jistota: 'medium'
  },
  'Škoda Octavia Combi': {
    znacka: 'Škoda',
    kategorie: 'Kombi',
    motorizace: [
      { typ: '1.5 TSI 110 kW', vykon: '110 kW / 150 PS', cena_min: 749900, cena_max: 870000 },
      { typ: '2.0 TSI 150 kW', vykon: '150 kW / 204 PS', cena_min: 949900, cena_max: 1100000 },
      { typ: '2.0 TDI 110 kW', vykon: '110 kW / 150 PS', cena_min: 849900, cena_max: 1000000 },
      { typ: '2.0 TDI 142 kW 4x4', vykon: '142 kW / 193 PS', cena_min: 999900, cena_max: 1200000 },
      { typ: 'RS 2.0 TSI 195 kW', vykon: '195 kW / 265 PS', cena_min: 1199900, cena_max: 1400000 },
    ],
    typ_ceny: 'nové',
    jistota: 'medium'
  },
  'Škoda Superb': {
    znacka: 'Škoda',
    kategorie: 'Sedan/Liftback',
    motorizace: [
      { typ: '1.5 TSI 110 kW', vykon: '110 kW / 150 PS', cena_min: 949900, cena_max: 1100000 },
      { typ: '2.0 TSI 150 kW', vykon: '150 kW / 204 PS', cena_min: 1099900, cena_max: 1300000 },
      { typ: '2.0 TDI 142 kW', vykon: '142 kW / 193 PS', cena_min: 1149900, cena_max: 1350000 },
      { typ: 'iV PHEV', vykon: '150 kW / 204 PS', cena_min: 1249900, cena_max: 1500000 },
    ],
    typ_ceny: 'nové',
    jistota: 'medium'
  },
  'Škoda Superb Combi': {
    znacka: 'Škoda',
    kategorie: 'Kombi',
    motorizace: [
      { typ: '1.5 TSI 110 kW', vykon: '110 kW / 150 PS', cena_min: 999900, cena_max: 1150000 },
      { typ: '2.0 TSI 150 kW', vykon: '150 kW / 204 PS', cena_min: 1149900, cena_max: 1350000 },
      { typ: '2.0 TDI 142 kW 4x4', vykon: '142 kW / 193 PS', cena_min: 1249900, cena_max: 1450000 },
      { typ: 'iV PHEV', vykon: '150 kW / 204 PS', cena_min: 1299900, cena_max: 1550000 },
    ],
    typ_ceny: 'nové',
    jistota: 'medium'
  },
  'Škoda Kamiq': {
    znacka: 'Škoda',
    kategorie: 'SUV (malé)',
    motorizace: [
      { typ: '1.0 TSI 70 kW', vykon: '70 kW / 95 PS', cena_min: 549900, cena_max: 650000 },
      { typ: '1.0 TSI 81 kW', vykon: '81 kW / 110 PS', cena_min: 599900, cena_max: 720000 },
      { typ: '1.5 TSI 110 kW', vykon: '110 kW / 150 PS', cena_min: 699900, cena_max: 850000 },
    ],
    typ_ceny: 'nové',
    jistota: 'medium'
  },
  'Škoda Karoq': {
    znacka: 'Škoda',
    kategorie: 'SUV (kompaktní)',
    motorizace: [
      { typ: '1.0 TSI 81 kW', vykon: '81 kW / 110 PS', cena_min: 699900, cena_max: 820000 },
      { typ: '1.5 TSI 110 kW', vykon: '110 kW / 150 PS', cena_min: 799900, cena_max: 950000 },
      { typ: '2.0 TDI 110 kW', vykon: '110 kW / 150 PS', cena_min: 849900, cena_max: 1000000 },
      { typ: '2.0 TDI 142 kW 4x4', vykon: '142 kW / 193 PS', cena_min: 999900, cena_max: 1180000 },
    ],
    typ_ceny: 'nové',
    jistota: 'medium'
  },
  'Škoda Kodiaq': {
    znacka: 'Škoda',
    kategorie: 'SUV (velké)',
    motorizace: [
      { typ: '1.5 TSI 110 kW', vykon: '110 kW / 150 PS', cena_min: 949900, cena_max: 1100000 },
      { typ: '2.0 TSI 150 kW 4x4', vykon: '150 kW / 204 PS', cena_min: 1149900, cena_max: 1350000 },
      { typ: '2.0 TDI 142 kW 4x4', vykon: '142 kW / 193 PS', cena_min: 1099900, cena_max: 1300000 },
      { typ: 'RS 2.0 TSI 180 kW 4x4', vykon: '180 kW / 245 PS', cena_min: 1449900, cena_max: 1700000 },
    ],
    typ_ceny: 'nové',
    jistota: 'medium'
  },
  'Škoda Enyaq iV': {
    znacka: 'Škoda',
    kategorie: 'SUV (elektro)',
    motorizace: [
      { typ: 'Enyaq 60', vykon: '132 kW / 180 PS', cena_min: 1049900, cena_max: 1200000 },
      { typ: 'Enyaq 85', vykon: '210 kW / 286 PS', cena_min: 1249900, cena_max: 1450000 },
      { typ: 'Enyaq 85x 4x4', vykon: '210 kW / 286 PS', cena_min: 1349900, cena_max: 1550000 },
      { typ: 'Enyaq RS', vykon: '250 kW / 340 PS', cena_min: 1599900, cena_max: 1850000 },
    ],
    typ_ceny: 'nové',
    jistota: 'medium'
  },
  'Škoda Enyaq Coupé iV': {
    znacka: 'Škoda',
    kategorie: 'SUV Coupé (elektro)',
    motorizace: [
      { typ: 'Coupé 85', vykon: '210 kW / 286 PS', cena_min: 1349900, cena_max: 1550000 },
      { typ: 'Coupé 85x 4x4', vykon: '210 kW / 286 PS', cena_min: 1449900, cena_max: 1650000 },
      { typ: 'Coupé RS', vykon: '250 kW / 340 PS', cena_min: 1699900, cena_max: 1950000 },
    ],
    typ_ceny: 'nové',
    jistota: 'medium'
  },
  'Škoda Elroq': {
    znacka: 'Škoda',
    kategorie: 'SUV (elektro, kompaktní)',
    motorizace: [
      { typ: 'Elroq 50', vykon: '125 kW / 170 PS', cena_min: 949900, cena_max: 1100000 },
      { typ: 'Elroq 60', vykon: '150 kW / 204 PS', cena_min: 1049900, cena_max: 1200000 },
      { typ: 'Elroq 85', vykon: '210 kW / 286 PS', cena_min: 1199900, cena_max: 1400000 },
    ],
    typ_ceny: 'odhad',
    jistota: 'low'
  }
};

/**
 * Cars Data Source
 */
class CarsDataSource extends DataSource {
  constructor(config = {}) {
    super({
      name: 'cars',
      market: config.market || 'CZ',
      currency: config.currency || 'CZK',
      cacheTimeout: config.cacheTimeout || 86400000 // 24 hodin (ceny aut se mění pomaleji)
    });
  }
  
  getCacheKey(query) {
    return `cars:${query.brand || 'all'}:${query.category || 'all'}:${this.market}`;
  }
  
  /**
   * Fetch z webu - TODO: implementovat web scraping
   */
  async fetchFromWeb(query) {
    // TODO: Implementovat:
    // - skoda-auto.cz konfigurátor
    // - sauto.cz pro bazar
    // - TipCars.com
    
    return null;
  }
  
  /**
   * Heuristická data
   */
  getHeuristicData(query) {
    let items = [];
    
    for (const [model, data] of Object.entries(CARS_REFERENCE_DATA)) {
      // Filter by brand
      if (query.brand) {
        const brandLower = query.brand.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const dataBrandLower = data.znacka.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (!dataBrandLower.includes(brandLower) && !brandLower.includes(dataBrandLower)) continue;
      }
      
      // Filter by category
      if (query.category) {
        if (!data.kategorie.toLowerCase().includes(query.category.toLowerCase())) continue;
      }
      
      // Filter by fuel type
      if (query.fuelType) {
        const fuelLower = query.fuelType.toLowerCase();
        const hasMatchingEngine = data.motorizace.some(m => {
          if (fuelLower === 'elektro' || fuelLower === 'ev') {
            return m.typ.includes('kW') && !m.typ.includes('TSI') && !m.typ.includes('TDI');
          }
          if (fuelLower === 'benzin' || fuelLower === 'petrol') {
            return m.typ.includes('TSI') || m.typ.includes('MPI');
          }
          if (fuelLower === 'diesel' || fuelLower === 'nafta') {
            return m.typ.includes('TDI');
          }
          if (fuelLower === 'hybrid' || fuelLower === 'phev') {
            return m.typ.includes('iV') || m.typ.includes('PHEV');
          }
          return true;
        });
        if (!hasMatchingEngine) continue;
      }
      
      // Expand each motorization as separate item
      for (const motor of data.motorizace) {
        items.push({
          model: model,
          kategorie: data.kategorie,
          motorizace: motor.typ,
          vykon: motor.vykon,
          cena_min: motor.cena_min,
          cena_max: motor.cena_max,
          typ_ceny: data.typ_ceny,
          jistota: data.jistota
        });
      }
    }
    
    // Sort by price (ascending)
    items.sort((a, b) => a.cena_min - b.cena_min);
    
    return new DataSourceResult({
      items,
      market: this.market,
      currency: this.currency,
      confidence: 'medium',
      source: 'heuristic',
      warnings: [
        'Ceny jsou základní ceníkové bez výbavy a akčních slev',
        'Skutečné ceny se mohou lišit podle konfigurace a dealera'
      ]
    });
  }
  
  /**
   * Sanity checks pro ceny aut
   */
  applySanityChecks(result) {
    const warnings = [...result.warnings];
    let fixedCount = 0;
    
    const checkedItems = result.items.map(item => {
      let fixed = { ...item };
      
      // Základní sanity: auto nemůže stát méně než 200 000 Kč (nové)
      if (item.typ_ceny === 'nové' && item.cena_min < 200000) {
        fixed.cena_min = 300000;
        fixed.cena_max = Math.max(fixed.cena_max, 400000);
        fixedCount++;
      }
      
      // Elektromobil nemůže stát méně než 600 000 Kč (nový)
      if (item.typ_ceny === 'nové' && 
          (item.model.includes('Enyaq') || item.model.includes('Elroq') || item.model.includes('iV'))) {
        if (item.cena_min < 600000) {
          fixed.cena_min = 900000;
          fixed.cena_max = Math.max(fixed.cena_max, 1100000);
          fixedCount++;
        }
      }
      
      // Max cena pro běžné modely (ne luxusní)
      if (!item.model.includes('RS') && !item.model.includes('Superb')) {
        if (item.cena_max > 2000000) {
          fixed.cena_max = 1500000;
          fixedCount++;
        }
      }
      
      // Ensure min <= max
      if (fixed.cena_min > fixed.cena_max) {
        [fixed.cena_min, fixed.cena_max] = [fixed.cena_max, fixed.cena_min];
      }
      
      return fixed;
    });
    
    if (fixedCount > 0) {
      warnings.push(`Automatické korekce: ${fixedCount} cen upraveno`);
    }
    
    return new DataSourceResult({
      ...result,
      items: checkedItems,
      warnings
    });
  }
}

// Vytvoř a registruj instanci
const carsDataSource = new CarsDataSource();
dataRegistry.register('cars', carsDataSource);

export { CarsDataSource, CARS_REFERENCE_DATA, carsDataSource };
export default carsDataSource;
