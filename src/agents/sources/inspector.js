// C.3 v33.3 Source Inspector
// ══════════════════════════════════════════════════════════════════════════════
// Vrstva 1: Introspekce zdroje - zjistí co URL vrací

import crypto from 'crypto';

// Safety limits
const LIMITS = {
  maxSize: 1024 * 1024,      // 1MB max
  timeout: 8000,              // 8s timeout
  sampleSize: 50000,          // 50KB sample
  maxItems: 50                // Max items to analyze
};

/**
 * Inspect a URL and return metadata + sample
 * @param {string} url
 * @returns {Promise<InspectionResult>}
 */
export async function inspectSource(url) {
  const result = {
    url,
    timestamp: new Date().toISOString(),
    status: 'unknown',
    contentType: null,
    size: null,
    dataType: null, // 'json' | 'html' | 'xml' | 'text' | 'binary'
    sample: null,
    structure: null,
    schema: null,
    error: null
  };
  
  try {
    // Validate URL
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Only HTTP/HTTPS URLs are allowed');
    }
    
    // Fetch with timeout and size limit
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LIMITS.timeout);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml,application/json,*/*',
        'Accept-Language': 'cs,en;q=0.9'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    
    result.status = response.status;
    result.contentType = response.headers.get('content-type') || 'unknown';
    
    // Get body as text (limited size)
    const text = await response.text();
    
    // Size limit check
    if (text.length > LIMITS.maxSize) {
      result.size = text.length;
      result.sample = text.substring(0, LIMITS.sampleSize);
      result.warning = `Response truncated (${(text.length / 1024 / 1024).toFixed(1)}MB > 1MB limit)`;
    } else {
      result.size = text.length;
      result.sample = text.substring(0, LIMITS.sampleSize);
    }
    
    // Detect data type
    result.dataType = detectDataType(result.contentType, result.sample);
    
    // Analyze structure based on type
    result.structure = analyzeStructure(result.dataType, text, url);
    
    // Generate schema with versioning
    result.schema = generateSchema(result);
    
    return result;
    
  } catch (err) {
    if (err.name === 'AbortError') {
      result.error = `Timeout after ${LIMITS.timeout/1000}s`;
    } else {
      result.error = err.message;
    }
    result.status = 'error';
    return result;
  }
}

/**
 * Generate versioned schema with hash and confidence
 */
function generateSchema(inspection) {
  const fields = inspection.structure?.fields || [];
  const items = inspection.structure?.detectedItems || [];
  
  // Calculate content hash for change detection
  const hashContent = JSON.stringify({
    dataType: inspection.dataType,
    fieldPaths: fields.map(f => f.path),
    itemCount: items.length
  });
  const hash = crypto.createHash('sha256').update(hashContent).digest('hex').substring(0, 16);
  
  // Calculate overall confidence
  let confidence = 0;
  if (inspection.dataType === 'json') {
    confidence = 0.95; // JSON is reliable
  } else if (inspection.dataType === 'html') {
    // HTML confidence based on detected items
    if (items.length > 5) confidence = 0.7;
    else if (items.length > 0) confidence = 0.5;
    else confidence = 0.3;
    
    // Boost if we found prices
    if (items.some(i => i.price)) confidence += 0.15;
  }
  confidence = Math.min(confidence, 1.0);
  
  return {
    version: 1,
    hash: `sha256:${hash}`,
    derivedAt: new Date().toISOString(),
    confidence: Math.round(confidence * 100) / 100,
    dataType: inspection.dataType,
    fieldCount: fields.length,
    itemCount: items.length,
    fields: fields.map(f => ({
      path: f.path,
      type: f.type,
      confidence: calculateFieldConfidence(f, items),
      fallback: generateFallback(f)
    }))
  };
}

/**
 * Calculate confidence for individual field
 */
function calculateFieldConfidence(field, items) {
  if (field.type === 'array') return 0.9;
  
  // Check how many items have this field
  const fieldName = field.path.split('.').pop();
  const withValue = items.filter(i => i[fieldName] !== undefined && i[fieldName] !== null).length;
  
  if (items.length === 0) return 0.5;
  return Math.round((withValue / items.length) * 100) / 100;
}

/**
 * Generate fallback extraction strategy
 */
function generateFallback(field) {
  const name = field.path.split('.').pop();
  
  if (name === 'price' || name.includes('cena')) {
    return {
      regex: '(\\d[\\d\\s]{2,})\\s*(Kč|CZK|,-)',
      transform: 'cz_price'
    };
  }
  if (name === 'area' || name.includes('plocha')) {
    return {
      regex: '(\\d+)\\s*m[²2]',
      transform: 'number'
    };
  }
  return null;
}

/**
 * Detect data type from content-type and sample
 */
function detectDataType(contentType, sample) {
  const ct = contentType.toLowerCase();
  
  if (ct.includes('application/json')) return 'json';
  if (ct.includes('text/xml') || ct.includes('application/xml')) return 'xml';
  if (ct.includes('application/rss')) return 'rss';
  if (ct.includes('text/html')) return 'html';
  
  // Try to detect from content
  const trimmed = sample.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {}
  }
  if (trimmed.startsWith('<?xml') || trimmed.startsWith('<rss')) return 'xml';
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) return 'html';
  
  return 'text';
}

/**
 * Analyze structure and suggest schema
 */
function analyzeStructure(dataType, sample, url) {
  switch (dataType) {
    case 'json':
      return analyzeJson(sample);
    case 'html':
      return analyzeHtml(sample, url);
    case 'xml':
    case 'rss':
      return analyzeXml(sample);
    default:
      return { type: 'text', fields: [] };
  }
}

/**
 * Analyze JSON structure
 */
function analyzeJson(sample) {
  try {
    const data = JSON.parse(sample);
    const fields = extractJsonFields(data, '', 0);
    
    return {
      type: 'json',
      isArray: Array.isArray(data),
      itemCount: Array.isArray(data) ? data.length : null,
      fields,
      sample: Array.isArray(data) ? data.slice(0, 3) : data
    };
  } catch (err) {
    return { type: 'json', error: err.message, fields: [] };
  }
}

/**
 * Extract fields from JSON recursively
 */
function extractJsonFields(obj, prefix, depth) {
  if (depth > 5) return [];
  const fields = [];
  
  if (Array.isArray(obj)) {
    if (obj.length > 0) {
      fields.push(...extractJsonFields(obj[0], prefix + '[*]', depth + 1));
    }
  } else if (obj && typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const type = Array.isArray(value) ? 'array' : typeof value;
      
      fields.push({
        path,
        type,
        sample: type === 'object' || type === 'array' 
          ? `(${type})` 
          : String(value).substring(0, 100)
      });
      
      if (type === 'object' || type === 'array') {
        fields.push(...extractJsonFields(value, path, depth + 1));
      }
    }
  }
  
  return fields;
}

/**
 * Analyze HTML and suggest selectors
 */
function analyzeHtml(sample, url) {
  const structure = {
    type: 'html',
    fields: [],
    suggestedSelectors: {},
    detectedItems: []
  };
  
  // Try to detect common patterns for property listings
  const patterns = detectListingPatterns(sample);
  structure.suggestedSelectors = patterns.selectors;
  structure.detectedItems = patterns.items;
  
  // Suggest common fields based on detected patterns
  if (patterns.items.length > 0) {
    structure.fields = [
      { path: 'items', type: 'array', sample: `(${patterns.items.length} položek)` },
      { path: 'items[*].id', type: 'string', sample: patterns.items[0]?.id || '' },
      { path: 'items[*].title', type: 'string', sample: patterns.items[0]?.title?.substring(0, 50) || '' },
      { path: 'items[*].price', type: 'number', sample: patterns.items[0]?.price || '' },
      { path: 'items[*].area', type: 'number', sample: patterns.items[0]?.area || '' },
      { path: 'items[*].land_area', type: 'number', sample: patterns.items[0]?.land_area || '' },
      { path: 'items[*].location', type: 'string', sample: patterns.items[0]?.location?.substring(0, 50) || '' },
      { path: 'items[*].link', type: 'string', sample: patterns.items[0]?.link?.substring(0, 50) || '' }
    ].filter(f => f.sample);
  }
  
  return structure;
}

/**
 * Detect listing patterns in HTML
 */
function detectListingPatterns(html) {
  const result = {
    selectors: {},
    items: []
  };
  
  // Common item selectors
  const itemPatterns = [
    /class="[^"]*property[^"]*"/gi,
    /class="[^"]*listing[^"]*"/gi,
    /class="[^"]*estate[^"]*"/gi,
    /class="[^"]*offer[^"]*"/gi,
    /class="[^"]*result[^"]*"/gi,
    /class="[^"]*item[^"]*"/gi
  ];
  
  // Detect which pattern has most matches
  for (const pattern of itemPatterns) {
    const matches = html.match(pattern) || [];
    if (matches.length > 3) {
      const className = matches[0].match(/class="([^"]+)"/)?.[1]?.split(' ')[0];
      if (className) {
        result.selectors.item = `.${className}`;
        break;
      }
    }
  }
  
  // Try to extract prices (Czech format)
  const priceMatches = html.match(/(\d[\d\s]{2,})\s*(Kč|CZK|,-)/gi) || [];
  const prices = priceMatches
    .map(m => parseInt(m.replace(/[^\d]/g, '')))
    .filter(p => p > 100000 && p < 500000000);
  
  // Try to extract areas
  const areaMatches = html.match(/(\d+)\s*m[²2]/gi) || [];
  const areas = areaMatches.map(m => parseInt(m));
  
  // Build sample items
  const itemCount = Math.min(prices.length, 10);
  for (let i = 0; i < itemCount; i++) {
    result.items.push({
      id: `item-${i}`,
      price: prices[i] || null,
      area: areas[i * 2] || null,
      land_area: areas[i * 2 + 1] || null
    });
  }
  
  // Suggest selectors
  result.selectors.price = '.price, .cena, [class*="price"], [class*="cena"]';
  result.selectors.area = '.area, .plocha, [class*="area"], [class*="plocha"]';
  
  return result;
}

/**
 * Analyze XML/RSS
 */
function analyzeXml(sample) {
  const structure = {
    type: 'xml',
    fields: []
  };
  
  // Extract item tags
  const itemMatch = sample.match(/<item>[\s\S]*?<\/item>/i);
  if (itemMatch) {
    structure.fields.push({ path: 'items', type: 'array', sample: '(RSS items)' });
    
    // Extract fields from first item
    const tagRegex = /<(\w+)[^>]*>([^<]*)<\/\1>/g;
    let match;
    while ((match = tagRegex.exec(itemMatch[0])) !== null) {
      structure.fields.push({
        path: `items[*].${match[1]}`,
        type: 'string',
        sample: match[2].substring(0, 50)
      });
    }
  }
  
  return structure;
}

export default { inspectSource };
