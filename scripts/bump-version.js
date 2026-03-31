#!/usr/bin/env node

/**
 * bump-version.js — Sync version across all canonical locations.
 *
 * Usage:
 *   node scripts/bump-version.js              # reads version from package.json
 *   node scripts/bump-version.js 136.0.0      # sets explicit version
 *   node scripts/bump-version.js --dry-run    # preview changes without writing
 *
 * Canonical locations (7 files, 11 replacements):
 *   package.json          → "version": "X.Y.Z"  (+ description line)
 *   README.md             → **Verze:** X.Y.Z
 *   CLAUDE.md             → **Verze:** vX.Y.Z  (line 3 + footer)
 *   docs/README.md        → # C3-Agent vX.Y.Z  (line 1 + footer)
 *   docs/ARCHITECTURE.md  → Architecture vMAJOR (line 1), **Version:** vX.Y.Z (line 3), footer
 *   docs/ROADMAP.md       → **Verze kódu:** vX.Y.Z  (line 6 + footer)
 *   docs/API-REFERENCE.md → > **vMAJOR** |
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const explicitVersion = args.find(a => !a.startsWith('--'));

// Read canonical version from package.json
const pkgPath = resolve(ROOT, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const version = explicitVersion || pkg.version;

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Invalid version format: "${version}" — expected X.Y.Z`);
  process.exit(1);
}

const major = version.split('.')[0];
const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

console.log(`\nVersion sync: v${version} (${today})`);
if (dryRun) console.log('  [DRY RUN — no files will be written]\n');
else console.log('');

let totalChanges = 0;

/**
 * Apply regex replacements to a file. Each replacement is [regex, replacement].
 * Returns number of changes made.
 */
function patchFile(relPath, replacements) {
  const absPath = resolve(ROOT, relPath);
  let content;
  try {
    content = readFileSync(absPath, 'utf8');
  } catch (err) {
    console.log(`  SKIP  ${relPath} — ${err.code}`);
    return 0;
  }

  let changed = 0;
  let result = content;

  for (const [pattern, replacement] of replacements) {
    const before = result;
    result = result.replace(pattern, replacement);
    if (result !== before) changed++;
  }

  if (changed === 0) {
    console.log(`  OK    ${relPath} — already up to date`);
    return 0;
  }

  if (!dryRun) {
    writeFileSync(absPath, result, 'utf8');
  }

  console.log(`  ${dryRun ? 'WOULD' : 'PATCH'} ${relPath} — ${changed} replacement(s)`);
  totalChanges += changed;
  return changed;
}

// ── 1. package.json ──────────────────────────────────────────────────────

if (explicitVersion) {
  patchFile('package.json', [
    [/"version":\s*"\d+\.\d+\.\d+"/, `"version": "${version}"`],
    [/C\.3 Agent v\d+/, `C.3 Agent v${major}`],
  ]);
}

// ── 2. README.md (root) ─────────────────────────────────────────────────

patchFile('README.md', [
  [/\*\*Verze:\*\*\s*\d+\.\d+\.\d+/, `**Verze:** ${version}`],
]);

// ── 3. CLAUDE.md ─────────────────────────────────────────────────────────

patchFile('CLAUDE.md', [
  [/\*\*Verze:\*\*\s*v\d+\.\d+\.\d+/, `**Verze:** v${version}`],
  [/\*Poslední aktualizace:\s*v\d+\.\d+\.\d+\s*\(\d{4}-\d{2}-\d{2}\)\*/,
    `*Poslední aktualizace: v${version} (${today})*`],
]);

// ── 4. docs/README.md ────────────────────────────────────────────────────

patchFile('docs/README.md', [
  [/# C3-Agent v\d+\.\d+\.\d+/, `# C3-Agent v${version}`],
  [/\*Posledni aktualizace:\s*v\d+\.\d+\.\d+\s*\(\d{4}-\d{2}-\d{2}\)\*/,
    `*Posledni aktualizace: v${version} (${today})*`],
]);

// ── 5. docs/ARCHITECTURE.md ─────────────────────────────────────────────

patchFile('docs/ARCHITECTURE.md', [
  [/Architecture v\d+/, `Architecture v${major}`],
  [/\*\*Version:\*\*\s*v\d+\.\d+\.\d+/, `**Version:** v${version}`],
  [/C\.3 Agent Platform v\d+\.\d+\.\d+ architecture \(\d{4}-\d{2}-\d{2}\)/,
    `C.3 Agent Platform v${version} architecture (${today})`],
]);

// ── 6. docs/ROADMAP.md ──────────────────────────────────────────────────

patchFile('docs/ROADMAP.md', [
  [/\*\*Verze kódu:\*\*\s*v\d+\.\d+\.\d+/, `**Verze kódu:** v${version}`],
  [/Aktualizováno na v\d+\.\d+\.\d+\s*\(\d{4}-\d{2}-\d{2}\)/,
    `Aktualizováno na v${version} (${today})`],
]);

// ── 7. docs/API-REFERENCE.md ────────────────────────────────────────────

patchFile('docs/API-REFERENCE.md', [
  [/> \*\*v\d+\*\*/, `> **v${major}**`],
]);

// ── Summary ──────────────────────────────────────────────────────────────

console.log(`\n  Total: ${totalChanges} change(s) across 7 files`);
if (dryRun && totalChanges > 0) {
  console.log('  Run without --dry-run to apply.\n');
}
