#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// Generate marketplace catalog.json from local packages
//
// Scans marketplace/packages/expertises/, skills/, specialists/ and builds
// a catalog.json with downloadUrl pointing to raw GitHub.
//
// Usage:
//   node scripts/generate-catalog.js [--repo OWNER/REPO] [--branch BRANCH]
//
// Output: marketplace/catalog.json
// ══════════════════════════════════════════════════════════════════════════════

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let repo = 'C3studio/C3-agent';
let branch = 'master';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--repo' && args[i + 1]) repo = args[++i];
  if (args[i] === '--branch' && args[i + 1]) branch = args[++i];
}

const RAW_BASE = `https://raw.githubusercontent.com/${repo}/${branch}`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

// ─── Scan Expertises ─────────────────────────────────────────────────────────

function scanExpertises() {
  const dir = join(ROOT, 'marketplace', 'packages', 'expertises');
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(file => {
      const filePath = join(dir, file);
      const data = readJson(filePath);
      const hash = sha256(filePath);
      const size = statSync(filePath).size;

      return {
        id: data.id || file.replace('.json', '').replace(/-/g, '_'),
        name: data.name || data.id || file.replace('.json', ''),
        version: '1.0.0',
        description: data.description || '',
        author: 'C3 Studio',
        icon: data.icon || null,
        domain: data.domain || 'general',
        tags: [data.domain, data.tone].filter(Boolean),
        downloadUrl: `${RAW_BASE}/marketplace/packages/expertises/${file}`,
        sha256: hash,
        size,
        engine: '>=124.0.0',
        dependencies: [],
      };
    });
}

// ─── Scan Skills ─────────────────────────────────────────────────────────────

function scanSkills() {
  const dir = join(ROOT, 'skills');
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(file => {
      const filePath = join(dir, file);
      const data = readJson(filePath);
      const hash = sha256(filePath);
      const size = statSync(filePath).size;

      return {
        id: data.id || file.replace('.json', ''),
        name: data.description ? data.description.substring(0, 60) : file.replace('.json', ''),
        version: String(data.version || 1),
        description: data.description || '',
        author: 'C3 Studio',
        tags: Object.keys(data.parameters || {}),
        downloadUrl: `${RAW_BASE}/skills/${file}`,
        sha256: hash,
        size,
        engine: '>=85.0.0',
        dependencies: [],
      };
    });
}

// ─── Scan Specialists ────────────────────────────────────────────────────────

function scanSpecialists() {
  const dir = join(ROOT, 'specialists');
  if (!existsSync(dir)) return [];

  return readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(ent => {
      const manifestPath = join(dir, ent.name, 'specialist.json');
      if (!existsSync(manifestPath)) return null;

      const manifest = readJson(manifestPath);

      return {
        id: manifest.id || ent.name,
        name: manifest.name || ent.name,
        version: manifest.version || '1.0.0',
        description: manifest.description || '',
        author: 'C3 Studio',
        icon: manifest.icon || null,
        tags: (manifest.capabilities || []).slice(0, 5),
        // Specialists need tar.gz — for now, point to the directory
        // (requires `scripts/package-specialist.sh <id>` to create archives)
        downloadUrl: `${RAW_BASE}/marketplace/packages/specialists/${ent.name}.tar.gz`,
        sha256: null,
        size: null,
        engine: manifest.engine || '>=121.0.0',
        dependencies: manifest.dependencies || [],
      };
    })
    .filter(Boolean);
}

// ─── Generate Catalog ────────────────────────────────────────────────────────

const expertises = scanExpertises();
const skills = scanSkills();
const specialists = scanSpecialists();

const catalog = {
  schema: 1,
  version: Date.now(),
  updated: new Date().toISOString(),
  repository: `https://github.com/${repo}`,
  packages: {
    skills,
    expertises,
    specialists,
  },
};

const outPath = join(ROOT, 'marketplace', 'catalog.json');
writeFileSync(outPath, JSON.stringify(catalog, null, 2) + '\n', 'utf-8');

const total = skills.length + expertises.length + specialists.length;
console.log(`Catalog generated: ${outPath}`);
console.log(`  Skills:      ${skills.length}`);
console.log(`  Expertises:  ${expertises.length}`);
console.log(`  Specialists: ${specialists.length}`);
console.log(`  Total:       ${total}`);
console.log(`  Raw base:    ${RAW_BASE}`);
