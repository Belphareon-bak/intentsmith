// ═══════════════════════════════════════════════════════════════════════════════
// C3-Agent — DOCX Export Module (A6)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Generates styled DOCX from conversation turns using docx-js.
// Full Czech diacritics support (Arial/Calibri are Unicode-native in OOXML).
//
// Usage:
//   import { exportToDocx } from './export/docx-exporter.js';
//   const result = await exportToDocx(turns, title, outputPath, lang);
//
// ═══════════════════════════════════════════════════════════════════════════════

import { createRequire } from 'module';
import { writeFile, stat } from 'fs/promises';

// docx is CJS, use createRequire for ESM compatibility
const require = createRequire(import.meta.url);
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, TabStopPosition, TabStopType,
  ShadingType, Footer, PageNumber,
} = require('docx');

// ─── Colors ──────────────────────────────────────────────────────────────────

const C3_BLUE     = '2563EB';
const C3_DARK     = '1E293B';
const C3_GRAY     = '64748B';
const USER_BLUE   = '3B82F6';
const ASST_GREEN  = '22C55E';
const LIGHT_GRAY  = 'F1F5F9';
const BORDER_GRAY = 'E2E8F0';

// ─── Labels ──────────────────────────────────────────────────────────────────

const LABELS = {
  cs: { user: 'Uživatel', assistant: 'Asistent', exported: 'Exportováno z C3-Agent', turns: 'zpráv' },
  en: { user: 'User', assistant: 'Assistant', exported: 'Exported from C3-Agent', turns: 'messages' },
  de: { user: 'Benutzer', assistant: 'Assistent', exported: 'Exportiert aus C3-Agent', turns: 'Nachrichten' },
  sk: { user: 'Používateľ', assistant: 'Asistent', exported: 'Exportované z C3-Agent', turns: 'správ' },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(lang = 'cs') {
  const now = new Date();
  if (lang === 'cs' || lang === 'sk') {
    const d = now.getDate();
    const m = now.getMonth() + 1;
    const y = now.getFullYear();
    const h = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    return `${d}. ${m}. ${y} ${h}:${min}`;
  }
  return now.toISOString().replace('T', ' ').substring(0, 16);
}

/**
 * Convert text content into an array of TextRun/Paragraph children.
 * Handles newlines by creating separate paragraphs.
 */
function contentToParagraphs(text, style = {}) {
  const paragraphs = [];
  const blocks = text.split('\n');

  for (const line of blocks) {
    if (line.trim() === '') {
      // Empty line → spacer paragraph
      paragraphs.push(new Paragraph({ spacing: { after: 80 } }));
    } else {
      paragraphs.push(new Paragraph({
        spacing: { after: 40 },
        indent: { left: 200 },
        children: [
          new TextRun({
            text: line,
            font: 'Calibri',
            size: 20,  // 10pt
            color: C3_DARK,
            ...style,
          }),
        ],
      }));
    }
  }

  return paragraphs;
}

/**
 * Create a turn label paragraph ("👤 Uživatel" / "🤖 Asistent").
 */
function turnLabel(role, labels) {
  const isUser = role === 'user';
  const emoji = isUser ? '👤' : '🤖';
  const name = isUser ? labels.user : labels.assistant;
  const color = isUser ? USER_BLUE : ASST_GREEN;

  return new Paragraph({
    spacing: { before: 200, after: 60 },
    children: [
      new TextRun({
        text: `${emoji} ${name}`,
        font: 'Calibri',
        size: 18,  // 9pt
        bold: true,
        color,
      }),
    ],
  });
}

/**
 * Create a horizontal rule paragraph.
 */
function horizontalRule() {
  return new Paragraph({
    spacing: { before: 80, after: 80 },
    border: {
      bottom: {
        style: BorderStyle.SINGLE,
        size: 4,
        color: BORDER_GRAY,
        space: 4,
      },
    },
  });
}

// ─── Main Export Function ────────────────────────────────────────────────────

/**
 * Export conversation turns to DOCX.
 *
 * @param {Array<{role: string, content: string}>} turns - Conversation turns
 * @param {string} title - Document title
 * @param {string} outputPath - Where to write the DOCX
 * @param {string} [lang='cs'] - Language ('cs'|'en')
 * @returns {Promise<{size: number, path: string}>}
 */
export async function exportToDocx(turns, title, outputPath, lang = 'cs') {
  const labels = LABELS[lang] || LABELS['en'];
  const dateStr = formatDate(lang);
  const subtitle = `${labels.exported} • ${dateStr} • ${turns.length} ${labels.turns}`;

  // ─── Build document content ────────────────────────────────────────────
  const children = [];

  // Title
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { after: 60 },
    children: [
      new TextRun({
        text: title,
        font: 'Calibri',
        size: 36,  // 18pt
        bold: true,
        color: C3_DARK,
      }),
    ],
  }));

  // Subtitle (date, count)
  children.push(new Paragraph({
    spacing: { after: 200 },
    children: [
      new TextRun({
        text: subtitle,
        font: 'Calibri',
        size: 18,  // 9pt
        color: C3_GRAY,
      }),
    ],
  }));

  // Horizontal rule
  children.push(horizontalRule());

  // ─── Turns ─────────────────────────────────────────────────────────────
  for (const turn of turns) {
    const role = turn.role || 'user';
    const content = turn.content || '';

    // Turn label
    children.push(turnLabel(role, labels));

    // Turn content
    const contentParas = contentToParagraphs(content);
    children.push(...contentParas);

    // Separator
    children.push(horizontalRule());
  }

  // ─── Footer spacer ────────────────────────────────────────────────────
  children.push(new Paragraph({
    spacing: { before: 200 },
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({
        text: `C3-Agent • ${dateStr}`,
        font: 'Calibri',
        size: 14,  // 7pt
        color: C3_GRAY,
        italics: true,
      }),
    ],
  }));

  // ─── Create document ──────────────────────────────────────────────────
  const doc = new Document({
    creator: 'C3-Agent',
    title: title,
    description: subtitle,
    styles: {
      default: {
        document: {
          run: {
            font: 'Calibri',
            size: 20,  // 10pt default
          },
        },
      },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 36, bold: true, font: 'Calibri', color: C3_DARK },
          paragraph: { spacing: { before: 240, after: 120 } },
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: {
            width: 11906,   // A4 width in DXA
            height: 16838,  // A4 height in DXA
          },
          margin: {
            top: 1134,     // 2cm
            right: 1134,
            bottom: 1134,
            left: 1134,
          },
        },
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({
                  text: 'C3-Agent — ',
                  font: 'Calibri',
                  size: 14,
                  color: C3_GRAY,
                }),
                new TextRun({
                  children: [PageNumber.CURRENT],
                  font: 'Calibri',
                  size: 14,
                  color: C3_GRAY,
                }),
              ],
            }),
          ],
        }),
      },
      children,
    }],
  });

  // ─── Write file ────────────────────────────────────────────────────────
  const buffer = await Packer.toBuffer(doc);
  await writeFile(outputPath, buffer);

  const stats = await stat(outputPath);
  return { size: stats.size, path: outputPath };
}

/**
 * Check if DOCX export is available.
 * @returns {boolean}
 */
export function isDocxAvailable() {
  try {
    require('docx');
    return true;
  } catch {
    return false;
  }
}

export default { exportToDocx, isDocxAvailable };
