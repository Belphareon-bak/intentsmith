// ═══════════════════════════════════════════════════════════════════════════════
// C3-Agent — Export Pipeline Extension (A5 + A6)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Adds PDF and DOCX export to the existing export-pipeline.js.
//
// Integration into existing export-pipeline.js:
//   1. Import this module
//   2. In the format switch/if-else, add 'pdf' and 'docx' cases
//   3. Both exporters follow the same contract: (turns, title, path, lang) → {size, path}
//
// ═══════════════════════════════════════════════════════════════════════════════

import { exportToPdf, isPdfAvailable } from './pdf-exporter.js';
import { exportToDocx, isDocxAvailable } from './docx-exporter.js';
import { writeFile, mkdir, stat } from 'fs/promises';
import { join, dirname } from 'path';

/**
 * Extended export that handles pdf/docx formats.
 * Designed to be called from the existing exportConversation() function
 * when format is 'pdf' or 'docx'.
 *
 * @param {string} conversationId
 * @param {object} options
 * @param {string} options.format - 'pdf' or 'docx'
 * @param {string} [options.scope='conversation'] - 'conversation'|'last'|'summary'
 * @param {object} options.store - ConversationStore instance
 * @param {string} options.artifactsDir - Output directory
 * @param {string} [options.lang='cs'] - Language
 * @param {Function} [options.summarizer] - For scope='summary'
 * @returns {Promise<{filename, format, size, path, turnCount, downloadUrl}>}
 */
export async function exportExtended(conversationId, options) {
  const {
    format,
    scope = 'conversation',
    store,
    artifactsDir,
    lang = 'cs',
    summarizer,
  } = options;

  // ─── Get turns based on scope ──────────────────────────────────────────
  const conv = store.getConversation(conversationId);
  if (!conv) {
    throw new Error(`Conversation ${conversationId} not found`);
  }

  const title = conv.title || conversationId;
  let turns = store.getTurns(conversationId);

  if (scope === 'last') {
    // Export only the last assistant turn
    const lastAssistant = [...turns].reverse().find(t => t.role === 'assistant');
    turns = lastAssistant ? [lastAssistant] : turns.slice(-1);
  } else if (scope === 'summary' && summarizer) {
    const summary = await summarizer(turns);
    turns = [{ role: 'assistant', content: summary }];
  }

  // ─── Ensure output directory ───────────────────────────────────────────
  await mkdir(artifactsDir, { recursive: true });

  // ─── Generate filename ─────────────────────────────────────────────────
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const safeName = title.replace(/[^a-zA-Z0-9áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ\s-]/g, '')
    .trim().replace(/\s+/g, '-').substring(0, 50) || 'export';
  const filename = `${safeName}-${timestamp}.${format}`;
  const outputPath = join(artifactsDir, filename);

  // ─── Format turns for exporters ────────────────────────────────────────
  const formattedTurns = turns.map(t => ({
    role: t.role || 'user',
    content: t.content || t.text || '',
  }));

  // ─── Export ────────────────────────────────────────────────────────────
  let result;
  if (format === 'pdf') {
    result = await exportToPdf(formattedTurns, title, outputPath, lang);
  } else if (format === 'docx') {
    result = await exportToDocx(formattedTurns, title, outputPath, lang);
  } else {
    throw new Error(`Unsupported format: ${format}. Use 'pdf' or 'docx'.`);
  }

  return {
    filename,
    format,
    size: result.size,
    path: result.path || outputPath,
    turnCount: formattedTurns.length,
    downloadUrl: `/api/artifacts/${filename}`,
  };
}

/**
 * Check availability of export formats.
 * @returns {Promise<{pdf: boolean, docx: boolean}>}
 */
export async function checkExportAvailability() {
  const [pdf, docx] = await Promise.all([
    isPdfAvailable(),
    Promise.resolve(isDocxAvailable()),
  ]);
  return { pdf, docx };
}

// ─── Integration patch for existing export-pipeline.js ───────────────────────
//
// In the existing exportConversation() function, add:
//
//   import { exportExtended } from './export/export-extended.js';
//
//   // Inside the format handler:
//   if (format === 'pdf' || format === 'docx') {
//     return exportExtended(conversationId, options);
//   }
//
// This keeps the existing md/html/txt logic untouched.
// ─────────────────────────────────────────────────────────────────────────────

export default { exportExtended, checkExportAvailability };
