// AST Intelligence v1 — tree-sitter based code analysis
// ══════════════════════════════════════════════════════════════════════════════
//
// Provides precise AST parsing for supported languages.
// Lazy loading: parsers only loaded when first needed.
// Falls back to regex-based analysis (code-analyzer.js) for unsupported languages.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { spawnSync } from 'node:child_process';

// ─── Lazy Parser Cache ───────────────────────────────────────────────────────

let Parser = null;
let _treeSitterUnsafe = null; // null=unknown, true=segfaults, false=safe
const _parsers = new Map();    // language → configured Parser instance
const _grammars = new Map();   // language → grammar module

const SUPPORTED_LANGUAGES = ['javascript', 'python', 'go', 'java'];

const GRAMMAR_MODULES = {
  javascript: 'tree-sitter-javascript',
  python: 'tree-sitter-python',
  go: 'tree-sitter-go',
  java: 'tree-sitter-java',
};

/**
 * v128: Subprocess probe — test if tree-sitter can load without crashing.
 * Spawns a child process that attempts require('tree-sitter').
 * If it segfaults (exit 139) or crashes, marks tree-sitter as unsafe.
 * Result is cached — only runs once per process lifetime.
 */
function probeTreeSitter() {
  if (_treeSitterUnsafe !== null) return !_treeSitterUnsafe;
  try {
    const result = spawnSync(process.execPath, [
      '-e', 'try { require("tree-sitter"); process.exit(0); } catch(e) { process.exit(1); }'
    ], { timeout: 5000, stdio: 'ignore' });
    if (result.status === 0) {
      _treeSitterUnsafe = false;
      logger.info('ASTAnalyzer', 'tree-sitter probe: OK (safe to load)');
      return true;
    }
    const sig = result.signal || `exit=${result.status}`;
    _treeSitterUnsafe = true;
    logger.warn('ASTAnalyzer', `tree-sitter probe: UNSAFE (${sig}) — AST features disabled`);
    return false;
  } catch (err) {
    _treeSitterUnsafe = true;
    logger.warn('ASTAnalyzer', `tree-sitter probe failed: ${err.message} — AST features disabled`);
    return false;
  }
}

async function loadParser() {
  if (Parser) return Parser;
  // v128: Probe first — avoid segfault in main process
  if (!probeTreeSitter()) return null;
  try {
    const mod = await import('tree-sitter');
    Parser = mod.default || mod;
    return Parser;
  } catch (err) {
    logger.warn('ASTAnalyzer', `tree-sitter not available: ${err.message}`);
    return null;
  }
}

async function getParser(language) {
  if (_parsers.has(language)) return _parsers.get(language);
  if (!GRAMMAR_MODULES[language]) return null;

  const ParserClass = await loadParser();
  if (!ParserClass) return null;

  try {
    const grammarMod = await import(GRAMMAR_MODULES[language]);
    const grammar = grammarMod.default || grammarMod;

    const parser = new ParserClass();
    parser.setLanguage(grammar);

    _parsers.set(language, parser);
    _grammars.set(language, grammar);
    logger.info('ASTAnalyzer', `Parser loaded for ${language}`);
    return parser;
  } catch (err) {
    logger.warn('ASTAnalyzer', `Failed to load grammar for ${language}: ${err.message}`);
    _parsers.set(language, null);
    return null;
  }
}

// ─── AST Parsing ─────────────────────────────────────────────────────────────

/**
 * Parse file content into an AST.
 *
 * @param {string} content - Source code
 * @param {string} language - Language identifier
 * @returns {Promise<{tree: Object|null, language: string, supported: boolean}>}
 */
export async function parseAST(content, language) {
  if (!content || !SUPPORTED_LANGUAGES.includes(language)) {
    return { tree: null, language, supported: false };
  }

  const parser = await getParser(language);
  if (!parser) return { tree: null, language, supported: false };

  try {
    const tree = parser.parse(content);
    return { tree, language, supported: true };
  } catch (err) {
    logger.warn('ASTAnalyzer', `Parse error for ${language}: ${err.message}`);
    return { tree: null, language, supported: false };
  }
}

// ─── Symbol Extraction ───────────────────────────────────────────────────────

// Node types that represent definitions (per language)
const DEFINITION_TYPES = {
  javascript: {
    function: ['function_declaration', 'generator_function_declaration'],
    class: ['class_declaration'],
    variable: ['variable_declarator'],
    method: ['method_definition'],
    arrow: ['arrow_function'],
  },
  python: {
    function: ['function_definition'],
    class: ['class_definition'],
    variable: ['assignment'],
  },
  go: {
    function: ['function_declaration', 'method_declaration'],
    struct: ['type_declaration'],
  },
  java: {
    function: ['method_declaration', 'constructor_declaration'],
    class: ['class_declaration'],
    interface: ['interface_declaration'],
    enum: ['enum_declaration'],
  },
};

/**
 * Extract symbols (definitions) from an AST.
 *
 * @param {Object} tree - tree-sitter parse tree
 * @param {string} language
 * @param {string} filePath - for context
 * @returns {Array<{name: string, type: string, line: number, endLine: number, params?: string[], exported: boolean}>}
 */
export function extractSymbols(tree, language, filePath = '') {
  if (!tree || !tree.rootNode) return [];

  const symbols = [];
  const defTypes = DEFINITION_TYPES[language] || {};

  walkTree(tree.rootNode, (node) => {
    const nodeType = node.type;

    // Check all definition categories
    for (const [symbolType, nodeTypes] of Object.entries(defTypes)) {
      if (nodeTypes.includes(nodeType)) {
        const symbol = extractSymbolFromNode(node, symbolType, language, filePath);
        if (symbol) symbols.push(symbol);
      }
    }
  });

  return symbols;
}

function extractSymbolFromNode(node, symbolType, language, filePath) {
  let name = null;
  let params = null;
  let exported = false;

  // Find name child
  const nameNode = node.childForFieldName('name');
  if (nameNode) {
    name = nameNode.text;
  }

  // Check for export
  if (node.parent) {
    exported = node.parent.type === 'export_statement' ||
               node.parent.type === 'export_default_declaration' ||
               (language === 'go' && name && /^[A-Z]/.test(name)) ||
               (language === 'java' && hasModifier(node, 'public'));
  }

  // Extract parameters for functions/methods
  const paramsNode = node.childForFieldName('parameters');
  if (paramsNode) {
    params = [];
    for (let i = 0; i < paramsNode.namedChildCount; i++) {
      const param = paramsNode.namedChild(i);
      const paramName = param.childForFieldName('name') || param.childForFieldName('pattern');
      if (paramName) params.push(paramName.text);
      else if (param.type === 'identifier') params.push(param.text);
    }
  }

  // For variable declarations, get name from the declarator
  if (!name && symbolType === 'variable') {
    const idNode = node.childForFieldName('name') || findChildByType(node, 'identifier');
    if (idNode) name = idNode.text;
  }

  if (!name) return null;

  return {
    name,
    type: symbolType,
    line: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    column: node.startPosition.column,
    params: params || undefined,
    exported,
    file: filePath,
  };
}

function hasModifier(node, modifier) {
  const modifiers = node.childForFieldName('modifiers');
  if (!modifiers) return false;
  return modifiers.text.includes(modifier);
}

function findChildByType(node, type) {
  for (let i = 0; i < node.childCount; i++) {
    if (node.child(i).type === type) return node.child(i);
  }
  return null;
}

// ─── Usage/Reference Finding ─────────────────────────────────────────────────

/**
 * Find all usages of a symbol in a parsed tree.
 *
 * @param {Object} tree - tree-sitter parse tree
 * @param {string} symbolName - Symbol to find
 * @returns {Array<{line: number, column: number, context: string, isDefinition: boolean}>}
 */
export function findUsagesInTree(tree, symbolName) {
  if (!tree || !tree.rootNode) return [];

  const usages = [];

  walkTree(tree.rootNode, (node) => {
    if (node.type === 'identifier' && node.text === symbolName) {
      const isDefinition = isDefinitionNode(node);
      usages.push({
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        context: getNodeContext(node),
        isDefinition,
      });
    }
  });

  return usages;
}

function isDefinitionNode(identifierNode) {
  const parent = identifierNode.parent;
  if (!parent) return false;

  const defParentTypes = new Set([
    'function_declaration', 'generator_function_declaration',
    'class_declaration', 'method_definition',
    'variable_declarator', 'assignment',
    'function_definition', 'class_definition',
    'type_declaration', 'method_declaration',
    'interface_declaration', 'enum_declaration',
  ]);

  // Name field of a definition parent = definition
  if (defParentTypes.has(parent.type)) {
    const nameField = parent.childForFieldName('name');
    return nameField === identifierNode;
  }

  return false;
}

function getNodeContext(node) {
  // Get the line containing this node
  let current = node;
  while (current.parent && current.parent.startPosition.row === node.startPosition.row) {
    current = current.parent;
  }
  return current.text.split('\n')[0].trim().substring(0, 120);
}

// ─── Call Chain Analysis ─────────────────────────────────────────────────────

/**
 * Extract function calls from an AST.
 *
 * @param {Object} tree - tree-sitter parse tree
 * @returns {Array<{caller: string|null, callee: string, line: number}>}
 */
export function extractCalls(tree) {
  if (!tree || !tree.rootNode) return [];

  const calls = [];

  walkTree(tree.rootNode, (node) => {
    if (node.type === 'call_expression') {
      const callee = extractCalleeName(node);
      if (callee) {
        const caller = findEnclosingFunction(node);
        calls.push({
          caller: caller || null,
          callee,
          line: node.startPosition.row + 1,
        });
      }
    }
  });

  return calls;
}

function extractCalleeName(callNode) {
  const fn = callNode.childForFieldName('function');
  if (!fn) return null;

  if (fn.type === 'identifier') return fn.text;
  if (fn.type === 'member_expression') {
    const prop = fn.childForFieldName('property');
    const obj = fn.childForFieldName('object');
    if (prop && obj) return `${obj.text}.${prop.text}`;
    if (prop) return prop.text;
  }

  return null;
}

function findEnclosingFunction(node) {
  let current = node.parent;
  while (current) {
    if (['function_declaration', 'method_definition', 'arrow_function',
         'function_definition', 'method_declaration'].includes(current.type)) {
      const nameNode = current.childForFieldName('name');
      if (nameNode) return nameNode.text;
    }
    current = current.parent;
  }
  return null;
}

// ─── Tree Walker ─────────────────────────────────────────────────────────────

function walkTree(node, callback) {
  callback(node);
  for (let i = 0; i < node.childCount; i++) {
    walkTree(node.child(i), callback);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Check if AST analysis is available for a language.
 */
export function isASTSupported(language) {
  return SUPPORTED_LANGUAGES.includes(language);
}

/**
 * Get list of supported languages.
 */
export function getSupportedLanguages() {
  return [...SUPPORTED_LANGUAGES];
}

/**
 * v128: Check if tree-sitter is safe to load (cached probe result).
 * Returns true if probe passed, false if segfault detected, null if not yet probed.
 */
export function isTreeSitterSafe() {
  if (_treeSitterUnsafe === null) return null;
  return !_treeSitterUnsafe;
}

/** v128: Reset probe state (for testing only). */
export function _resetProbeState() {
  _treeSitterUnsafe = null;
  Parser = null;
  _parsers.clear();
  _grammars.clear();
}

export default {
  parseAST,
  extractSymbols,
  findUsagesInTree,
  extractCalls,
  isASTSupported,
  getSupportedLanguages,
  isTreeSitterSafe,
};
