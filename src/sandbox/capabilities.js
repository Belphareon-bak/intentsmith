// Tool Capabilities — Permission Manifest
// ══════════════════════════════════════════════════════════════════════════════
//
// Defines what each tool can do and what permissions it requires.
// Used by sandbox to enforce access control.
//
// Capability levels:
//   READ     - read-only operations
//   WRITE    - create/modify operations
//   DELETE   - destructive operations
//   EXEC     - execute external commands
//   NETWORK  - network access
//
// ══════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// CAPABILITY TYPES
// ════════════════════════════════════════════════════════════════════════════

export const Capability = {
  // Filesystem
  FS_READ: 'fs:read',
  FS_WRITE: 'fs:write',
  FS_DELETE: 'fs:delete',
  FS_LIST: 'fs:list',

  // Network
  NET_HTTP_GET: 'net:http:get',
  NET_HTTP_POST: 'net:http:post',
  NET_WEBSOCKET: 'net:websocket',

  // Execution
  EXEC_SHELL: 'exec:shell',
  EXEC_SCRIPT: 'exec:script',

  // Memory
  MEM_READ: 'mem:read',
  MEM_WRITE: 'mem:write',

  // Database
  DB_READ: 'db:read',
  DB_WRITE: 'db:write',
};

// ════════════════════════════════════════════════════════════════════════════
// RISK LEVELS
// ════════════════════════════════════════════════════════════════════════════

export const RiskLevel = {
  SAFE: 'safe',           // No approval needed
  LOW: 'low',             // Auto-approve in most cases
  MEDIUM: 'medium',       // May need approval
  HIGH: 'high',           // Always needs approval
  CRITICAL: 'critical',   // Always needs explicit user confirmation
};

// ════════════════════════════════════════════════════════════════════════════
// TOOL CAPABILITY MANIFEST
// ════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} ToolCapability
 * @property {string[]} requires - Required capabilities
 * @property {string} riskLevel - Risk level
 * @property {boolean} sideEffects - Whether tool has side effects
 * @property {boolean} requiresApproval - Whether explicit approval needed
 * @property {string} [dryRunSupport] - 'full' | 'partial' | 'none'
 * @property {string[]} [scopes] - Allowed scopes/paths
 */

export const toolCapabilities = {
  // ──────────────────────────────────────────────────────────────────────────
  // WEB TOOLS
  // ──────────────────────────────────────────────────────────────────────────

  'web.search': {
    requires: [Capability.NET_HTTP_GET],
    riskLevel: RiskLevel.SAFE,
    sideEffects: false,
    requiresApproval: false,
    dryRunSupport: 'full',
    description: 'Search the web via search API',
  },

  'web.fetch': {
    requires: [Capability.NET_HTTP_GET],
    riskLevel: RiskLevel.LOW,
    sideEffects: false,
    requiresApproval: false,
    dryRunSupport: 'full',
    description: 'Fetch content from URL',
  },

  'web.scrape': {
    requires: [Capability.NET_HTTP_GET],
    riskLevel: RiskLevel.LOW,
    sideEffects: false,
    requiresApproval: false,
    dryRunSupport: 'full',
    description: 'Scrape web page content',
  },

  // ──────────────────────────────────────────────────────────────────────────
  // FILESYSTEM TOOLS
  // ──────────────────────────────────────────────────────────────────────────

  'fs.read': {
    requires: [Capability.FS_READ],
    riskLevel: RiskLevel.LOW,
    sideEffects: false,
    requiresApproval: false,
    dryRunSupport: 'full',
    description: 'Read file content',
    scopes: ['./data', './projects', '/tmp'],
  },

  'fs.write': {
    requires: [Capability.FS_WRITE],
    riskLevel: RiskLevel.MEDIUM,
    sideEffects: true,
    requiresApproval: true, // Default: needs approval
    dryRunSupport: 'full',
    description: 'Write content to file',
    scopes: ['./data', './projects', '/tmp'],
  },

  'fs.list': {
    requires: [Capability.FS_LIST],
    riskLevel: RiskLevel.SAFE,
    sideEffects: false,
    requiresApproval: false,
    dryRunSupport: 'full',
    description: 'List directory contents',
    scopes: ['./data', './projects', '/tmp'],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // DATA TOOLS
  // ──────────────────────────────────────────────────────────────────────────

  'data.parse': {
    requires: [],
    riskLevel: RiskLevel.SAFE,
    sideEffects: false,
    requiresApproval: false,
    dryRunSupport: 'full',
    description: 'Parse data from format',
  },

  'data.filter': {
    requires: [],
    riskLevel: RiskLevel.SAFE,
    sideEffects: false,
    requiresApproval: false,
    dryRunSupport: 'full',
    description: 'Filter array data',
  },

  // ──────────────────────────────────────────────────────────────────────────
  // MEMORY TOOLS
  // ──────────────────────────────────────────────────────────────────────────

  'memory.store': {
    requires: [Capability.MEM_WRITE],
    riskLevel: RiskLevel.SAFE,
    sideEffects: true,
    requiresApproval: false,
    dryRunSupport: 'full',
    description: 'Store value in memory',
  },

  'memory.recall': {
    requires: [Capability.MEM_READ],
    riskLevel: RiskLevel.SAFE,
    sideEffects: false,
    requiresApproval: false,
    dryRunSupport: 'full',
    description: 'Recall value from memory',
  },
};

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Get capabilities for a tool
 *
 * @param {string} toolName
 * @returns {ToolCapability | null}
 */
export function getToolCapabilities(toolName) {
  return toolCapabilities[toolName] || null;
}

/**
 * Check if tool requires approval
 *
 * @param {string} toolName
 * @returns {boolean}
 */
export function requiresApproval(toolName) {
  const caps = toolCapabilities[toolName];
  return caps?.requiresApproval ?? true; // Default: requires approval
}

/**
 * Check if tool has side effects
 *
 * @param {string} toolName
 * @returns {boolean}
 */
export function hasSideEffects(toolName) {
  const caps = toolCapabilities[toolName];
  return caps?.sideEffects ?? true; // Default: assume side effects
}

/**
 * Get risk level for tool
 *
 * @param {string} toolName
 * @returns {string}
 */
export function getRiskLevel(toolName) {
  const caps = toolCapabilities[toolName];
  return caps?.riskLevel ?? RiskLevel.HIGH; // Default: high risk
}

/**
 * Check if tool supports dry-run
 *
 * @param {string} toolName
 * @returns {boolean}
 */
export function supportsDryRun(toolName) {
  const caps = toolCapabilities[toolName];
  return caps?.dryRunSupport === 'full' || caps?.dryRunSupport === 'partial';
}

/**
 * Check if path is within allowed scopes for tool
 *
 * @param {string} toolName
 * @param {string} path
 * @returns {boolean}
 */
export function isPathAllowed(toolName, path) {
  const caps = toolCapabilities[toolName];
  if (!caps?.scopes) return true; // No scopes = all paths allowed

  return caps.scopes.some(scope => {
    if (scope.startsWith('./')) {
      // Relative scope - path must start with scope
      return path.startsWith(scope) || path.startsWith(scope.substring(2));
    }
    return path.startsWith(scope);
  });
}

/**
 * List all registered tools with their risk levels
 *
 * @returns {{ name: string, riskLevel: string, requiresApproval: boolean }[]}
 */
export function listTools() {
  return Object.entries(toolCapabilities).map(([name, caps]) => ({
    name,
    riskLevel: caps.riskLevel,
    requiresApproval: caps.requiresApproval,
    sideEffects: caps.sideEffects,
    capabilities: caps.requires,
  }));
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default {
  Capability,
  RiskLevel,
  toolCapabilities,
  getToolCapabilities,
  requiresApproval,
  hasSideEffects,
  getRiskLevel,
  supportsDryRun,
  isPathAllowed,
  listTools,
};
