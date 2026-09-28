#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// IntentSmith — A5 + A6: PDF & DOCX Export Tests
// ═══════════════════════════════════════════════════════════════════════════════
//
// Tests PDF (reportlab) and DOCX (docx-js) export pipelines.
// Run: node tests/export-pdf-docx.test.js
//
// ═══════════════════════════════════════════════════════════════════════════════

import { isolatedTestRuntime } from './helpers/isolated-test-db.js';

import { readFile, writeFile, stat, mkdir, mkdtemp, rm, symlink } from 'fs/promises';
import { join } from 'path';
import { execFile } from 'child_process';
import { createRequire } from 'module';
import {
  exportToPdf,
  isPdfAvailable,
  resolvePdfPythonInterpreter,
  runPdfPython,
} from '../src/chat/export/pdf-exporter.js';

// ─── Test Runner ─────────────────────────────────────────────────────────────

let total = 0, passed = 0, failed = 0;
const failures = [];
let currentSection = '';

function section(name) {
  currentSection = name;
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${name}`);
  console.log(`${'─'.repeat(60)}`);
}

async function t(name, fn) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message}`);
    failures.push({ section: currentSection, name, error: err.message });
  }
}

function eq(a, b, msg = '') {
  if (a !== b) throw new Error(`${msg} Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function ok(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}

// ─── Test Data ───────────────────────────────────────────────────────────────

const TEST_TURNS_CS = [
  { role: 'user', content: 'Jak se máš?' },
  { role: 'assistant', content: 'Výborně, díky za optání! Pracuji na Sprint 4.' },
  { role: 'user', content: 'Co nového?' },
  { role: 'assistant', content: 'Právě jsem dokončil kontext budget a export pipeline. Všech 96 testů prochází.' },
];

const TEST_TURNS_EN = [
  { role: 'user', content: 'Hello! How are you?' },
  { role: 'assistant', content: 'I\'m doing great, thanks for asking! Working on Sprint 4.' },
  { role: 'user', content: 'What\'s new?' },
  { role: 'assistant', content: 'Just finished the context budget and export pipeline. All 96 tests passing.' },
];

const TEST_TURNS_DIACRITICS = [
  { role: 'user', content: 'Příliš žluťoučký kůň úpěl ďábelské ódy.' },
  { role: 'assistant', content: 'Řeřicha říká: šťáva žďáru je ňáká zvláštní. Čeština má háčky i čárky — ě, š, č, ř, ž, ý, á, í, é, ú, ů.' },
];

const TEST_TURNS_MULTILINE = [
  { role: 'user', content: 'Shrnutí' },
  { role: 'assistant', content: 'Bod 1: První věc\nBod 2: Druhá věc\n\nBod 3: Třetí věc s prázdným řádkem\n\nBod 4: Závěr' },
];

const TEST_TURNS_LONG = Array.from({ length: 20 }, (_, i) => ({
  role: i % 2 === 0 ? 'user' : 'assistant',
  content: `Zpráva ${i + 1}: ${'Lorem ipsum dolor sit amet. '.repeat(10)}`,
}));

const TMP_BASE = await mkdtemp(join(
  isolatedTestRuntime.artifacts,
  'export-pdf-docx-',
));

// ═══════════════════════════════════════════════════════════════════════════════
//  A5: PDF Export
// ═══════════════════════════════════════════════════════════════════════════════

section('A5.0 — PDF prerequisites');

await t('reportlab is available', async () => {
  const { stdout } = await runPdfPython(
    [
      '-c',
      'import json; from importlib.metadata import version; print(json.dumps({name:version(name) for name in ("charset-normalizer","pillow","reportlab")},sort_keys=True))',
    ],
    { timeout: 5000 }
  );
  const available = JSON.parse(stdout.trim());
  eq(available['charset-normalizer'], '3.4.4', 'charset-normalizer lock mismatch');
  eq(available.pillow, '12.3.0', 'Pillow lock mismatch');
  eq(available.reportlab, '5.0.0', 'ReportLab lock mismatch');
  console.log(`     PDF packages: ${JSON.stringify(available)}`);
});

await t('PDF interpreter is absolute and isolated from user site-packages', async () => {
  const interpreter = resolvePdfPythonInterpreter();
  ok(interpreter.startsWith('/'), 'PDF interpreter must be an absolute path');
  const { stdout } = await runPdfPython(
    ['-c', 'import json, site, sys; print(json.dumps({"isolated": sys.flags.isolated, "user_site": site.ENABLE_USER_SITE}))'],
    { timeout: 5000 }
  );
  const state = JSON.parse(stdout.trim());
  eq(state.isolated, 1, 'Python isolated mode must be enabled');
  eq(state.user_site, false, 'Python user site-packages must be disabled');
});

await t('PDF subprocess receives no unrelated parent secrets', async () => {
  process.env.INTENTSMITH_PDF_TEST_SECRET = 'must-not-cross-runtime-boundary';
  try {
    const { stdout } = await runPdfPython(
      ['-c', 'import os; print("present" if "INTENTSMITH_PDF_TEST_SECRET" in os.environ else "absent")'],
      { timeout: 5000 }
    );
    eq(stdout.trim(), 'absent', 'unrelated parent secret reached PDF subprocess');
  } finally {
    delete process.env.INTENTSMITH_PDF_TEST_SECRET;
  }
});

await t('relative PDF interpreter override fails closed', async () => {
  let error = null;
  try {
    resolvePdfPythonInterpreter({ INTENTSMITH_PDF_PYTHON: 'relative/python' });
  } catch (caught) {
    error = caught;
  }
  ok(error, 'relative override must be rejected');
  ok(error.message.includes('absolute path'), 'rejection must explain absolute-path requirement');
});

await t('PDF installer rejects a symlinked ownership marker without touching its target', async () => {
  const dir = join(TMP_BASE, 'installer-marker-symlink');
  const runtimePath = join(dir, 'runtime');
  const victimPath = join(dir, 'must-not-change.txt');
  await mkdir(runtimePath, { recursive: true });
  await writeFile(victimPath, 'preserved', { encoding: 'utf-8', mode: 0o600 });
  await symlink(victimPath, join(runtimePath, '.intentsmith-pdf-runtime'));

  const result = await new Promise((resolve) => {
    execFile(
      join(process.cwd(), 'scripts/install-pdf-runtime.sh'),
      ['--venv', runtimePath],
      { timeout: 10000 },
      (error, stdout, stderr) => resolve({ error, stdout, stderr })
    );
  });

  ok(result.error, 'symlinked marker must make the installer fail');
  ok(result.stderr.includes('non-regular PDF runtime marker'), 'failure reason must identify marker');
  eq(await readFile(victimPath, 'utf-8'), 'preserved', 'marker target was modified');
});

await t('DejaVu fonts available', async () => {
  const fontPath = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
  try {
    await stat(fontPath);
  } catch {
    throw new Error(`DejaVu font not found at ${fontPath}`);
  }
});

section('A5.1 — PDF basic generation');

await t('PDF export CZ — valid file', async () => {
  const dir = join(TMP_BASE, 'pdf-cz');
  await mkdir(dir, { recursive: true });
  const inputPath = join(dir, 'input.json');
  const outputPath = join(dir, 'output.pdf');

  const data = { title: 'Test konverzace', turns: TEST_TURNS_CS, lang: 'cs' };
  await writeFile(inputPath, JSON.stringify(data), 'utf-8');

  const scriptPath = join(process.cwd(), 'src/chat/export/pdf-exporter.py');
  const { stdout } = await runPdfPython(
    [scriptPath, inputPath, outputPath],
    { timeout: 15000 }
  );
  const result = JSON.parse(stdout.trim());

  ok(result.size > 1000, `PDF should be >1KB, got ${result.size}`);

  // Verify magic bytes: %PDF
  const buf = await readFile(outputPath);
  ok(buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46,
    'File should start with %PDF magic bytes');
});

await t('PDF export EN — valid file', async () => {
  const dir = join(TMP_BASE, 'pdf-en');
  await mkdir(dir, { recursive: true });
  const inputPath = join(dir, 'input.json');
  const outputPath = join(dir, 'output.pdf');

  const data = { title: 'Test Conversation', turns: TEST_TURNS_EN, lang: 'en' };
  await writeFile(inputPath, JSON.stringify(data), 'utf-8');

  const scriptPath = join(process.cwd(), 'src/chat/export/pdf-exporter.py');
  const { stdout } = await runPdfPython(
    [scriptPath, inputPath, outputPath],
    { timeout: 15000 }
  );
  const result = JSON.parse(stdout.trim());

  ok(result.size > 1000, `PDF should be >1KB, got ${result.size}`);
  const buf = await readFile(outputPath);
  ok(buf[0] === 0x25, 'Must start with %PDF');
});

section('A5.2 — PDF Czech diacritics');

await t('PDF handles all Czech diacritics (ěščřžýáíéúůďťňó)', async () => {
  const dir = join(TMP_BASE, 'pdf-diac');
  await mkdir(dir, { recursive: true });
  const inputPath = join(dir, 'input.json');
  const outputPath = join(dir, 'output.pdf');

  const data = {
    title: 'Český test — háčky a čárky',
    turns: TEST_TURNS_DIACRITICS,
    lang: 'cs',
  };
  await writeFile(inputPath, JSON.stringify(data), 'utf-8');

  const scriptPath = join(process.cwd(), 'src/chat/export/pdf-exporter.py');
  const { stdout } = await runPdfPython(
    [scriptPath, inputPath, outputPath],
    { timeout: 15000 }
  );
  const result = JSON.parse(stdout.trim());

  ok(result.size > 500, `Diacritics PDF should generate, got ${result.size}`);
});

section('A5.3 — PDF multiline and long content');

await t('PDF handles multiline content with paragraph breaks', async () => {
  const dir = join(TMP_BASE, 'pdf-ml');
  await mkdir(dir, { recursive: true });
  const inputPath = join(dir, 'input.json');
  const outputPath = join(dir, 'output.pdf');

  await writeFile(inputPath, JSON.stringify({
    title: 'Multiline test', turns: TEST_TURNS_MULTILINE, lang: 'cs',
  }), 'utf-8');

  const scriptPath = join(process.cwd(), 'src/chat/export/pdf-exporter.py');
  const { stdout } = await runPdfPython(
    [scriptPath, inputPath, outputPath],
    { timeout: 15000 }
  );
  const result = JSON.parse(stdout.trim());

  ok(result.size > 500, 'Multiline PDF should generate');
});

await t('PDF handles 20-turn long conversation', async () => {
  const dir = join(TMP_BASE, 'pdf-long');
  await mkdir(dir, { recursive: true });
  const inputPath = join(dir, 'input.json');
  const outputPath = join(dir, 'output.pdf');

  await writeFile(inputPath, JSON.stringify({
    title: 'Long conversation', turns: TEST_TURNS_LONG, lang: 'cs',
  }), 'utf-8');

  const scriptPath = join(process.cwd(), 'src/chat/export/pdf-exporter.py');
  const { stdout } = await runPdfPython(
    [scriptPath, inputPath, outputPath],
    { timeout: 30000 }
  );
  const result = JSON.parse(stdout.trim());

  ok(result.size > 5000, `Long PDF should be substantial, got ${result.size}`);
});

section('A5.4 — PDF edge cases');

await t('PDF with empty turns → still generates', async () => {
  const dir = join(TMP_BASE, 'pdf-empty');
  await mkdir(dir, { recursive: true });
  const inputPath = join(dir, 'input.json');
  const outputPath = join(dir, 'output.pdf');

  await writeFile(inputPath, JSON.stringify({
    title: 'Empty', turns: [], lang: 'cs',
  }), 'utf-8');

  const scriptPath = join(process.cwd(), 'src/chat/export/pdf-exporter.py');
  const { stdout } = await runPdfPython(
    [scriptPath, inputPath, outputPath],
    { timeout: 15000 }
  );
  const result = JSON.parse(stdout.trim());

  ok(result.size > 0, 'Empty PDF should still generate');
});

await t('PDF with single turn', async () => {
  const dir = join(TMP_BASE, 'pdf-single');
  await mkdir(dir, { recursive: true });
  const inputPath = join(dir, 'input.json');
  const outputPath = join(dir, 'output.pdf');

  await writeFile(inputPath, JSON.stringify({
    title: 'Single', turns: [{ role: 'assistant', content: 'Odpověď' }], lang: 'cs',
  }), 'utf-8');

  const scriptPath = join(process.cwd(), 'src/chat/export/pdf-exporter.py');
  const { stdout } = await runPdfPython(
    [scriptPath, inputPath, outputPath],
    { timeout: 15000 }
  );
  const result = JSON.parse(stdout.trim());

  ok(result.size > 500, 'Single-turn PDF should generate');
});

// ═══════════════════════════════════════════════════════════════════════════════
//  A6: DOCX Export
// ═══════════════════════════════════════════════════════════════════════════════

section('A6.0 — DOCX prerequisites');

await t('docx npm package available', async () => {
  const require = createRequire(import.meta.url);
  const docx = require('docx');
  ok(docx.Document, 'docx.Document not found');
  ok(docx.Packer, 'docx.Packer not found');
  ok(docx.Paragraph, 'docx.Paragraph not found');
});

section('A6.1 — DOCX basic generation');

await t('DOCX export CZ — valid file', async () => {
  const { exportToDocx } = await import('../src/chat/export/docx-exporter.js');

  const dir = join(TMP_BASE, 'docx-cz');
  await mkdir(dir, { recursive: true });
  const outputPath = join(dir, 'output.docx');

  const result = await exportToDocx(TEST_TURNS_CS, 'Test konverzace', outputPath, 'cs');

  ok(result.size > 1000, `DOCX should be >1KB, got ${result.size}`);

  // Verify magic bytes: PK (ZIP format)
  const buf = await readFile(outputPath);
  ok(buf[0] === 0x50 && buf[1] === 0x4B,
    'DOCX should start with PK (ZIP) magic bytes');
});

await t('DOCX export EN — valid file', async () => {
  const { exportToDocx } = await import('../src/chat/export/docx-exporter.js');

  const dir = join(TMP_BASE, 'docx-en');
  await mkdir(dir, { recursive: true });
  const outputPath = join(dir, 'output.docx');

  const result = await exportToDocx(TEST_TURNS_EN, 'Test Conversation', outputPath, 'en');

  ok(result.size > 1000, `DOCX should be >1KB, got ${result.size}`);
  const buf = await readFile(outputPath);
  ok(buf[0] === 0x50 && buf[1] === 0x4B, 'Must start with PK');
});

section('A6.2 — DOCX Czech diacritics');

await t('DOCX handles all Czech diacritics', async () => {
  const { exportToDocx } = await import('../src/chat/export/docx-exporter.js');

  const dir = join(TMP_BASE, 'docx-diac');
  await mkdir(dir, { recursive: true });
  const outputPath = join(dir, 'output.docx');

  const result = await exportToDocx(
    TEST_TURNS_DIACRITICS,
    'Český test — háčky a čárky',
    outputPath, 'cs'
  );

  ok(result.size > 500, `Diacritics DOCX should generate, got ${result.size}`);
});

section('A6.3 — DOCX multiline and long content');

await t('DOCX handles multiline content', async () => {
  const { exportToDocx } = await import('../src/chat/export/docx-exporter.js');

  const dir = join(TMP_BASE, 'docx-ml');
  await mkdir(dir, { recursive: true });
  const outputPath = join(dir, 'output.docx');

  const result = await exportToDocx(
    TEST_TURNS_MULTILINE, 'Multiline test', outputPath, 'cs'
  );

  ok(result.size > 500, 'Multiline DOCX should generate');
});

await t('DOCX handles 20-turn long conversation', async () => {
  const { exportToDocx } = await import('../src/chat/export/docx-exporter.js');

  const dir = join(TMP_BASE, 'docx-long');
  await mkdir(dir, { recursive: true });
  const outputPath = join(dir, 'output.docx');

  const result = await exportToDocx(
    TEST_TURNS_LONG, 'Long conversation', outputPath, 'cs'
  );

  ok(result.size > 5000, `Long DOCX should be substantial, got ${result.size}`);
});

section('A6.4 — DOCX edge cases');

await t('DOCX with empty turns → still generates', async () => {
  const { exportToDocx } = await import('../src/chat/export/docx-exporter.js');

  const dir = join(TMP_BASE, 'docx-empty');
  await mkdir(dir, { recursive: true });
  const outputPath = join(dir, 'output.docx');

  const result = await exportToDocx([], 'Empty', outputPath, 'cs');
  ok(result.size > 0, 'Empty DOCX should still generate');
});

await t('DOCX with single turn', async () => {
  const { exportToDocx } = await import('../src/chat/export/docx-exporter.js');

  const dir = join(TMP_BASE, 'docx-single');
  await mkdir(dir, { recursive: true });
  const outputPath = join(dir, 'output.docx');

  const result = await exportToDocx(
    [{ role: 'assistant', content: 'Odpověď' }],
    'Single', outputPath, 'cs'
  );

  ok(result.size > 500, 'Single-turn DOCX should generate');
});

await t('DOCX with special chars (& < > quotes)', async () => {
  const { exportToDocx } = await import('../src/chat/export/docx-exporter.js');

  const dir = join(TMP_BASE, 'docx-special');
  await mkdir(dir, { recursive: true });
  const outputPath = join(dir, 'output.docx');

  const turns = [
    { role: 'user', content: 'What about A & B < C > D "quotes" \'apostrophe\'?' },
    { role: 'assistant', content: 'Sure: <script>alert("xss")</script> — no problem.' },
  ];

  const result = await exportToDocx(turns, 'Special chars', outputPath, 'en');
  ok(result.size > 500, 'Special chars DOCX should generate');
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Node.js wrapper integration test
// ═══════════════════════════════════════════════════════════════════════════════

section('Integration — Node.js PDF wrapper');

await t('pdf-exporter.js exportToPdf() works end-to-end', async () => {
  const dir = join(TMP_BASE, 'pdf-node');
  await mkdir(dir, { recursive: true });
  const outputPath = join(dir, 'output.pdf');

  const result = await exportToPdf(TEST_TURNS_CS, 'Node wrapper test', outputPath, 'cs');

  ok(result.size > 1000, `Node PDF wrapper should produce >1KB, got ${result.size}`);
  eq((await stat(outputPath)).mode & 0o777, 0o600, 'PDF export must be private');
  const buf = await readFile(outputPath);
  ok(buf[0] === 0x25, 'Must be valid PDF');
});

await t('pdf-exporter.js isPdfAvailable() returns true', async () => {
  const available = await isPdfAvailable();
  eq(available, true, 'reportlab should be available');
});

await t('pdf-exporter.js rejects an executable that emits no verification sentinel', async () => {
  const previous = process.env.INTENTSMITH_PDF_PYTHON;
  process.env.INTENTSMITH_PDF_PYTHON = '/bin/true';
  try {
    eq(await isPdfAvailable(), false, 'empty successful process must not pass availability');
  } finally {
    if (previous === undefined) {
      delete process.env.INTENTSMITH_PDF_PYTHON;
    } else {
      process.env.INTENTSMITH_PDF_PYTHON = previous;
    }
  }
});

await t('pdf-exporter.js does not use predictable conversation input paths', async () => {
  const dir = join(TMP_BASE, 'pdf-private-input');
  await mkdir(dir, { recursive: true });
  const outputPath = join(dir, 'output.pdf');
  const victimPath = join(dir, 'must-not-change.txt');
  const predictableInputPath = outputPath + '.input.json';
  await writeFile(victimPath, 'preserved', { encoding: 'utf-8', mode: 0o600 });
  await symlink(victimPath, predictableInputPath);

  await exportToPdf(TEST_TURNS_CS, 'Private input test', outputPath, 'cs');

  eq(await readFile(victimPath, 'utf-8'), 'preserved', 'predictable-path victim changed');
});

section('Integration — DOCX availability check');

await t('docx-exporter.js isDocxAvailable() returns true', async () => {
  const { isDocxAvailable } = await import('../src/chat/export/docx-exporter.js');
  eq(isDocxAvailable(), true, 'docx should be available');
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Comparative: PDF vs DOCX same content
// ═══════════════════════════════════════════════════════════════════════════════

section('Comparative — same content in both formats');

await t('same 4-turn CZ conversation → both formats generate', async () => {
  const { exportToDocx } = await import('../src/chat/export/docx-exporter.js');

  const dir = join(TMP_BASE, 'compare');
  await mkdir(dir, { recursive: true });

  const pdfResult = await exportToPdf(TEST_TURNS_CS, 'Srovnání', join(dir, 'test.pdf'), 'cs');
  const docxResult = await exportToDocx(TEST_TURNS_CS, 'Srovnání', join(dir, 'test.docx'), 'cs');

  ok(pdfResult.size > 1000, `PDF: ${pdfResult.size} bytes`);
  ok(docxResult.size > 1000, `DOCX: ${docxResult.size} bytes`);

  console.log(`     PDF: ${pdfResult.size} bytes, DOCX: ${docxResult.size} bytes`);
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Cleanup
// ═══════════════════════════════════════════════════════════════════════════════

if (failed === 0) {
  await rm(TMP_BASE, { recursive: true, force: false });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Results
// ═══════════════════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(60)}`);
console.log(`  A5+A6 Export Tests: ${passed}/${total} passed, ${failed} failed`);
console.log(`${'═'.repeat(60)}`);

if (failures.length > 0) {
  console.log('\nFailed tests:');
  for (const f of failures) {
    console.log(`  ❌ [${f.section}] ${f.name}: ${f.error}`);
  }
}

console.log(`\nVÝSLEDKY: ${passed} OK, ${failed} FAIL, ${total} celkem`);
process.exit(failed > 0 ? 1 : 0);
