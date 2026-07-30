// Plaintext artifact validation used by the lifecycle BUILD gate.

import fs from 'fs';
import path from 'path';

const ARTIFACT_REQUIRED_EXTENSIONS = new Set([
  '.txt',
  '.sql',
  '.env',
  '.yaml',
  '.yml',
  '.toml',
  '.sh',
  '.ini',
  '.cfg',
  '.conf',
]);

/**
 * Return whether a lifecycle scope file is subject to plaintext validation.
 *
 * @param {string} relPath
 * @returns {boolean}
 */
export function isRequiredArtifactPath(relPath) {
  return ARTIFACT_REQUIRED_EXTENSIONS.has(path.extname(relPath));
}

/**
 * Validate one scoped plaintext artifact.
 *
 * Missing or unreadable files remain the responsibility of the downstream
 * quality gate, preserving the existing lifecycle behavior.
 *
 * @param {string} relPath - Project-relative artifact path
 * @param {string} fullPath - Absolute artifact path
 * @returns {{ ok: boolean, reason?: string, kind?: 'zero-byte' }}
 */
export function validateArtifactFile(relPath, fullPath) {
  let stat;
  try {
    stat = fs.statSync(fullPath);
  } catch {
    return { ok: true };
  }

  if (stat.size === 0) {
    return { ok: false, reason: '0 bytes', kind: 'zero-byte' };
  }

  return checkArtifactContent(relPath, fullPath, path.extname(relPath));
}

/**
 * Validate that a generated plaintext artifact has meaningful content.
 * Goes beyond the 0-byte check for formats with a known minimal structure.
 *
 * @param {string} relPath - Relative path (for basename checks)
 * @param {string} fullPath - Absolute path to file
 * @param {string} ext - File extension
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkArtifactContent(relPath, fullPath, ext) {
  let content;
  try {
    content = fs.readFileSync(fullPath, 'utf-8');
  } catch {
    return { ok: true };
  }

  const basename = path.basename(relPath);

  // requirements.txt: at least 1 non-comment, non-option package line
  if (basename === 'requirements.txt' || basename === 'requirements-dev.txt') {
    const pkgLines = content
      .split('\n')
      .filter(line => line.trim() && !line.startsWith('#') && !line.startsWith('-'));
    if (pkgLines.length === 0) return { ok: false, reason: 'no package lines' };
    return { ok: true };
  }

  // .env: at least 1 KEY=VALUE pair
  if (ext === '.env') {
    if (!/^[A-Z_a-z]\w*\s*=/m.test(content)) {
      return { ok: false, reason: 'no KEY=VALUE pairs' };
    }
    return { ok: true };
  }

  // .sql: must contain recognizable SQL
  if (ext === '.sql') {
    if (!/\b(CREATE|INSERT|SELECT|UPDATE|DELETE|ALTER|DROP|BEGIN|PRAGMA)\b/i.test(content)) {
      return { ok: false, reason: 'no SQL statements found' };
    }
    return { ok: true };
  }

  // .yaml/.yml: must have at least one key: value line
  if (ext === '.yaml' || ext === '.yml') {
    if (!/^\s*\w[\w-]*\s*:/m.test(content)) {
      return { ok: false, reason: 'no key: value pairs' };
    }
    return { ok: true };
  }

  // .toml: must have [section] or key = value
  if (ext === '.toml') {
    if (!/^\[|\w+\s*=/m.test(content)) {
      return { ok: false, reason: 'no TOML content' };
    }
    return { ok: true };
  }

  // .sh/.bash/.zsh: must have at least one non-comment line
  if (ext === '.sh' || ext === '.bash' || ext === '.zsh') {
    const codeLines = content
      .split('\n')
      .filter(line => line.trim() && !line.startsWith('#'));
    if (codeLines.length === 0) return { ok: false, reason: 'no shell commands' };
    return { ok: true };
  }

  return { ok: true };
}
