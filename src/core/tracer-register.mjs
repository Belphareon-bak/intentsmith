// ══════════════════════════════════════════════════════════════════════════════
// C3-Agent Runtime Module Tracer — Registration (Node 22+)
// ══════════════════════════════════════════════════════════════════════════════
//
// Zachytí KAŽDÝ modul načtený za runtime přes ESM hooks.
//
// POUŽITÍ:
//   node --import ./src/core/tracer-register.mjs src/server.js
//
// VÝSTUP:
//   logs/runtime-modules.json  — seznam načtených modulů (flush každých 10s)
//   GET /api/debug/modules     — pokud zavoláš attachRoutes(app)
//
// ══════════════════════════════════════════════════════════════════════════════

import { register } from 'node:module';
import { MessageChannel } from 'node:worker_threads';
import { writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(__filename), '../..');
const SRC_ROOT = resolve(dirname(__filename), '..');
const LOG_DIR = resolve(PROJECT_ROOT, 'logs');
const JSON_FILE = resolve(LOG_DIR, 'runtime-modules.json');

// ─── MessageChannel pro komunikaci s hooks workerem ─────────────────────────

const { port1, port2 } = new MessageChannel();

const loadedModules = new Map(); // relPath → { firstSeen, parent }
const startTime = new Date();

port1.on('message', (msg) => {
  if (msg.type === 'module-resolved') {
    const relPath = msg.relPath;
    if (!loadedModules.has(relPath)) {
      loadedModules.set(relPath, {
        firstSeen: new Date().toISOString(),
        parent: msg.parent || 'unknown',
      });
    }
  }
});

// Unref port to not block process exit
port1.unref();

// ─── Register hooks ─────────────────────────────────────────────────────────

register('./tracer-hooks.mjs', {
  parentURL: import.meta.url,
  data: { port: port2, srcRoot: SRC_ROOT },
  transferList: [port2],
});

// ─── Periodic flush to JSON ─────────────────────────────────────────────────

function flush() {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
  
  const modules = [...loadedModules.keys()].sort();
  const report = {
    startTime: startTime.toISOString(),
    uptime: Math.round((Date.now() - startTime.getTime()) / 1000) + 's',
    totalModules: modules.length,
    modules,
    details: Object.fromEntries(loadedModules),
  };
  
  writeFileSync(JSON_FILE, JSON.stringify(report, null, 2));
  return report;
}

const flushInterval = setInterval(() => {
  try { flush(); } catch { /* ignore */ }
}, 10000);
flushInterval.unref();

// Flush on exit
process.on('exit', () => { try { flush(); } catch {} });
process.on('SIGINT', () => { try { flush(); } catch {} process.exit(0); });
process.on('SIGTERM', () => { try { flush(); } catch {} process.exit(0); });

// ─── Walk filesystem helper ─────────────────────────────────────────────────

function walkDir(dir, base = '') {
  const files = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      const rel = base ? `${base}/${entry}` : entry;
      try {
        if (statSync(full).isDirectory()) {
          if (!entry.startsWith('.') && entry !== 'node_modules') {
            files.push(...walkDir(full, rel));
          }
        } else if (entry.endsWith('.js') || entry.endsWith('.mjs')) {
          files.push(rel);
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return files;
}

// ─── Express routes (optional) ──────────────────────────────────────────────

globalThis.__c3_tracer = {
  getLoadedModules() { return [...loadedModules.keys()].sort(); },
  getReport() { return flush(); },
  
  attachRoutes(app) {
    if (!app || typeof app.get !== 'function') return;
    
    app.get('/api/debug/modules', (req, res) => {
      res.json(flush());
    });
    
    app.get('/api/debug/modules/orphaned', (req, res) => {
      const allFiles = new Set(walkDir(SRC_ROOT));
      const loaded = new Set(flush().modules);
      const orphaned = [...allFiles].filter(f => !loaded.has(f)).sort();
      
      // Categorizace
      const byDir = {};
      for (const f of orphaned) {
        const dir = f.includes('/') ? f.split('/')[0] : '.';
        if (!byDir[dir]) byDir[dir] = [];
        byDir[dir].push(f);
      }
      
      res.json({
        totalFiles: allFiles.size,
        loadedFiles: loaded.size,
        orphanedFiles: orphaned.length,
        orphanedByDir: byDir,
        orphaned,
      });
    });
    
    console.log('[Tracer] 📡 /api/debug/modules');
    console.log('[Tracer] 📡 /api/debug/modules/orphaned');
  },
};

console.log(`[Tracer] ✅ Runtime module tracing active → ${JSON_FILE}`);
