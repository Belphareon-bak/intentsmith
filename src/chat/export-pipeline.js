// CRE v57.2 — Sprint 4B: Export Pipeline (incl. PDF/DOCX)
// ══════════════════════════════════════════════════════════════════════════════
//
// Deterministic transformation: conversation → file.
// NOT an LLM intent. No routing, no tool calls.
//
// Invariants:
//   ❗ Export is PURE transformation, never modifies state
//   ❗ No internal metadata in export (confidence, gate logs, etc.)
//   ❗ Export operates on ConversationStore data only
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { getConversationStore } from './conversation-store.js';

// ─────────────────────────────────────────────────────────────────────────────
// Export Formats
// ─────────────────────────────────────────────────────────────────────────────

export const ExportFormat = Object.freeze({
  MARKDOWN: 'md',
  HTML: 'html',
  TEXT: 'txt',
  PDF: 'pdf',    // v57.1 A5: HTML→PDF via puppeteer
  DOCX: 'docx',  // v57.1 A6: DOCX via docx package
});

// ─────────────────────────────────────────────────────────────────────────────
// Export Scopes
// ─────────────────────────────────────────────────────────────────────────────

export const ExportScope = Object.freeze({
  LAST: 'last',                   // Last assistant turn only
  CONVERSATION: 'conversation',   // All turns
  SUMMARY: 'summary',             // Summary + last N turns
});

// ─────────────────────────────────────────────────────────────────────────────
// Export Command Detection
// ─────────────────────────────────────────────────────────────────────────────

const EXPORT_PATTERNS = [
  { pattern: /ulož.*(?:jako|do)\s+(markdown|md|html|txt|text|pdf|docx|word)/i, formatGroup: 1 },
  { pattern: /export(?:uj|ovat|ni).*(?:jako|do)\s+(markdown|md|html|txt|text|pdf|docx|word)/i, formatGroup: 1 },
  { pattern: /save.*(?:as|to)\s+(markdown|md|html|txt|text|pdf|docx|word)/i, formatGroup: 1 },
  { pattern: /(?:stáhn|stahni|download).*(?:jako|do)?\s*(markdown|md|html|txt|text|pdf|docx|word)/i, formatGroup: 1 },
  { pattern: /vygeneruj\s+(markdown|md|html|pdf|docx|word)\s+(?:soubor|stránku|dokument)/i, formatGroup: 1 },
];

/**
 * Detect if user input is an export command.
 *
 * @param {string} input — User message
 * @returns {{ isExport: boolean, format: string|null }}
 */
export function detectExportCommand(input) {
  if (!input || typeof input !== 'string') {
    return { isExport: false, format: null };
  }

  for (const { pattern, formatGroup } of EXPORT_PATTERNS) {
    const match = input.match(pattern);
    if (match) {
      const raw = match[formatGroup].toLowerCase();
      const format = normalizeFormat(raw);
      return { isExport: true, format };
    }
  }

  return { isExport: false, format: null };
}

function normalizeFormat(raw) {
  switch (raw) {
    case 'markdown': case 'md': return ExportFormat.MARKDOWN;
    case 'html': return ExportFormat.HTML;
    case 'txt': case 'text': return ExportFormat.TEXT;
    case 'pdf': return ExportFormat.PDF;
    case 'docx': case 'word': return ExportFormat.DOCX;
    default: return ExportFormat.MARKDOWN;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Core: Export Conversation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Export a conversation to a file.
 *
 * @param {string} conversationId
 * @param {Object} opts
 * @param {string} [opts.format='md'] — ExportFormat value
 * @param {string} [opts.scope='conversation'] — ExportScope value
 * @param {Object} [opts.store=null] — ConversationStore instance (auto-resolves if null)
 * @param {string} [opts.artifactsDir='./data/artifacts'] — Output directory
 * @returns {Promise<ExportResult>}
 */
export async function exportConversation(conversationId, opts = {}) {
  const {
    format = ExportFormat.MARKDOWN,
    scope = ExportScope.CONVERSATION,
    store = null,
    artifactsDir = './data/artifacts',
  } = opts;

  const _store = store || getConversationStore();

  // Get conversation metadata
  const conv = _store.getConversation(conversationId);
  if (!conv) {
    throw new Error(`Export: conversation ${conversationId} not found`);
  }

  // Get turns based on scope
  const turns = getTurnsForScope(_store, conversationId, scope);

  if (turns.length === 0) {
    throw new Error('Export: no messages to export');
  }

  // Format content
  const title = conv.title || `Konverzace ${conversationId}`;
  const date = new Date(conv.created_at || Date.now()).toLocaleDateString('cs-CZ');
  let content;
  let isBinary = false;

  switch (format) {
    case ExportFormat.HTML:
      content = renderHTML(title, date, turns, scope);
      break;
    case ExportFormat.TEXT:
      content = renderText(title, date, turns, scope);
      break;
    case ExportFormat.PDF:
      // v57.1 A5: HTML→PDF via puppeteer
      content = await renderPDF(title, date, turns, scope);
      isBinary = true;
      break;
    case ExportFormat.DOCX:
      // v57.1 A6: DOCX via docx package
      content = await renderDOCX(title, date, turns, scope);
      isBinary = true;
      break;
    case ExportFormat.MARKDOWN:
    default:
      content = renderMarkdown(title, date, turns, scope);
      break;
  }

  // Generate filename
  const safeName = title
    .replace(/[^a-zA-Z0-9áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 50)
    .toLowerCase();
  const timestamp = Date.now();
  const extMap = { html: 'html', txt: 'txt', pdf: 'pdf', docx: 'docx', md: 'md' };
  const ext = extMap[format] || 'md';
  const filename = `${safeName}-${timestamp}.${ext}`;

  // Write file
  const path = `${artifactsDir}/${filename}`;
  try {
    const fs = await import('fs/promises');
    const pathModule = await import('path');
    await fs.mkdir(pathModule.dirname(path), { recursive: true });
    if (isBinary) {
      await fs.writeFile(path, content); // Buffer for PDF/DOCX
    } else {
      await fs.writeFile(path, content, 'utf-8');
    }
  } catch (err) {
    logger.error('ExportPipeline', `File write failed: ${err.message}`);
    throw new Error(`Export: file write failed: ${err.message}`);
  }

  return {
    filename,
    path,
    downloadUrl: `/api/artifacts/${filename}`,
    format,
    scope,
    size: isBinary ? content.length : Buffer.byteLength(content, 'utf-8'),
    turnCount: turns.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scope Resolution
// ─────────────────────────────────────────────────────────────────────────────

function getTurnsForScope(store, conversationId, scope) {
  switch (scope) {
    case ExportScope.LAST: {
      // Last assistant turn
      const recent = store.getRecentTurns(conversationId, 5);
      const lastAssistant = [...recent].reverse().find(t => t.role === 'assistant');
      return lastAssistant ? [lastAssistant] : [];
    }

    case ExportScope.SUMMARY: {
      // Summary + last 5 turns
      const turns = store.getRecentTurns(conversationId, 5);
      const summary = store.getSummary?.(conversationId);
      if (summary?.summary) {
        // Prepend a synthetic summary turn
        turns.unshift({
          role: 'system',
          content: `[Shrnutí předchozí konverzace]\n${summary.summary}`,
          created_at: new Date().toISOString(),
        });
      }
      return turns;
    }

    case ExportScope.CONVERSATION:
    default: {
      return store.getAllTurns(conversationId);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Renderers (no internal metadata — user-facing only)
// ─────────────────────────────────────────────────────────────────────────────

function renderMarkdown(title, date, turns, scope) {
  const lines = [];
  lines.push(`# ${title}`);
  lines.push(`> ${date} | ${turns.length} zpráv`);
  if (scope !== ExportScope.CONVERSATION) {
    lines.push(`> Scope: ${scope}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const turn of turns) {
    const label = turn.role === 'user' ? '**Uživatel:**' :
                  turn.role === 'assistant' ? '**Asistent:**' :
                  '**Systém:**';
    lines.push(label);
    lines.push('');
    lines.push(turn.content);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  lines.push('*Exportováno z C3-Agent v57.2*');
  return lines.join('\n');
}

function renderHTML(title, date, turns, scope) {
  const escapedTurns = turns.map(t => ({
    role: t.role,
    content: escapeHTML(t.content),
  }));

  const turnHTML = escapedTurns.map(t => {
    const cls = t.role === 'user' ? 'turn-user' :
                t.role === 'assistant' ? 'turn-assistant' : 'turn-system';
    const label = t.role === 'user' ? 'Uživatel' :
                  t.role === 'assistant' ? 'Asistent' : 'Systém';
    return `    <div class="${cls}">
      <div class="turn-label">${label}</div>
      <div class="turn-content">${t.content.replace(/\n/g, '<br>')}</div>
    </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHTML(title)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      max-width: 800px; margin: 0 auto; padding: 2rem;
      color: #1a1a2e; background: #fafafa; line-height: 1.6;
    }
    h1 { font-size: 1.5rem; margin-bottom: 0.3rem; }
    .meta { color: #666; font-size: 0.85rem; margin-bottom: 1.5rem; }
    .turn-user {
      background: #e8edf3; padding: 1rem 1.2rem; border-radius: 12px;
      margin: 0.8rem 0; border-left: 3px solid #4a6fa5;
    }
    .turn-assistant {
      padding: 1rem 1.2rem; margin: 0.8rem 0;
      border-left: 3px solid #2d9a5c;
    }
    .turn-system {
      padding: 1rem 1.2rem; margin: 0.8rem 0;
      background: #fff8e1; border-left: 3px solid #f5a623;
      font-style: italic;
    }
    .turn-label {
      font-weight: 600; font-size: 0.85rem; margin-bottom: 0.4rem;
      text-transform: uppercase; letter-spacing: 0.5px;
    }
    .turn-user .turn-label { color: #4a6fa5; }
    .turn-assistant .turn-label { color: #2d9a5c; }
    .turn-system .turn-label { color: #f5a623; }
    .turn-content { white-space: pre-wrap; }
    footer { margin-top: 2rem; color: #999; font-size: 0.8rem; text-align: center; }
  </style>
</head>
<body>
  <h1>${escapeHTML(title)}</h1>
  <div class="meta">${date} | ${turns.length} zpráv</div>
${turnHTML}
  <footer>Exportováno z C3-Agent v57.2</footer>
</body>
</html>`;
}

function renderText(title, date, turns, scope) {
  const lines = [];
  lines.push(title);
  lines.push(`${date} | ${turns.length} zpráv`);
  lines.push('='.repeat(60));
  lines.push('');

  for (const turn of turns) {
    const label = turn.role === 'user' ? '[Uživatel]' :
                  turn.role === 'assistant' ? '[Asistent]' :
                  '[Systém]';
    lines.push(label);
    lines.push(turn.content);
    lines.push('');
    lines.push('-'.repeat(40));
    lines.push('');
  }

  lines.push('Exportováno z C3-Agent v57.2');
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// v57.1 A5: PDF Renderer (HTML→PDF via puppeteer)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render conversation as PDF.
 * Uses the HTML renderer → puppeteer to convert to PDF.
 * Requires: npm install puppeteer
 *
 * @returns {Promise<Buffer>} PDF as Buffer
 */
async function renderPDF(title, date, turns, scope) {
  const html = renderHTML(title, date, turns, scope);

  try {
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    const pdf = await page.pdf({
      format: 'A4',
      margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
      printBackground: true,
    });

    await browser.close();
    return Buffer.from(pdf);
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND' || err.message?.includes('Cannot find')) {
      logger.error('ExportPipeline', 'puppeteer not installed. Run: npm install puppeteer');
      throw new Error('Export PDF: puppeteer is not installed. Run: npm install puppeteer');
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// v57.1 A6: DOCX Renderer (via docx package)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render conversation as DOCX.
 * Requires: npm install docx
 *
 * @returns {Promise<Buffer>} DOCX as Buffer
 */
async function renderDOCX(title, date, turns, scope) {
  try {
    const docxLib = await import('docx');
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, BorderStyle, AlignmentType } = docxLib;

    const children = [];

    // Title
    children.push(new Paragraph({
      text: title,
      heading: HeadingLevel.HEADING_1,
    }));

    // Metadata
    children.push(new Paragraph({
      children: [
        new TextRun({ text: `${date} | ${turns.length} zpráv`, color: '666666', size: 20 }),
      ],
      spacing: { after: 300 },
    }));

    // Separator
    children.push(new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' } },
      spacing: { after: 200 },
    }));

    // Turns
    for (const turn of turns) {
      const label = turn.role === 'user' ? 'Uživatel' :
                    turn.role === 'assistant' ? 'Asistent' : 'Systém';
      const labelColor = turn.role === 'user' ? '4A6FA5' :
                         turn.role === 'assistant' ? '2D9A5C' : 'F5A623';

      // Label
      children.push(new Paragraph({
        children: [
          new TextRun({ text: label, bold: true, color: labelColor, size: 20, font: 'Segoe UI' }),
        ],
        spacing: { before: 200 },
      }));

      // Content — split by newlines for proper paragraph formatting
      const lines = (turn.content || '').split('\n');
      for (const line of lines) {
        if (line.trim()) {
          children.push(new Paragraph({
            children: [new TextRun({ text: line, size: 22, font: 'Segoe UI' })],
            spacing: { after: 80 },
          }));
        } else {
          children.push(new Paragraph({ spacing: { after: 80 } }));
        }
      }

      // Separator between turns
      children.push(new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'EEEEEE' } },
        spacing: { after: 100 },
      }));
    }

    // Footer
    children.push(new Paragraph({
      children: [
        new TextRun({ text: 'Exportováno z C3-Agent v57.1', italics: true, color: '999999', size: 18 }),
      ],
      spacing: { before: 400 },
      alignment: AlignmentType.CENTER,
    }));

    const doc = new Document({
      sections: [{
        properties: {
          page: {
            margin: { top: 1440, right: 1080, bottom: 1440, left: 1080 }, // twips
          },
        },
        children,
      }],
    });

    return await Packer.toBuffer(doc);
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND' || err.message?.includes('Cannot find')) {
      logger.error('ExportPipeline', 'docx not installed. Run: npm install docx');
      throw new Error('Export DOCX: docx package is not installed. Run: npm install docx');
    }
    throw err;
  }
}

function escapeHTML(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default {
  ExportFormat,
  ExportScope,
  detectExportCommand,
  exportConversation,
};
