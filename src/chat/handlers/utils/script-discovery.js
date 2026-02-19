// v67.0 — Script Discovery: Check project scripts before SHELL execution
// ══════════════════════════════════════════════════════════════════════════════
//
// Before executing an ad-hoc shell command, check if the project has
// documented scripts (scripts/README.md, package.json scripts) that
// could accomplish the same goal. Prefer project-established patterns.
//
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { logger } from '../../../core/logger.js';

/**
 * Discover available project scripts.
 *
 * @param {string} projectPath — Absolute path to the project directory
 * @returns {{ scripts: Array<{ name: string, description: string, source: string }>, readme: string|null }}
 */
export function discoverScripts(projectPath) {
  if (!projectPath) return { scripts: [], readme: null };

  const result = { scripts: [], readme: null };

  // 1. Check scripts/README.md
  try {
    const readmePath = path.join(projectPath, 'scripts', 'README.md');
    if (fs.existsSync(readmePath)) {
      const content = fs.readFileSync(readmePath, 'utf-8');
      result.readme = content.substring(0, 2000); // Limit size

      // Extract script names from README (look for ## headings or `script-name` patterns)
      const headingMatches = content.matchAll(/^##\s+(.+)/gm);
      for (const m of headingMatches) {
        result.scripts.push({
          name: m[1].trim(),
          description: '',
          source: 'scripts/README.md',
        });
      }

      // Also look for script files in scripts/ directory
      const scriptsDir = path.join(projectPath, 'scripts');
      if (fs.existsSync(scriptsDir)) {
        const files = fs.readdirSync(scriptsDir).filter(f =>
          f !== 'README.md' && !f.startsWith('.') &&
          (f.endsWith('.sh') || f.endsWith('.js') || f.endsWith('.py') || f.endsWith('.ts'))
        );
        for (const f of files) {
          if (!result.scripts.some(s => s.name === f)) {
            result.scripts.push({ name: f, description: '', source: 'scripts/' });
          }
        }
      }
    }
  } catch (err) {
    logger.debug('ScriptDiscovery', `scripts/README.md read failed: ${err.message}`);
  }

  // 2. Check package.json scripts
  try {
    const pkgPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.scripts && typeof pkg.scripts === 'object') {
        for (const [name, cmd] of Object.entries(pkg.scripts)) {
          result.scripts.push({
            name: `npm run ${name}`,
            description: String(cmd).substring(0, 100),
            source: 'package.json',
          });
        }
      }
    }
  } catch (err) {
    logger.debug('ScriptDiscovery', `package.json read failed: ${err.message}`);
  }

  // 3. Check Makefile targets
  try {
    const makefilePath = path.join(projectPath, 'Makefile');
    if (fs.existsSync(makefilePath)) {
      const content = fs.readFileSync(makefilePath, 'utf-8');
      const targets = content.matchAll(/^([a-zA-Z_][\w-]*)\s*:/gm);
      for (const m of targets) {
        const name = m[1];
        if (!['all', 'default', '.PHONY'].includes(name)) {
          result.scripts.push({
            name: `make ${name}`,
            description: '',
            source: 'Makefile',
          });
        }
      }
    }
  } catch (err) {
    logger.debug('ScriptDiscovery', `Makefile read failed: ${err.message}`);
  }

  return result;
}

/**
 * Find scripts that might match the user's shell command intent.
 *
 * @param {string} command — The shell command the user wants to run
 * @param {Array} scripts — Scripts from discoverScripts()
 * @returns {Array<{ name: string, description: string, source: string }>}
 */
export function findMatchingScripts(command, scripts) {
  if (!command || !scripts || scripts.length === 0) return [];

  const lower = command.toLowerCase();
  const keywords = lower.split(/\s+/).filter(w => w.length > 2);

  return scripts.filter(s => {
    const sLower = s.name.toLowerCase() + ' ' + (s.description || '').toLowerCase();
    return keywords.some(kw => sLower.includes(kw));
  }).slice(0, 5);
}

/**
 * Build a suggestion message if matching scripts exist.
 *
 * @param {string} projectPath
 * @param {string} command — The intended shell command
 * @returns {string|null} — Suggestion text or null
 */
export function getScriptSuggestion(projectPath, command) {
  if (!projectPath || !command) return null;

  const { scripts } = discoverScripts(projectPath);
  if (scripts.length === 0) return null;

  const matches = findMatchingScripts(command, scripts);
  if (matches.length === 0) return null;

  const suggestions = matches
    .map(s => `  \`${s.name}\`${s.description ? ` — ${s.description}` : ''} (${s.source})`)
    .join('\n');

  return `💡 Projekt má relevantní skripty:\n${suggestions}`;
}
