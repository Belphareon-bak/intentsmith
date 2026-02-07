// Domain Capabilities — Phase 5
// ══════════════════════════════════════════════════════════════════════════════
//
// ARCHITECTURE ROLE: Domain Knowledge Layer
//
// Provides pre-built recipes and scaffolds that D1 can reference when creating
// plans. Instead of D1 reinventing common patterns, it can select from known
// good implementations.
//
// Components:
//   - DomainRegistry: central registry of all capabilities
//   - Recipes: step-by-step infra/ops patterns (docker, k8s, monitoring, CI/CD)
//   - Scaffolds: app templates (express-api, react-app, fullstack)
//
// Integration:
//   D1's system prompt includes available domains → D1 selects applicable ones
//   → plan steps reference domain recipes → CODE gets concrete implementation
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { infraRecipes } from './recipes/infra.js';
import { cicdRecipes } from './recipes/cicd.js';
import { monitoringRecipes } from './recipes/monitoring.js';
import { expressApiScaffold } from './scaffolds/express-api.js';
import { reactAppScaffold } from './scaffolds/react-app.js';
import { fullstackScaffold } from './scaffolds/fullstack.js';

// ─── Domain Registry ────────────────────────────────────────────────────────

export class DomainRegistry {
  constructor() {
    this.recipes = new Map();
    this.scaffolds = new Map();
    this._registerDefaults();
  }

  _registerDefaults() {
    // Infra recipes
    for (const recipe of infraRecipes) {
      this.recipes.set(recipe.id, recipe);
    }
    // CI/CD recipes
    for (const recipe of cicdRecipes) {
      this.recipes.set(recipe.id, recipe);
    }
    // Monitoring recipes
    for (const recipe of monitoringRecipes) {
      this.recipes.set(recipe.id, recipe);
    }

    // Scaffolds
    this.scaffolds.set('express-api', expressApiScaffold);
    this.scaffolds.set('react-app', reactAppScaffold);
    this.scaffolds.set('fullstack', fullstackScaffold);

    logger.info('Domains', `Registered ${this.recipes.size} recipes, ${this.scaffolds.size} scaffolds`);
  }

  // ═══ PUBLIC API ═══════════════════════════════════════════════════════════

  /**
   * Get a recipe by ID.
   * @param {string} id
   * @returns {Recipe|null}
   */
  getRecipe(id) {
    return this.recipes.get(id) || null;
  }

  /**
   * Get a scaffold by ID.
   * @param {string} id
   * @returns {Scaffold|null}
   */
  getScaffold(id) {
    return this.scaffolds.get(id) || null;
  }

  /**
   * Search recipes by tags.
   * @param {string[]} tags
   * @returns {Recipe[]}
   */
  searchRecipes(tags) {
    const results = [];
    for (const recipe of this.recipes.values()) {
      const matchCount = tags.filter(t => recipe.tags.includes(t)).length;
      if (matchCount > 0) {
        results.push({ recipe, relevance: matchCount / tags.length });
      }
    }
    return results
      .sort((a, b) => b.relevance - a.relevance)
      .map(r => r.recipe);
  }

  /**
   * Search scaffolds by tags.
   * @param {string[]} tags
   * @returns {Scaffold[]}
   */
  searchScaffolds(tags) {
    const results = [];
    for (const scaffold of this.scaffolds.values()) {
      const matchCount = tags.filter(t => scaffold.tags.includes(t)).length;
      if (matchCount > 0) {
        results.push({ scaffold, relevance: matchCount / tags.length });
      }
    }
    return results
      .sort((a, b) => b.relevance - a.relevance)
      .map(r => r.scaffold);
  }

  /**
   * Match request to relevant domains.
   * Used by D1 to find applicable recipes/scaffolds.
   *
   * @param {string} request - User's build request
   * @returns {{ recipes: Recipe[], scaffolds: Scaffold[] }}
   */
  matchRequest(request) {
    const text = request.toLowerCase();
    const tags = extractTags(text);

    return {
      recipes: this.searchRecipes(tags),
      scaffolds: this.searchScaffolds(tags),
    };
  }

  /**
   * Generate D1 context string with available domains.
   * Injected into D1's system prompt.
   *
   * @param {string} request - User's build request
   * @returns {string}
   */
  getD1Context(request) {
    const { recipes, scaffolds } = this.matchRequest(request);

    const lines = ['Available domain capabilities:'];

    if (scaffolds.length > 0) {
      lines.push('\nScaffolds (full project templates):');
      for (const s of scaffolds.slice(0, 3)) {
        lines.push(`  [${s.id}] ${s.name} — ${s.description}`);
        lines.push(`    Stack: ${s.stack.join(', ')}`);
        lines.push(`    Files: ${s.files.map(f => f.path).join(', ')}`);
      }
    }

    if (recipes.length > 0) {
      lines.push('\nRecipes (infra/ops patterns):');
      for (const r of recipes.slice(0, 5)) {
        lines.push(`  [${r.id}] ${r.name} — ${r.description}`);
        lines.push(`    Steps: ${r.steps.length}`);
      }
    }

    if (recipes.length === 0 && scaffolds.length === 0) {
      lines.push('  No matching recipes/scaffolds found. Create plan from scratch.');
    }

    return lines.join('\n');
  }

  /**
   * List all available capabilities (for reference).
   */
  listAll() {
    return {
      recipes: Array.from(this.recipes.values()).map(r => ({
        id: r.id, name: r.name, tags: r.tags,
      })),
      scaffolds: Array.from(this.scaffolds.values()).map(s => ({
        id: s.id, name: s.name, tags: s.tags,
      })),
    };
  }

  /**
   * Register a custom recipe.
   */
  addRecipe(recipe) {
    if (!recipe.id || !recipe.name || !recipe.steps) {
      throw new Error('Recipe must have id, name, and steps');
    }
    this.recipes.set(recipe.id, recipe);
  }

  /**
   * Register a custom scaffold.
   */
  addScaffold(scaffold) {
    if (!scaffold.id || !scaffold.name || !scaffold.files) {
      throw new Error('Scaffold must have id, name, and files');
    }
    this.scaffolds.set(scaffold.id, scaffold);
  }
}

// ─── Tag Extraction ─────────────────────────────────────────────────────────

const TAG_KEYWORDS = {
  // Stack
  express: ['express', 'expressjs'],
  react: ['react', 'reactjs', 'frontend'],
  node: ['node', 'nodejs', 'node.js'],
  typescript: ['typescript', 'ts'],
  python: ['python', 'flask', 'django', 'fastapi'],

  // Infra
  docker: ['docker', 'container', 'kontejner'],
  kubernetes: ['kubernetes', 'k8s', 'cluster'],
  nginx: ['nginx', 'reverse proxy'],
  
  // DB
  postgres: ['postgres', 'postgresql', 'pg'],
  mongodb: ['mongodb', 'mongo'],
  redis: ['redis', 'cache'],
  sqlite: ['sqlite'],

  // Ops
  cicd: ['ci/cd', 'cicd', 'pipeline', 'github actions', 'gitlab ci'],
  monitoring: ['monitoring', 'prometheus', 'grafana', 'metriky'],
  logging: ['logging', 'log', 'logy', 'elk'],

  // Features
  auth: ['auth', 'jwt', 'autentizace', 'authentication', 'autorizace'],
  api: ['api', 'rest', 'restful', 'graphql'],
  crud: ['crud', 'create', 'read', 'update', 'delete'],
  websocket: ['websocket', 'ws', 'real-time', 'realtime'],
  testing: ['test', 'testing', 'jest', 'mocha', 'vitest'],

  // Project type
  fullstack: ['fullstack', 'full-stack', 'full stack'],
  microservice: ['microservice', 'microservices', 'mikro'],
  monolith: ['monolith', 'monolit'],
};

function extractTags(text) {
  const tags = new Set();
  const lower = text.toLowerCase();
  for (const [tag, keywords] of Object.entries(TAG_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        tags.add(tag);
        break;
      }
    }
  }
  return Array.from(tags);
}

// ─── Singleton ──────────────────────────────────────────────────────────────

export const domainRegistry = new DomainRegistry();

export { extractTags };
export default DomainRegistry;
