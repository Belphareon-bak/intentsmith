// ═══════════════════════════════════════════════════════════════════════════════
// IntentSmith — PDF Export Module (A5)
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
import { chmod, mkdtemp, rm, writeFile } from 'fs/promises';
import { homedir, tmpdir } from 'os';
import { dirname, isAbsolute, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PYTHON_SCRIPT = join(__dirname, 'pdf-exporter.py');
const PDF_RUNTIME_INSTALL_COMMAND = './scripts/install-pdf-runtime.sh';
const PDF_RUNTIME_VERSIONS = Object.freeze({
  charsetNormalizer: '3.4.4',
  pillow: '12.3.0',
  reportlab: '5.0.0',
});

/**
 * Resolve the private, reproducible Python interpreter used by PDF export.
 *
 * INTENTSMITH_PDF_PYTHON is the canonical override. C3_PDF_PYTHON remains a
 * compatibility alias while C3 configuration names are migrated.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {string}
 */
export function resolvePdfPythonInterpreter(env = process.env) {
  const canonical = env.INTENTSMITH_PDF_PYTHON?.trim();
  const legacy = env.C3_PDF_PYTHON?.trim();

  if (canonical && legacy && canonical !== legacy) {
    throw new Error(
      'Conflicting INTENTSMITH_PDF_PYTHON and C3_PDF_PYTHON values'
    );
  }

  const override = canonical || legacy;
  if (override) {
    if (!isAbsolute(override)) {
      throw new Error('PDF Python interpreter override must be an absolute path');
    }
    return resolve(override);
  }

  const configuredDataHome = env.XDG_DATA_HOME?.trim();
  if (configuredDataHome && !isAbsolute(configuredDataHome)) {
    throw new Error('XDG_DATA_HOME must be an absolute path');
  }

  const dataHome = configuredDataHome || join(homedir(), '.local', 'share');
  return join(dataHome, 'intentsmith', 'python', 'pdf', 'bin', 'python');
}

/**
 * Execute the isolated PDF Python runtime.
 *
 * @param {string[]} args
 * @param {{timeout?: number, maxBuffer?: number}} [options]
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
export async function runPdfPython(args, options = {}) {
  const interpreter = resolvePdfPythonInterpreter();
  const childEnv = {
    PYTHONNOUSERSITE: '1',
  };
  for (const key of ['LANG', 'LC_ALL', 'LC_CTYPE', 'TZ']) {
    if (process.env[key] !== undefined) {
      childEnv[key] = process.env[key];
    }
  }

  return new Promise((resolveRun, reject) => {
    execFile(interpreter, ['-I', ...args], {
      timeout: options.timeout,
      maxBuffer: options.maxBuffer,
      env: childEnv,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(
          `Isolated PDF runtime failed: ${error.message}\n${stderr}` +
          `\nInstall it with: ${PDF_RUNTIME_INSTALL_COMMAND}`
        ));
        return;
      }
      resolveRun({ stdout, stderr });
    });
  });
}

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
  // Keep private conversation input in an owned, unpredictable 0700 directory.
  const tempDirectory = await mkdtemp(join(tmpdir(), 'intentsmith-pdf-'));
  await chmod(tempDirectory, 0o700);
  const tmpInput = join(tempDirectory, 'input.json');

  try {
    const data = { title, turns, lang };
    await writeFile(tmpInput, JSON.stringify(data, null, 0), {
      encoding: 'utf-8',
      flag: 'wx',
      mode: 0o600,
    });

    // Call the private, isolated Python runtime.
    const { stdout } = await runPdfPython(
      [PYTHON_SCRIPT, tmpInput, outputPath],
      {
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    let result;
    try {
      result = JSON.parse(stdout.trim());
    } catch {
      throw new Error(`PDF script returned invalid JSON: ${stdout}`);
    }

    return result;
  } finally {
    // Cleanup only the exact directory created above.
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/**
 * Check if PDF export is available (Python + reportlab installed).
 * @returns {Promise<boolean>}
 */
export async function isPdfAvailable() {
  try {
    const { stdout } = await runPdfPython(
      [
        '-c',
        [
          'from importlib.metadata import version',
          'import sys',
          `expected={"charset-normalizer":"${PDF_RUNTIME_VERSIONS.charsetNormalizer}","pillow":"${PDF_RUNTIME_VERSIONS.pillow}","reportlab":"${PDF_RUNTIME_VERSIONS.reportlab}"}`,
          'actual={name:version(name) for name in expected}',
          'print("INTENTSMITH_PDF_RUNTIME_OK") if actual == expected else sys.exit(1)',
        ].join(';'),
      ],
      { timeout: 5000 }
    );
    return stdout.trim() === 'INTENTSMITH_PDF_RUNTIME_OK';
  } catch {
    return false;
  }
}

export default {
  exportToPdf,
  isPdfAvailable,
  resolvePdfPythonInterpreter,
  runPdfPython,
};
