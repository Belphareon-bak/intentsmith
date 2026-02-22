// Dummy Logger Specialist — Package Entry Point
// ══════════════════════════════════════════════════════════════════════════════
//
// Registers logger tools into SpecialistRuntime.
// Called by specialist-loader on enable().
//
// Minimal specialist for platform integration testing.
//
// ══════════════════════════════════════════════════════════════════════════════

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Inline Extractors ──────────────────────────────────────────────────────

function extractLogParams(input) {
  const params = {};

  // Level
  const levelMatch = input.match(/\b(debug|info|warn|error)\b/i);
  if (levelMatch) params.level = levelMatch[1].toLowerCase();

  // Source
  const sourceMatch = input.match(/(?:from|source|component|modul)\s+["']?(\w+)["']?/i);
  if (sourceMatch) params.source = sourceMatch[1];

  // Message — everything after "log", "zaloguj", "zapis" keyword
  const msgMatch = input.match(/(?:log|zaloguj|zapi[sš]|record|format)\s+(?:entry|záznam|zprávu?|message)?\s*[:\-]?\s*["']?(.+?)["']?\s*$/i);
  if (msgMatch) params.message = msgMatch[1].trim();

  return params;
}

// ─── Registration ────────────────────────────────────────────────────────────

/**
 * Register logger specialist tools into the runtime.
 * Called by specialist-loader on enable().
 *
 * @param {Object} ctx
 * @param {import('../../src/expertises/specialist-runtime.js').SpecialistRuntime} ctx.runtime
 */
export function register(ctx) {
  const { runtime } = ctx;
  const toolsDir = path.join(__dirname, 'tools');

  runtime.registerSpecialist({
    id: 'logger',
    domain: 'utility',
    globalParamExtractor: null,
    tools: [
      {
        id: 'logger.format_entry',
        name: 'Format Log Entry',
        description: 'Format a structured log entry with timestamp, level, source',
        modulePath: path.join(toolsDir, 'format-entry.js'),
        functionName: 'formatLogEntry',
        patterns: [{
          priority: 5,
          patterns: [
            /(?:log|zaloguj|zapi[sš])\s+.{3,}/i,
            /(?:format|naform[áa]tuj)\s+(?:log|z[áa]znam|entry)/i,
            /(?:vytvo[řr])\s+(?:log|z[áa]znam)/i,
          ],
        }],
        extractParams: extractLogParams,
      },
    ],
  });
}

/**
 * Unregister logger specialist from the runtime.
 * Called by specialist-loader on disable().
 *
 * @param {Object} ctx
 * @param {import('../../src/expertises/specialist-runtime.js').SpecialistRuntime} ctx.runtime
 */
export function unregister(ctx) {
  const { runtime } = ctx;
  if (typeof runtime.unregisterSpecialist === 'function') {
    runtime.unregisterSpecialist('logger');
  }
}
