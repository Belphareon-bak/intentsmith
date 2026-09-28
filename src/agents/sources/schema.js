// C.3 v33.3 Source Schema
// ══════════════════════════════════════════════════════════════════════════════
// Vrstva 2: Schema definice - mapování raw dat na strukturovaná pole

/**
 * Source Schema - defines how to extract structured data from raw source
 */
export class SourceSchema {
  constructor(sourceId, dataType) {
    this.sourceId = sourceId;
    this.dataType = dataType; // 'json' | 'html' | 'xml'
    this.fields = new Map();
  }
  
  /**
   * Add field definition
   */
  addField(name, config) {
    this.fields.set(name, {
      name,
      type: config.type || 'string', // 'string' | 'number' | 'boolean' | 'date' | 'array'
      path: config.path || null,     // JSON path or CSS selector
      selector: config.selector || null, // CSS selector for HTML
      regex: config.regex || null,   // Regex pattern
      transform: config.transform || null, // 'cz_price' | 'number' | 'date' | 'trim'
      required: config.required || false,
      default: config.default !== undefined ? config.default : null
    });
    return this;
  }
  
  /**
   * Validate schema completeness
   */
  validate() {
    const errors = [];
    const warnings = [];
    
    if (this.fields.size === 0) {
      errors.push('Schema has no fields defined');
    }
    
    for (const [name, field] of this.fields) {
      if (this.dataType === 'html' && !field.selector && !field.regex) {
        warnings.push(`Field '${name}' has no selector or regex for HTML source`);
      }
      if (this.dataType === 'json' && !field.path) {
        warnings.push(`Field '${name}' has no path for JSON source`);
      }
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
  
  /**
   * Export schema as JSON
   */
  toJSON() {
    const fields = {};
    for (const [name, config] of this.fields) {
      fields[name] = { ...config };
    }
    return {
      sourceId: this.sourceId,
      dataType: this.dataType,
      fields
    };
  }
  
  /**
   * Create from JSON
   */
  static fromJSON(json) {
    const schema = new SourceSchema(json.sourceId, json.dataType);
    for (const [name, config] of Object.entries(json.fields || {})) {
      schema.addField(name, config);
    }
    return schema;
  }
}

/**
 * Schema Builder - helps create schema from inspection
 */
export class SchemaBuilder {
  /**
   * Create schema from inspection result
   */
  static fromInspection(sourceId, inspection) {
    const schema = new SourceSchema(sourceId, inspection.dataType);
    
    if (inspection.structure?.fields) {
      for (const field of inspection.structure.fields) {
        // Extract field name from path
        const name = field.path.split('.').pop().replace('[*]', '');
        if (name && !schema.fields.has(name)) {
          schema.addField(name, {
            type: field.type,
            path: field.path,
            selector: inspection.structure.suggestedSelectors?.[name]
          });
        }
      }
    }
    
    return schema;
  }
  
  /**
   * Create default schema for property listings
   */
  static propertyListingSchema(sourceId, dataType = 'html') {
    const schema = new SourceSchema(sourceId, dataType);
    
    schema.addField('items', {
      type: 'array',
      selector: '.property, .listing, .item, article, [class*="property"]',
      path: 'items'
    });
    
    schema.addField('id', {
      type: 'string',
      selector: '[data-id], [id]',
      path: 'items[*].id'
    });
    
    schema.addField('title', {
      type: 'string',
      selector: 'h1, h2, h3, .title, .name',
      path: 'items[*].title'
    });
    
    schema.addField('price', {
      type: 'number',
      selector: '.price, .cena, [class*="price"]',
      path: 'items[*].price',
      transform: 'cz_price'
    });
    
    schema.addField('area', {
      type: 'number',
      selector: '.area, .plocha, [class*="area"]',
      path: 'items[*].area',
      regex: '(\\d+)\\s*m[²2]'
    });
    
    schema.addField('land_area', {
      type: 'number',
      selector: '.land, .pozemek, [class*="land"], [class*="pozemek"]',
      path: 'items[*].land_area',
      regex: '(\\d+)\\s*m[²2]'
    });
    
    schema.addField('location', {
      type: 'string',
      selector: '.location, .address, .lokalita',
      path: 'items[*].location'
    });
    
    schema.addField('link', {
      type: 'string',
      selector: 'a[href]',
      path: 'items[*].link'
    });
    
    return schema;
  }
}

/**
 * Transform functions
 */
export const transforms = {
  // Czech price: "1 500 000 Kč" → 1500000
  cz_price(value) {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return null;
    const cleaned = value.replace(/[^\d]/g, '');
    return cleaned ? parseInt(cleaned) : null;
  },
  
  // Number: "150 m²" → 150
  number(value) {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return null;
    const match = value.match(/(\d+)/);
    return match ? parseInt(match[1]) : null;
  },
  
  // Trim whitespace
  trim(value) {
    return typeof value === 'string' ? value.trim() : value;
  },
  
  // Parse date
  date(value) {
    if (!value) return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
};

export default { SourceSchema, SchemaBuilder, transforms };
