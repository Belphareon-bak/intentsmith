// C.3 v34.4 - Data Layer Index
// ══════════════════════════════════════════════════════════════════════════════
// Načte všechny doménové moduly a exportuje jednotné rozhraní

import { dataRegistry, DataSourceResult, DataSource } from './data-layer.js';

// Import doménových modulů (registrují se automaticky)
import './gpu-source.js';
import './cars-source.js';
// import './realestate-source.js';  // TODO: další domény

/**
 * Hlavní API pro přístup k data layeru z artifact pipeline
 */
export async function fetchDomainData(topic, locale = { market: 'CZ', currency: 'CZK' }) {
  // Detekuj doménu z tématu
  const domain = dataRegistry.detectDomain(topic);
  
  if (!domain) {
    console.log(`[DataLayer] No domain detected for: "${topic.substring(0, 50)}..."`);
    return null;
  }
  
  console.log(`[DataLayer] Detected domain: ${domain}`);
  
  // Získej data source
  const source = dataRegistry.get(domain);
  if (!source) {
    console.warn(`[DataLayer] No source registered for domain: ${domain}`);
    return null;
  }
  
  // Sestav query z tématu
  const query = parseQueryFromTopic(topic, domain);
  
  // Fetch data
  try {
    const result = await source.fetch(query);
    console.log(`[DataLayer] Fetched ${result.items.length} items from ${result.source}`);
    return result;
  } catch (err) {
    console.error(`[DataLayer] Fetch failed: ${err.message}`);
    return null;
  }
}

/**
 * Parsuj query parametry z přirozeného jazyka
 */
function parseQueryFromTopic(topic, domain) {
  const lower = topic.toLowerCase();
  const query = {};
  
  if (domain === 'gpu') {
    // Brand detection
    if (/nvidia|geforce|rtx|gtx/i.test(lower)) query.brand = 'nvidia';
    if (/amd|radeon|rx\s?\d/i.test(lower)) query.brand = 'amd';
    
    // Generation
    if (/50[x789]0|50\s?series|50xx/i.test(lower)) query.generation = '50';
    if (/40[x6789]0|40\s?series|40xx/i.test(lower)) query.generation = '40';
    if (/30[x6789]0|30\s?series|30xx/i.test(lower)) query.generation = '30';
    
    // VRAM filter
    const vramMatch = lower.match(/(\d+)\s*gb/);
    if (vramMatch) query.minVram = parseInt(vramMatch[1]);
  }
  
  if (domain === 'cars') {
    // Brand detection
    if (/škoda|skoda/i.test(lower)) query.brand = 'Škoda';
    if (/volkswagen|vw/i.test(lower)) query.brand = 'Volkswagen';
    if (/bmw/i.test(lower)) query.brand = 'BMW';
    if (/audi/i.test(lower)) query.brand = 'Audi';
    if (/mercedes|benz/i.test(lower)) query.brand = 'Mercedes';
    if (/toyota/i.test(lower)) query.brand = 'Toyota';
    
    // Category
    if (/suv/i.test(lower)) query.category = 'SUV';
    if (/sedan/i.test(lower)) query.category = 'Sedan';
    if (/kombi/i.test(lower)) query.category = 'Kombi';
    if (/hatchback/i.test(lower)) query.category = 'Hatchback';
    
    // Fuel type
    if (/elektr|ev\b|bev/i.test(lower)) query.fuelType = 'elektro';
    if (/benzin|petrol|tsi|mpi/i.test(lower)) query.fuelType = 'benzin';
    if (/diesel|nafta|tdi/i.test(lower)) query.fuelType = 'diesel';
    if (/hybrid|phev/i.test(lower)) query.fuelType = 'hybrid';
  }
  
  return query;
}

/**
 * Transformuj DataSourceResult do artifact data formátu
 */
export function dataResultToArtifact(result, title, description) {
  if (!result || !result.items || result.items.length === 0) {
    return null;
  }
  
  // Auto-detect columns from first item
  const columns = Object.keys(result.items[0]);
  
  return {
    title,
    description,
    data: result.items,
    columns,
    notes: result.warnings,
    metadata: {
      confidence: result.confidence,
      market: result.market,
      source: result.source,
      sourceUrl: result.sourceUrl,
      generated_at: result.updatedAt?.toISOString() || new Date().toISOString()
    }
  };
}

/**
 * Seznam dostupných domén
 */
export function getAvailableDomains() {
  return dataRegistry.listDomains();
}

// Re-export core classes
export { dataRegistry, DataSourceResult, DataSource };

export default {
  fetchDomainData,
  dataResultToArtifact,
  getAvailableDomains,
  dataRegistry
};
