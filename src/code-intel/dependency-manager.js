// Dependency Manager v114 (F11) — Autonomous Dependency Upgrades
// ══════════════════════════════════════════════════════════════════════════════
//
// Detects outdated packages and orchestrates safe upgrades:
//   - Multi-package-manager support (npm, yarn, pnpm, go, pip, cargo)
//   - .c3/dependency-cache.json (TTL 24h) for offline/fast access
//   - maxPackagesPerRun limit (default 5)
//   - Patch/minor only — NEVER auto-upgrades major versions
//   - Rollback on test failure
//
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { logger } from '../core/logger.js';

// ─── Package Managers ───────────────────────────────────────────────────────

export const PackageManager = Object.freeze({
  NPM:   'npm',
  YARN:  'yarn',
  PNPM:  'pnpm',
  GO:    'go',
  PIP:   'pip',
  CARGO: 'cargo',
});

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_PACKAGES_PER_RUN = 5;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_FILE = '.c3/dependency-cache.json';
const COMMAND_TIMEOUT = 30_000; // 30s for outdated commands

// ─── Package Manager Detection ──────────────────────────────────────────────

const PM_DETECTION = [
  { file: 'pnpm-lock.yaml',   manager: PackageManager.PNPM, lock: 'pnpm-lock.yaml', config: 'package.json' },
  { file: 'yarn.lock',        manager: PackageManager.YARN, lock: 'yarn.lock',       config: 'package.json' },
  { file: 'package-lock.json',manager: PackageManager.NPM,  lock: 'package-lock.json',config: 'package.json' },
  { file: 'package.json',     manager: PackageManager.NPM,  lock: null,              config: 'package.json' },
  { file: 'go.mod',           manager: PackageManager.GO,   lock: 'go.sum',          config: 'go.mod' },
  { file: 'Pipfile',          manager: PackageManager.PIP,  lock: 'Pipfile.lock',    config: 'Pipfile' },
  { file: 'requirements.txt', manager: PackageManager.PIP,  lock: null,              config: 'requirements.txt' },
  { file: 'Cargo.toml',       manager: PackageManager.CARGO,lock: 'Cargo.lock',      config: 'Cargo.toml' },
];

/**
 * Detect the package manager used by a project.
 *
 * @param {string} projectPath
 * @returns {{ manager: string, lockFile: string|null, configFile: string }|null}
 */
export function detectPackageManager(projectPath) {
  if (!projectPath) return null;

  for (const pm of PM_DETECTION) {
    const filePath = path.join(projectPath, pm.file);
    if (fs.existsSync(filePath)) {
      return {
        manager: pm.manager,
        lockFile: pm.lock,
        configFile: pm.config,
      };
    }
  }

  return null;
}

// ─── Outdated Listing ───────────────────────────────────────────────────────

const OUTDATED_COMMANDS = {
  [PackageManager.NPM]:  'npm outdated --json',
  [PackageManager.YARN]: 'yarn outdated --json',
  [PackageManager.PNPM]: 'pnpm outdated --format json',
  [PackageManager.GO]:   'go list -m -u -json all',
  [PackageManager.PIP]:  'pip list --outdated --format=json',
  [PackageManager.CARGO]:'cargo outdated --format json',
};

/**
 * List outdated packages.
 *
 * @param {string} projectPath
 * @param {string} manager - PackageManager value
 * @param {Object} [opts]
 * @param {boolean} [opts.useCache=true] - Check cache first
 * @returns {Promise<Array<{ name: string, current: string, latest: string, type: string }>>}
 */
export async function listOutdated(projectPath, manager, opts = {}) {
  const useCache = opts.useCache !== false;

  // Check cache first
  if (useCache) {
    const cached = loadCache(projectPath);
    if (cached && cached.timestamp && (Date.now() - cached.timestamp < CACHE_TTL)) {
      logger.info('DependencyManager', 'Using cached outdated list', {
        age: Math.round((Date.now() - cached.timestamp) / 60000) + 'min',
      });
      return cached.packages || [];
    }
  }

  const cmd = OUTDATED_COMMANDS[manager];
  if (!cmd) return [];

  try {
    const output = execSync(cmd, {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: COMMAND_TIMEOUT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const packages = _parseOutdatedOutput(output, manager);

    // Save to cache
    saveCache(projectPath, { packages, timestamp: Date.now() });

    return packages;
  } catch (err) {
    // npm outdated exits with code 1 when packages are outdated — check stdout
    if (err.stdout) {
      const packages = _parseOutdatedOutput(err.stdout, manager);
      if (packages.length > 0) {
        saveCache(projectPath, { packages, timestamp: Date.now() });
        return packages;
      }
    }
    logger.warn('DependencyManager', `Failed to list outdated: ${err.message}`);
    // Fallback to cache even if expired
    const cached = loadCache(projectPath);
    return cached?.packages || [];
  }
}

/**
 * Parse the output of outdated commands.
 */
function _parseOutdatedOutput(output, manager) {
  if (!output || !output.trim()) return [];

  try {
    switch (manager) {
      case PackageManager.NPM:
      case PackageManager.PNPM:
        return _parseNpmOutdated(output);
      case PackageManager.YARN:
        return _parseYarnOutdated(output);
      case PackageManager.PIP:
        return _parsePipOutdated(output);
      case PackageManager.GO:
        return _parseGoOutdated(output);
      default:
        return [];
    }
  } catch (err) {
    logger.warn('DependencyManager', `Parse error: ${err.message}`);
    return [];
  }
}

function _parseNpmOutdated(output) {
  const data = JSON.parse(output);
  return Object.entries(data).map(([name, info]) => ({
    name,
    current: info.current || '0.0.0',
    latest: info.latest || info.wanted || '0.0.0',
    type: _classifyVersionDiff(info.current, info.latest),
  }));
}

function _parseYarnOutdated(output) {
  // Yarn JSON output has {type:"table", data:{body:[[name,current,wanted,latest,...]]}}
  const lines = output.trim().split('\n');
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'table' && obj.data?.body) {
        return obj.data.body.map(row => ({
          name: row[0],
          current: row[1],
          latest: row[3] || row[2],
          type: _classifyVersionDiff(row[1], row[3] || row[2]),
        }));
      }
    } catch { continue; }
  }
  return [];
}

function _parsePipOutdated(output) {
  const data = JSON.parse(output);
  return data.map(pkg => ({
    name: pkg.name,
    current: pkg.version,
    latest: pkg.latest_version,
    type: _classifyVersionDiff(pkg.version, pkg.latest_version),
  }));
}

function _parseGoOutdated(output) {
  // Each module is a separate JSON object on its own line
  const results = [];
  for (const line of output.trim().split('\n')) {
    try {
      const mod = JSON.parse(line);
      if (mod.Update) {
        results.push({
          name: mod.Path,
          current: mod.Version,
          latest: mod.Update.Version,
          type: _classifyVersionDiff(mod.Version, mod.Update.Version),
        });
      }
    } catch { continue; }
  }
  return results;
}

/**
 * Classify version difference as major, minor, or patch.
 */
function _classifyVersionDiff(current, latest) {
  if (!current || !latest) return 'unknown';

  const currParts = current.replace(/^[^0-9]*/, '').split('.').map(Number);
  const lateParts = latest.replace(/^[^0-9]*/, '').split('.').map(Number);

  if (isNaN(currParts[0]) || isNaN(lateParts[0])) return 'unknown';

  if (lateParts[0] > currParts[0]) return 'major';
  if (lateParts[1] > (currParts[1] || 0)) return 'minor';
  return 'patch';
}

// ─── Package Upgrade ────────────────────────────────────────────────────────

const UPGRADE_COMMANDS = {
  [PackageManager.NPM]:  (name, ver) => `npm install ${name}@${ver}`,
  [PackageManager.YARN]: (name, ver) => `yarn add ${name}@${ver}`,
  [PackageManager.PNPM]: (name, ver) => `pnpm add ${name}@${ver}`,
  [PackageManager.GO]:   (name, ver) => `go get ${name}@${ver}`,
  [PackageManager.PIP]:  (name, ver) => `pip install ${name}==${ver}`,
  [PackageManager.CARGO]:(name, ver) => `cargo add ${name}@${ver}`,
};

/**
 * Upgrade a single package to a specific version.
 *
 * @param {string} projectPath
 * @param {string} manager
 * @param {string} packageName
 * @param {string} version
 * @returns {{ success: boolean, output: string }}
 */
export function upgradePackage(projectPath, manager, packageName, version) {
  const cmdFn = UPGRADE_COMMANDS[manager];
  if (!cmdFn) return { success: false, output: `Unsupported manager: ${manager}` };

  const cmd = cmdFn(packageName, version);
  try {
    const output = execSync(cmd, {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 60_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { success: true, output: output || '' };
  } catch (err) {
    return { success: false, output: err.stderr || err.message || '' };
  }
}

// ─── Upgrade Cycle ──────────────────────────────────────────────────────────

/**
 * Run a full upgrade cycle: detect → list → upgrade (patch/minor only) → test.
 *
 * @param {string} projectPath
 * @param {Object} options
 * @param {Function} [options.runTests] - () => { allPassed: boolean }
 * @param {number} [options.maxPackagesPerRun=5]
 * @param {boolean} [options.useCache=true]
 * @returns {Promise<{ upgraded: Array, failed: Array, skipped: Array, report: string }>}
 */
export async function runUpgradeCycle(projectPath, options = {}) {
  const maxPkgs = options.maxPackagesPerRun ?? MAX_PACKAGES_PER_RUN;
  const runTests = options.runTests || null;

  // Step 1: Detect package manager
  const pm = detectPackageManager(projectPath);
  if (!pm) {
    return { upgraded: [], failed: [], skipped: [], report: 'No package manager detected' };
  }

  // Step 2: List outdated
  const outdated = await listOutdated(projectPath, pm.manager, { useCache: options.useCache !== false });
  if (outdated.length === 0) {
    return { upgraded: [], failed: [], skipped: [], report: 'All packages up to date' };
  }

  // Step 3: Filter (patch first, then minor) and slice to max
  const eligible = outdated
    .filter(p => p.type !== 'major') // NEVER auto-upgrade major
    .sort((a, b) => {
      // Patch first, then minor
      if (a.type === 'patch' && b.type !== 'patch') return -1;
      if (a.type !== 'patch' && b.type === 'patch') return 1;
      return 0;
    })
    .slice(0, maxPkgs);

  const skipped = outdated.filter(p => p.type === 'major');
  if (skipped.length > 0) {
    logger.info('DependencyManager', `Skipped ${skipped.length} major version upgrade(s)`);
  }

  // Step 4: Upgrade each
  const upgraded = [];
  const failed = [];

  for (const pkg of eligible) {
    logger.info('DependencyManager', `Upgrading ${pkg.name}: ${pkg.current} → ${pkg.latest} (${pkg.type})`);

    const result = upgradePackage(projectPath, pm.manager, pkg.name, pkg.latest);
    if (!result.success) {
      failed.push({ ...pkg, error: result.output });
      continue;
    }

    // Step 5: Run tests if available
    if (runTests) {
      try {
        const testResult = await runTests();
        if (testResult && testResult.allPassed === false) {
          // Rollback: reinstall old version
          logger.warn('DependencyManager', `Tests failed after ${pkg.name} upgrade, rolling back`);
          upgradePackage(projectPath, pm.manager, pkg.name, pkg.current);
          failed.push({ ...pkg, error: 'Tests failed' });
          continue;
        }
      } catch (err) {
        logger.warn('DependencyManager', `Test run failed: ${err.message}`);
        upgradePackage(projectPath, pm.manager, pkg.name, pkg.current);
        failed.push({ ...pkg, error: err.message });
        continue;
      }
    }

    upgraded.push(pkg);
  }

  const report = formatUpgradeReport({ upgraded, failed, skipped });
  return { upgraded, failed, skipped, report };
}

// ─── Cache ──────────────────────────────────────────────────────────────────

/**
 * Load cached outdated list.
 * @param {string} projectPath
 * @returns {Object|null}
 */
export function loadCache(projectPath) {
  if (!projectPath) return null;
  const cachePath = path.join(projectPath, CACHE_FILE);
  try {
    if (!fs.existsSync(cachePath)) return null;
    const raw = fs.readFileSync(cachePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Save outdated list to cache.
 * @param {string} projectPath
 * @param {Object} data
 */
export function saveCache(projectPath, data) {
  if (!projectPath || !data) return;
  const cacheDir = path.join(projectPath, '.c3');
  const cachePath = path.join(projectPath, CACHE_FILE);
  try {
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(data, null, 2));
  } catch (err) {
    logger.warn('DependencyManager', `Cache save failed: ${err.message}`);
  }
}

// ─── Report Formatting ──────────────────────────────────────────────────────

/**
 * Format upgrade results as human-readable report.
 * @param {{ upgraded: Array, failed: Array, skipped: Array }} result
 * @returns {string}
 */
export function formatUpgradeReport(result) {
  if (!result) return '';

  const parts = [];

  if (result.upgraded?.length > 0) {
    parts.push(`Upgraded (${result.upgraded.length}):`);
    for (const p of result.upgraded) {
      parts.push(`  ✓ ${p.name}: ${p.current} → ${p.latest} (${p.type})`);
    }
  }

  if (result.failed?.length > 0) {
    parts.push(`Failed (${result.failed.length}):`);
    for (const p of result.failed) {
      parts.push(`  ✗ ${p.name}: ${p.error || 'unknown error'}`);
    }
  }

  if (result.skipped?.length > 0) {
    parts.push(`Skipped major (${result.skipped.length}):`);
    for (const p of result.skipped) {
      parts.push(`  ⊘ ${p.name}: ${p.current} → ${p.latest} (major — manual upgrade required)`);
    }
  }

  if (parts.length === 0) return 'No packages to upgrade';
  return parts.join('\n');
}

// ─── Exports ────────────────────────────────────────────────────────────────

export default {
  PackageManager,
  detectPackageManager,
  listOutdated,
  upgradePackage,
  runUpgradeCycle,
  loadCache,
  saveCache,
  formatUpgradeReport,
};
