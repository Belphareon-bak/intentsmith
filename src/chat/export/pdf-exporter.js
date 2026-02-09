// ═══════════════════════════════════════════════════════════════════════════════
// C3-Agent — PDF Export Module (A5)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Generates styled PDF from conversation turns.
// Uses Python reportlab via child_process for Czech diacritics support.
//
// Usage:
//   import { exportToPdf } from './export/pdf-exporter.js';
//   const result = await exportToPdf(turns, title, outputPath, lang);
//
// ═══════════════════════════════════════════════════════════════════════════════

import { execFile } from 'child_process';
import { writeFile, unlink, stat } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PYTHON_SCRIPT = join(__dirname, 'pdf-exporter.py');

/**
 * Export conversation turns to PDF.
 *
 * @param {Array<{role: string, content: string}>} turns - Conversation turns
 * @param {string} title - Document title
 * @param {string} outputPath - Where to write the PDF
 * @param {string} [lang='cs'] - Language ('cs'|'en')
 * @returns {Promise<{size: number, path: string}>}
 */
export async function exportToPdf(turns, title, outputPath, lang = 'cs') {
  // Write turns to temp JSON for Python script
  const tmpInput = outputPath + '.input.json';

  try {
    const data = { title, turns, lang };
    await writeFile(tmpInput, JSON.stringify(data, null, 0), 'utf-8');

    // Call Python script
    const result = await new Promise((resolve, reject) => {
      execFile('python3', [PYTHON_SCRIPT, tmpInput, outputPath], {
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
      }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`PDF generation failed: ${error.message}\n${stderr}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          reject(new Error(`PDF script returned invalid JSON: ${stdout}`));
        }
      });
    });

    return result;
  } finally {
    // Cleanup temp file
    try { await unlink(tmpInput); } catch { /* ignore */ }
  }
}

/**
 * Check if PDF export is available (Python + reportlab installed).
 * @returns {Promise<boolean>}
 */
export async function isPdfAvailable() {
  return new Promise((resolve) => {
    execFile('python3', ['-c', 'import reportlab; print("ok")'], {
      timeout: 5000,
    }, (error, stdout) => {
      resolve(!error && stdout.trim() === 'ok');
    });
  });
}

export default { exportToPdf, isPdfAvailable };
