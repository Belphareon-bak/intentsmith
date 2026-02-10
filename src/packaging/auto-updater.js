// Auto-Updater — Self-Update from GitHub Releases (Phase F3)
// ══════════════════════════════════════════════════════════════════════════════
//
// Checks for new versions, downloads, and applies updates.
// Works with both manual Node.js installs and Docker deployments.
//
// Update flow:
//   1. Check GitHub API for latest release tag
//   2. Compare with current version (from package.json)
//   3. Download release archive
//   4. Extract to staging directory
//   5. Replace current files (backup first)
//   6. Restart (signal parent process or Docker)
//
// Docker: just pull new image (docker compose pull && docker compose up -d)
// Node.js: in-place update with backup
//
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import crypto from 'crypto';
import { logger } from '../core/logger.js';

// ─── Configuration ──────────────────────────────────────────────────────────

const UPDATE_CONFIG = {
  // GitHub repository (user/repo)
  repository: process.env.C3_UPDATE_REPO || '',
  
  // Check interval (ms) — default 24 hours
  checkInterval: parseInt(process.env.C3_UPDATE_INTERVAL || '86400000'),
  
  // Auto-apply updates (false = notify only)
  autoApply: process.env.C3_AUTO_UPDATE === 'true',
  
  // Staging directory for downloads
  stagingDir: process.env.C3_UPDATE_STAGING || './data/updates',
  
  // Backup directory
  backupDir: process.env.C3_UPDATE_BACKUP || './data/backups',
  
  // Current version (from package.json)
  currentVersion: null,
};

// ─── Version Comparison ─────────────────────────────────────────────────────

/**
 * Parse semver string to comparable array.
 * "1.2.3" → [1, 2, 3]
 * "v1.2.3-beta" → [1, 2, 3]
 */
export function parseVersion(version) {
  if (!version) return [0, 0, 0];
  const clean = version.replace(/^v/, '').split('-')[0];
  const parts = clean.split('.').map(Number);
  while (parts.length < 3) parts.push(0);
  return parts.slice(0, 3);
}

/**
 * Compare two version strings.
 * Returns: 1 if a > b, -1 if a < b, 0 if equal.
 */
export function compareVersions(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (va[i] > vb[i]) return 1;
    if (va[i] < vb[i]) return -1;
  }
  return 0;
}

// ─── Update Checker ─────────────────────────────────────────────────────────

/**
 * Check for updates from GitHub releases API.
 * @returns {Object} { hasUpdate, currentVersion, latestVersion, releaseUrl, releaseNotes }
 */
export async function checkForUpdates(options = {}) {
  const repo = options.repository || UPDATE_CONFIG.repository;
  const currentVersion = options.currentVersion || getCurrentVersion();
  
  if (!repo) {
    return { hasUpdate: false, error: 'No repository configured' };
  }

  try {
    const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;
    const resp = await fetch(apiUrl, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'C3-Agent-Updater',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (resp.status === 404) {
      return { hasUpdate: false, error: 'Repository not found or no releases' };
    }
    if (!resp.ok) {
      return { hasUpdate: false, error: `GitHub API error: ${resp.status}` };
    }

    const release = await resp.json();
    const latestVersion = release.tag_name?.replace(/^v/, '') || '0.0.0';
    const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

    // Find download asset (tarball or zip)
    const asset = release.assets?.find(a =>
      a.name.endsWith('.tar.gz') || a.name.endsWith('.zip')
    );

    return {
      hasUpdate,
      currentVersion,
      latestVersion,
      releaseUrl: release.html_url,
      downloadUrl: asset?.browser_download_url || release.tarball_url,
      assetName: asset?.name || `${repo.split('/')[1]}-${latestVersion}.tar.gz`,
      releaseNotes: release.body?.slice(0, 500) || '',
      publishedAt: release.published_at,
    };
  } catch (err) {
    return { hasUpdate: false, error: `Check failed: ${err.message}` };
  }
}

/**
 * Get current version from package.json.
 */
export function getCurrentVersion() {
  if (UPDATE_CONFIG.currentVersion) return UPDATE_CONFIG.currentVersion;
  
  try {
    const pkgPath = path.resolve('package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      UPDATE_CONFIG.currentVersion = pkg.version || '0.0.0';
      return UPDATE_CONFIG.currentVersion;
    }
  } catch { /* ignore */ }
  return '0.0.0';
}

// ─── Update Download ────────────────────────────────────────────────────────

/**
 * Download an update archive.
 * @returns {Object} { path, size, hash }
 */
export async function downloadUpdate(downloadUrl, options = {}) {
  const stagingDir = options.stagingDir || UPDATE_CONFIG.stagingDir;
  fs.mkdirSync(stagingDir, { recursive: true });

  const filename = options.filename || path.basename(new URL(downloadUrl).pathname) || 'update.tar.gz';
  const filePath = path.join(stagingDir, filename);

  try {
    const resp = await fetch(downloadUrl, {
      headers: { 'User-Agent': 'C3-Agent-Updater' },
      signal: AbortSignal.timeout(120000), // 2 min timeout
    });

    if (!resp.ok) {
      throw new Error(`Download failed: HTTP ${resp.status}`);
    }

    const buffer = Buffer.from(await resp.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    const hash = crypto.createHash('sha256').update(buffer).digest('hex');

    logger.info('Updater', `Downloaded ${filename} (${buffer.length} bytes, sha256:${hash.slice(0, 12)})`);

    return { path: filePath, size: buffer.length, hash, filename };
  } catch (err) {
    throw new Error(`Download failed: ${err.message}`);
  }
}

// ─── Update Application ─────────────────────────────────────────────────────

/**
 * Apply an update from a downloaded archive.
 * Creates backup first, then extracts new files.
 */
export async function applyUpdate(archivePath, options = {}) {
  const backupDir = options.backupDir || UPDATE_CONFIG.backupDir;
  const appDir = options.appDir || process.cwd();

  // 1. Create backup
  const backupName = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const backupPath = path.join(backupDir, backupName);
  fs.mkdirSync(backupPath, { recursive: true });

  logger.info('Updater', `Creating backup: ${backupPath}`);

  try {
    // Backup src/ directory
    const srcDir = path.join(appDir, 'src');
    if (fs.existsSync(srcDir)) {
      execSync(`cp -r ${srcDir} ${backupPath}/src`, { stdio: 'pipe' });
    }
    // Backup package.json
    const pkgJson = path.join(appDir, 'package.json');
    if (fs.existsSync(pkgJson)) {
      fs.copyFileSync(pkgJson, path.join(backupPath, 'package.json'));
    }
  } catch (err) {
    throw new Error(`Backup failed: ${err.message}`);
  }

  // 2. Extract archive
  const extractDir = path.join(UPDATE_CONFIG.stagingDir, 'extracted');
  fs.mkdirSync(extractDir, { recursive: true });

  try {
    if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
      execSync(`tar -xzf ${archivePath} -C ${extractDir}`, { stdio: 'pipe' });
    } else if (archivePath.endsWith('.zip')) {
      execSync(`unzip -o ${archivePath} -d ${extractDir}`, { stdio: 'pipe' });
    } else {
      throw new Error('Unsupported archive format');
    }
  } catch (err) {
    throw new Error(`Extract failed: ${err.message}`);
  }

  // 3. Find the extracted root (GitHub archives have a subdirectory)
  const extracted = fs.readdirSync(extractDir);
  const root = extracted.length === 1 && fs.statSync(path.join(extractDir, extracted[0])).isDirectory()
    ? path.join(extractDir, extracted[0])
    : extractDir;

  // 4. Copy new files
  const newSrc = path.join(root, 'src');
  if (fs.existsSync(newSrc)) {
    execSync(`cp -r ${newSrc}/* ${path.join(appDir, 'src')}/`, { stdio: 'pipe' });
  }

  const newPkg = path.join(root, 'package.json');
  if (fs.existsSync(newPkg)) {
    fs.copyFileSync(newPkg, path.join(appDir, 'package.json'));
  }

  // 5. Cleanup staging
  fs.rmSync(extractDir, { recursive: true, force: true });

  logger.info('Updater', 'Update applied successfully');

  return {
    success: true,
    backupPath,
    message: 'Update applied. Restart the server to use new version.',
  };
}

// ─── Rollback ───────────────────────────────────────────────────────────────

/**
 * Rollback to a backup.
 */
export function rollback(backupPath, appDir = process.cwd()) {
  const backupSrc = path.join(backupPath, 'src');
  if (!fs.existsSync(backupSrc)) {
    throw new Error('Backup not found or incomplete');
  }

  execSync(`rm -rf ${path.join(appDir, 'src')}`, { stdio: 'pipe' });
  execSync(`cp -r ${backupSrc} ${path.join(appDir, 'src')}`, { stdio: 'pipe' });

  const backupPkg = path.join(backupPath, 'package.json');
  if (fs.existsSync(backupPkg)) {
    fs.copyFileSync(backupPkg, path.join(appDir, 'package.json'));
  }

  logger.info('Updater', `Rolled back to ${backupPath}`);
  return { success: true, message: 'Rollback complete. Restart the server.' };
}

// ─── Background Checker ─────────────────────────────────────────────────────

let _checkTimer = null;

/**
 * Start periodic update checks.
 */
export function startUpdateChecker(onUpdateAvailable) {
  const interval = UPDATE_CONFIG.checkInterval;

  if (_checkTimer) clearInterval(_checkTimer);

  _checkTimer = setInterval(async () => {
    try {
      const result = await checkForUpdates();
      if (result.hasUpdate && onUpdateAvailable) {
        onUpdateAvailable(result);
      }
    } catch (err) {
      logger.debug('Updater', `Background check failed: ${err.message}`);
    }
  }, interval);

  // Check immediately on start
  setTimeout(async () => {
    try {
      const result = await checkForUpdates();
      if (result.hasUpdate && onUpdateAvailable) {
        onUpdateAvailable(result);
      }
    } catch { /* ignore */ }
  }, 5000);

  logger.info('Updater', `Update checker started (interval: ${interval / 1000}s)`);
}

export function stopUpdateChecker() {
  if (_checkTimer) {
    clearInterval(_checkTimer);
    _checkTimer = null;
  }
}

// ─── Exports ────────────────────────────────────────────────────────────────

export default {
  parseVersion,
  compareVersions,
  checkForUpdates,
  getCurrentVersion,
  downloadUpdate,
  applyUpdate,
  rollback,
  startUpdateChecker,
  stopUpdateChecker,
};
