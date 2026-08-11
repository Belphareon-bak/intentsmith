// Setup Wizard — First-Run Configuration (Phase F2)
// ══════════════════════════════════════════════════════════════════════════════
//
// Interactive terminal wizard for first-time setup.
// Also provides HTTP API for GUI-based setup (IDE/web).
//
// Collects:
//   - Ollama URL + model selection
//   - Language preference (cs/en)
//   - Data directory
//   - License key (if applicable)
//
// Retains any legacy notification subdocument for the later authority transfer,
// but no longer accepts notification credentials or destinations. Persists the
// setup state in c3-setup.json and patches only four owned keys in cwd .env.
//
// Usage:
//   node src/setup/wizard.js          # Interactive terminal
//   Import { SetupWizard } from ...   # Programmatic
//
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { createInterface } from 'readline';
import { parse as parseDotenv } from 'dotenv';
import { logger } from '../core/logger.js';

export const SETUP_NOTIFICATION_INPUT_RETIRED = 'SETUP_NOTIFICATION_INPUT_RETIRED';
export const SETUP_ENV_TARGET_OUT_OF_SCOPE = 'SETUP_ENV_TARGET_OUT_OF_SCOPE';
export const SETUP_ENV_TARGET_UNSAFE = 'SETUP_ENV_TARGET_UNSAFE';
export const SETUP_ENV_DUPLICATE_OWNED_KEY = 'SETUP_ENV_DUPLICATE_OWNED_KEY';
export const SETUP_ENV_VALUE_INVALID = 'SETUP_ENV_VALUE_INVALID';
export const SETUP_ENV_WRITE_FAILED = 'SETUP_ENV_WRITE_FAILED';
export const SETUP_ENV_PUBLICATION_UNKNOWN = 'SETUP_ENV_PUBLICATION_UNKNOWN';
export const SETUP_STATE_WRITE_FAILED = 'SETUP_STATE_WRITE_FAILED';

export const SETUP_ENV_OWNED_KEYS = Object.freeze([
  'OLLAMA_URL',
  'C3_LANG',
  'C3_DB_PATH',
  'C3_LICENSE_KEY',
]);

const SETUP_ENV_OWNED_KEY_SET = new Set(SETUP_ENV_OWNED_KEYS);
const ENV_ASSIGNMENT_PATTERN = /^(\uFEFF?[^\S\r\n]*(?:export[^\S\r\n]+)?)([\w.-]+)(?:[^\S\r\n]*=[^\S\r\n]*|:[^\S\r\n]+)/u;
// Structurally mirrors dotenv@17.3.1's assignment matcher, with captures
// around the spans that must never cross a physical line in this bounded
// writer. Leading blank-line whitespace is intentionally not rejected.
const DOTENV_ASSIGNMENT_SPAN_PATTERN = /^(\s*)(?:export(\s+))?([\w.-]+)(\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?$/gm;

export class SetupEnvironmentError extends Error {
  constructor(code) {
    super(code);
    this.name = 'SetupEnvironmentError';
    this.code = code;
  }
}

function setupEnvironmentError(code) {
  return new SetupEnvironmentError(code);
}

function currentUid() {
  return typeof process.geteuid === 'function' ? process.geteuid() : null;
}

export function requireSafeSetupEnvTarget(stat, expectedUid = currentUid()) {
  const isRegular = stat && typeof stat.isFile === 'function' && stat.isFile();
  const ownerMatches = expectedUid === null || stat?.uid === expectedUid;
  const mode = stat?.mode & 0o777;
  if (!isRegular || !ownerMatches || stat?.nlink !== 1 || mode !== 0o600) {
    throw setupEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
  }
  return stat;
}

function validateSetupEnvValues(values) {
  const normalized = Object.create(null);
  for (const key of SETUP_ENV_OWNED_KEYS) {
    if (!Object.hasOwn(values, key) || typeof values[key] !== 'string'
      || /[\r\n\0\u2028\u2029]/u.test(values[key])) {
      throw setupEnvironmentError(SETUP_ENV_VALUE_INVALID);
    }
    normalized[key] = values[key];
  }
  return Object.freeze(normalized);
}

function splitLinesWithEndings(text) {
  const lines = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== '\r' && text[index] !== '\n') continue;
    const end = text[index] === '\r' && text[index + 1] === '\n'
      ? index + 2
      : index + 1;
    lines.push(text.slice(start, end));
    start = end;
    if (end === index + 2) index += 1;
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

function envLineEnding(line) {
  if (line.endsWith('\r\n')) return '\r\n';
  if (line.endsWith('\n')) return '\n';
  return line.endsWith('\r') ? '\r' : '';
}

function stripEnvLineEnding(line) {
  if (line.endsWith('\r\n')) return line.slice(0, -2);
  if (line.endsWith('\r') || line.endsWith('\n')) return line.slice(0, -1);
  return line;
}

function assertNoMultilineDotenvAssignments(lines) {
  for (const line of lines) {
    const content = stripEnvLineEnding(line);
    const match = ENV_ASSIGNMENT_PATTERN.exec(content);
    if (!match) continue;
    const quote = content[match[0].length];
    if (quote !== "'" && quote !== '"' && quote !== '`') continue;
    let closed = false;
    for (let index = match[0].length + 1; index < content.length; index++) {
      if (content[index] === quote && content[index - 1] !== '\\') {
        closed = true;
        break;
      }
    }
    if (!closed) throw setupEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
  }
}

function assertNoCrossLineDotenvAssignments(text) {
  // JavaScript's multiline anchors (and therefore dotenv's pinned parser)
  // also treat U+2028/U+2029 as line terminators. This bounded writer only
  // preserves CR/LF physical records, so fail closed instead of allowing a
  // second parser-visible authority that the physical scanner cannot count.
  if (/[\u2028\u2029]/u.test(text)) {
    throw setupEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
  }
  const normalized = text.replace(/\r\n?/g, '\n');
  DOTENV_ASSIGNMENT_SPAN_PATTERN.lastIndex = 0;
  let match;
  while ((match = DOTENV_ASSIGNMENT_SPAN_PATTERN.exec(normalized)) !== null) {
    const crossLineSpan = [match[2], match[4], match[5]]
      .some(value => typeof value === 'string' && value.includes('\n'));
    if (crossLineSpan) throw setupEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
  }
}

function parseSetupEnvironment(bytes) {
  try {
    return parseDotenv(bytes);
  } catch {
    throw setupEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
  }
}

function assertRenderedSetupEnvironment(existingBytes, nextBytes, normalized) {
  const before = parseSetupEnvironment(existingBytes);
  const after = parseSetupEnvironment(nextBytes);
  const parsedKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of parsedKeys) {
    if (SETUP_ENV_OWNED_KEY_SET.has(key)) continue;
    if (Object.hasOwn(before, key) !== Object.hasOwn(after, key)
      || before[key] !== after[key]) {
      throw setupEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
    }
  }
  for (const key of SETUP_ENV_OWNED_KEYS) {
    const expectedPresent = key !== 'C3_LICENSE_KEY' || normalized[key] !== '';
    if (Object.hasOwn(after, key) !== expectedPresent
      || (expectedPresent && after[key] !== normalized[key])) {
      throw setupEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
    }
  }
}

function encodeEnvValue(value) {
  const candidates = [];
  if (value.trim() === value && !value.includes('#')) candidates.push(value);
  if (!value.includes("'")) candidates.push(`'${value}'`);
  if (!value.includes('`')) candidates.push(`\`${value}\``);
  if (!value.includes('"')) candidates.push(`"${value}"`);

  for (const candidate of candidates) {
    const parsed = parseDotenv(Buffer.from(`C3_SETUP_VALUE=${candidate}\n`, 'utf8'));
    if (parsed.C3_SETUP_VALUE === value) return candidate;
  }
  throw setupEnvironmentError(SETUP_ENV_VALUE_INVALID);
}

export function renderSetupEnvironment(existingBytes, values) {
  const normalized = validateSetupEnvValues(values);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(existingBytes);
  } catch {
    throw setupEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
  }

  const lines = splitLinesWithEndings(text);
  assertNoCrossLineDotenvAssignments(text);
  assertNoMultilineDotenvAssignments(lines);
  const ownedIndexes = new Map();
  for (let index = 0; index < lines.length; index++) {
    const content = stripEnvLineEnding(lines[index]);
    const match = ENV_ASSIGNMENT_PATTERN.exec(content);
    if (!match || !SETUP_ENV_OWNED_KEY_SET.has(match[2])) continue;
    if (ownedIndexes.has(match[2])) {
      throw setupEnvironmentError(SETUP_ENV_DUPLICATE_OWNED_KEY);
    }
    ownedIndexes.set(match[2], index);
  }

  const removed = new Set();
  for (const key of SETUP_ENV_OWNED_KEYS) {
    const index = ownedIndexes.get(key);
    const value = normalized[key];
    if (index === undefined) continue;
    if (key === 'C3_LICENSE_KEY' && value === '') {
      removed.add(index);
      continue;
    }
    const content = stripEnvLineEnding(lines[index]);
    const match = ENV_ASSIGNMENT_PATTERN.exec(content);
    lines[index] = `${match[1]}${key}=${encodeEnvValue(value)}${envLineEnding(lines[index])}`;
  }

  const retainedLines = lines
    .map((line, index) => ({ index, line }))
    .filter(({ index }) => !removed.has(index));
  let rendered = retainedLines.map(({ line }) => line).join('');
  const appended = [];
  for (const key of SETUP_ENV_OWNED_KEYS) {
    if (ownedIndexes.has(key)) continue;
    const value = normalized[key];
    if (key === 'C3_LICENSE_KEY' && value === '') continue;
    appended.push(`${key}=${encodeEnvValue(value)}\n`);
  }
  if (appended.length > 0) {
    const appendedText = appended.join('');
    const finalLine = retainedLines.at(-1);
    const finalLineIsUnterminated = finalLine
      && !finalLine.line.endsWith('\n')
      && !finalLine.line.endsWith('\r');
    const finalLineIsOwned = finalLine
      && [...ownedIndexes.values()].includes(finalLine.index);
    if (finalLineIsUnterminated && !finalLineIsOwned) {
      const prefix = retainedLines.slice(0, -1).map(({ line }) => line).join('');
      const bom = prefix.length === 0 && finalLine.line.startsWith('\uFEFF') ? '\uFEFF' : '';
      rendered = `${prefix}${bom}${appendedText}${finalLine.line.slice(bom.length)}`;
    } else {
      if (rendered.length > 0 && !rendered.endsWith('\n') && !rendered.endsWith('\r')) {
        rendered += '\n';
      }
      rendered += appendedText;
    }
  }
  const nextBytes = Buffer.from(rendered, 'utf8');
  assertRenderedSetupEnvironment(existingBytes, nextBytes, normalized);
  return nextBytes;
}

function fsyncDirectory(directoryPath) {
  const directoryFd = fs.openSync(
    directoryPath,
    fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0),
  );
  try {
    fs.fsyncSync(directoryFd);
  } finally {
    fs.closeSync(directoryFd);
  }
}

function requireOwnedDirectory(directoryPath) {
  const stat = fs.lstatSync(directoryPath);
  const expectedUid = currentUid();
  if (!stat.isDirectory() || stat.isSymbolicLink()
    || (expectedUid !== null && stat.uid !== expectedUid)
    || fs.realpathSync(directoryPath) !== directoryPath) {
    throw setupEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
  }
}

function readSafeExistingTarget(targetPath) {
  let lstat;
  try {
    lstat = fs.lstatSync(targetPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw setupEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
  }
  requireSafeSetupEnvTarget(lstat);

  let fd;
  try {
    fd = fs.openSync(targetPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const fstat = fs.fstatSync(fd);
    requireSafeSetupEnvTarget(fstat);
    if (fstat.dev !== lstat.dev || fstat.ino !== lstat.ino) {
      throw setupEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
    }
    return Object.freeze({
      bytes: fs.readFileSync(fd),
      dev: fstat.dev,
      ino: fstat.ino,
    });
  } catch (error) {
    if (error instanceof SetupEnvironmentError) throw error;
    throw setupEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function recheckExistingTarget(targetPath, snapshot) {
  const stat = fs.lstatSync(targetPath);
  requireSafeSetupEnvTarget(stat);
  if (stat.dev !== snapshot.dev || stat.ino !== snapshot.ino) {
    throw setupEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
  }
}

export function patchSetupEnvironmentFile(values, outputPath = '.env') {
  const targetPath = path.resolve(outputPath);
  const requiredPath = path.resolve(process.cwd(), '.env');
  if (targetPath !== requiredPath) {
    throw setupEnvironmentError(SETUP_ENV_TARGET_OUT_OF_SCOPE);
  }

  const directoryPath = path.dirname(targetPath);
  requireOwnedDirectory(directoryPath);
  const snapshot = readSafeExistingTarget(targetPath);
  const nextBytes = renderSetupEnvironment(snapshot?.bytes || Buffer.alloc(0), values);
  const tempPath = path.join(
    directoryPath,
    `.env.c3-setup-${process.pid}-${randomBytes(12).toString('hex')}.tmp`,
  );
  let tempCreated = false;
  let published = false;
  try {
    const tempFd = fs.openSync(
      tempPath,
      fs.constants.O_WRONLY
        | fs.constants.O_CREAT
        | fs.constants.O_EXCL
        | fs.constants.O_NOFOLLOW,
      0o600,
    );
    tempCreated = true;
    try {
      fs.writeFileSync(tempFd, nextBytes);
      fs.fchmodSync(tempFd, 0o600);
      fs.fsyncSync(tempFd);
    } finally {
      fs.closeSync(tempFd);
    }

    const tempStat = fs.lstatSync(tempPath);
    requireSafeSetupEnvTarget(tempStat);

    if (snapshot) {
      recheckExistingTarget(targetPath, snapshot);
      fs.renameSync(tempPath, targetPath);
      tempCreated = false;
      published = true;
    } else {
      fs.linkSync(tempPath, targetPath);
      published = true;
      fs.unlinkSync(tempPath);
      tempCreated = false;
    }
    const publishedSnapshot = readSafeExistingTarget(targetPath);
    if (!publishedSnapshot || !publishedSnapshot.bytes.equals(nextBytes)) {
      throw setupEnvironmentError(SETUP_ENV_PUBLICATION_UNKNOWN);
    }
    fsyncDirectory(directoryPath);
  } catch (error) {
    if (tempCreated) {
      try { fs.unlinkSync(tempPath); } catch { /* best-effort temp cleanup */ }
    }
    if (published) {
      throw setupEnvironmentError(SETUP_ENV_PUBLICATION_UNKNOWN);
    }
    if (error instanceof SetupEnvironmentError) throw error;
    if (error?.code === 'EEXIST' || error?.code === 'ELOOP') {
      throw setupEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
    }
    throw setupEnvironmentError(SETUP_ENV_WRITE_FAILED);
  }
}

// ─── Setup State ────────────────────────────────────────────────────────────

const SETUP_FILE = 'c3-setup.json';
const DEFAULT_SETUP = {
  version: 1,
  completed: false,
  completedAt: null,
  ollama: {
    url: 'http://127.0.0.1:11434',
    models: {
      CHAT: 'qwen3.5:27b',
      CODE: 'qwen3.5:27b',
      D1: 'deepseek-r1-32b',
      R1: 'deepseek-r1-32b',
      R2: 'qwen3.5:27b',
      D2: 'qwen3-30b-a3b',
    },
    verified: false,
  },
  language: 'cs',
  notifications: {
    telegram: { enabled: false, token: '', chatId: '' },
    email: { enabled: false, smtp: '', from: '', to: '' },
    ntfy: { enabled: false, topic: '', server: 'https://ntfy.sh' },
  },
  dataDir: './data',
  license: { key: '', activated: false },
};

// ─── Setup Wizard Class ─────────────────────────────────────────────────────

export class SetupWizard {
  constructor(dataDir = './data') {
    this.dataDir = dataDir;
    this.setupPath = path.join(dataDir, SETUP_FILE);
    this.config = { ...DEFAULT_SETUP };
  }

  /**
   * Check if setup has been completed.
   */
  isComplete() {
    try {
      if (fs.existsSync(this.setupPath)) {
        const data = JSON.parse(fs.readFileSync(this.setupPath, 'utf-8'));
        return data.completed === true;
      }
    } catch { /* ignore */ }
    return false;
  }

  /**
   * Load existing setup or defaults.
   */
  load() {
    try {
      if (fs.existsSync(this.setupPath)) {
        const data = JSON.parse(fs.readFileSync(this.setupPath, 'utf-8'));
        this.config = { ...DEFAULT_SETUP, ...data };
      }
    } catch (err) {
      logger.debug('Setup', `Load failed: ${err.message}`);
    }
    return this.config;
  }

  /**
   * Save setup configuration.
   */
  save() {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      fs.writeFileSync(this.setupPath, JSON.stringify(this.config, null, 2), 'utf-8');
      logger.info('Setup', `Configuration saved to ${this.setupPath}`);
      return true;
    } catch (err) {
      logger.error('Setup', `Save failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Update a section of the setup config.
   */
  update(section, values) {
    if (typeof this.config[section] === 'object' && this.config[section] !== null) {
      this.config[section] = { ...this.config[section], ...values };
    } else {
      this.config[section] = values;
    }
    return this;
  }

  /**
   * Mark setup as complete.
   */
  complete() {
    const previousCompleted = this.config.completed;
    const previousCompletedAt = this.config.completedAt;
    this.config.completed = true;
    this.config.completedAt = new Date().toISOString();
    if (this.save()) return true;
    this.config.completed = previousCompleted;
    this.config.completedAt = previousCompletedAt;
    return false;
  }

  /**
   * Verify Ollama connectivity.
   */
  async verifyOllama(url = null) {
    const ollamaUrl = url || this.config.ollama.url;
    try {
      const resp = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };

      const data = await resp.json();
      const models = (data.models || []).map(m => m.name);
      this.config.ollama.verified = true;
      return { ok: true, models, url: ollamaUrl };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Check which required models are available in Ollama.
   */
  async checkModels(url = null) {
    const result = await this.verifyOllama(url);
    if (!result.ok) return { ok: false, error: result.error, missing: [] };

    const required = Object.values(this.config.ollama.models);
    const unique = [...new Set(required)];
    const available = result.models.map(m => m.split(':')[0] + (m.includes(':') ? ':' + m.split(':')[1] : ''));

    const missing = unique.filter(req => {
      const base = req.split(':')[0];
      return !available.some(a => a.startsWith(base));
    });

    return { ok: missing.length === 0, models: result.models, missing, available };
  }

  /**
   * Generate only the setup-owned non-notification environment projection.
   */
  toEnvVars() {
    const env = {};
    env.OLLAMA_URL = this.config.ollama.url;
    env.C3_LANG = this.config.language;
    env.C3_DB_PATH = path.join(this.config.dataDir, 'c3.db');
    env.C3_LICENSE_KEY = this.config.license.key || '';

    return env;
  }

  /**
   * Atomically patch the exact cwd .env authority owned by setup.
   */
  writeEnvFile(outputPath = '.env') {
    patchSetupEnvironmentFile(this.toEnvVars(), outputPath);
  }

  /**
   * Get current config for API response.
   */
  getStatus() {
    return {
      completed: this.config.completed,
      completedAt: this.config.completedAt,
      ollamaUrl: this.config.ollama.url,
      ollamaVerified: this.config.ollama.verified,
      language: this.config.language,
      notifications: {
        telegram: this.config.notifications.telegram.enabled,
        email: this.config.notifications.email.enabled,
        ntfy: this.config.notifications.ntfy.enabled,
      },
      license: {
        hasKey: !!this.config.license.key,
        activated: this.config.license.activated,
      },
    };
  }
}

// ─── Interactive CLI Wizard ─────────────────────────────────────────────────

async function askQuestion(rl, question, defaultValue = '') {
  return new Promise(resolve => {
    const suffix = defaultValue ? ` [${defaultValue}]` : '';
    rl.question(`${question}${suffix}: `, answer => {
      resolve(answer.trim() || defaultValue);
    });
  });
}

export async function runInteractiveWizard(dataDir = './data') {
  const wizard = new SetupWizard(dataDir);
  wizard.load();

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║         C3-Agent — Setup Wizard          ║');
  console.log('╚══════════════════════════════════════════╝\n');

  try {
    // Step 1: Language
    const lang = await askQuestion(rl, '🌐 Jazyk / Language (cs/en)', wizard.config.language);
    wizard.config.language = lang === 'en' ? 'en' : 'cs';

    const cs = wizard.config.language === 'cs';

    // Step 2: Ollama URL
    console.log(cs ? '\n📡 Připojení k Ollama' : '\n📡 Ollama Connection');
    const ollamaUrl = await askQuestion(rl,
      cs ? 'Ollama URL' : 'Ollama URL',
      wizard.config.ollama.url
    );
    wizard.config.ollama.url = ollamaUrl;

    // Verify
    console.log(cs ? '  Ověřuji spojení...' : '  Verifying connection...');
    const verify = await wizard.verifyOllama(ollamaUrl);
    if (verify.ok) {
      console.log(cs ? `  ✅ Ollama OK — ${verify.models.length} modelů dostupných` : `  ✅ Ollama OK — ${verify.models.length} models available`);

      const modelCheck = await wizard.checkModels(ollamaUrl);
      if (modelCheck.missing.length > 0) {
        console.log(cs ? `  ⚠️ Chybí modely: ${modelCheck.missing.join(', ')}` : `  ⚠️ Missing models: ${modelCheck.missing.join(', ')}`);
        console.log(cs ? '  Nainstaluj je: ollama pull <model>' : '  Install them: ollama pull <model>');
      } else {
        console.log(cs ? '  ✅ Všechny potřebné modely jsou k dispozici' : '  ✅ All required models available');
      }
    } else {
      console.log(cs ? `  ❌ Nelze se připojit: ${verify.error}` : `  ❌ Cannot connect: ${verify.error}`);
      console.log(cs ? '  Pokračuji — oprav URL později v nastavení.' : '  Continuing — fix URL later in settings.');
    }

    // Step 3: Data directory
    console.log(cs ? '\n📁 Data' : '\n📁 Data');
    const dir = await askQuestion(rl, cs ? 'Složka pro data' : 'Data directory', wizard.config.dataDir);
    wizard.config.dataDir = dir;

    // Step 4: License key (optional)
    console.log(cs ? '\n🔑 Licence (volitelné)' : '\n🔑 License (optional)');
    const licKey = await askQuestion(rl, cs ? 'Licenční klíč (enter = přeskočit)' : 'License key (enter = skip)');
    if (licKey) {
      wizard.config.license.key = licKey;
    }

    // Save
    wizard.writeEnvFile();
    if (!wizard.complete()) {
      throw setupEnvironmentError(SETUP_STATE_WRITE_FAILED);
    }
    const envPath = path.resolve(process.cwd(), '.env');

    console.log(cs ? '\n✅ Konfigurace uložena!' : '\n✅ Configuration saved!');
    console.log(cs ? `   Setup: ${wizard.setupPath}` : `   Setup: ${wizard.setupPath}`);
    console.log(cs ? `   Env:   ${envPath}` : `   Env:   ${envPath}`);
    console.log(cs ? '\n🚀 Spusť C3: node src/server.js' : '\n🚀 Start C3: node src/server.js');

  } finally {
    rl.close();
  }

  return wizard;
}

// ─── API Routes (for GUI setup) ─────────────────────────────────────────────

/**
 * Create HTTP route handlers for setup API.
 * Compatible with server.js route convention: (req, res) handlers using sendJSON/parseBody from deps.
 */
export function createSetupRoutes(wizard, deps = {}) {
  const { sendJSON, parseBody } = deps;
  return {
    'GET /api/setup/status': (req, res) => {
      sendJSON(res, 200, wizard.getStatus());
    },

    'POST /api/setup/ollama': async (req, res) => {
      const body = await parseBody(req);
      const { url } = body;
      if (!url) return sendJSON(res, 400, { error: 'url required' });

      wizard.config.ollama.url = url;
      const result = await wizard.verifyOllama(url);
      if (result.ok) {
        const models = await wizard.checkModels(url);
        return sendJSON(res, 200, { ...result, ...models });
      }
      sendJSON(res, 200, result);
    },

    'POST /api/setup/language': async (req, res) => {
      const body = await parseBody(req);
      const { language } = body;
      if (!['cs', 'en'].includes(language)) return sendJSON(res, 400, { error: 'Invalid language' });
      wizard.config.language = language;
      sendJSON(res, 200, { language });
    },

    'POST /api/setup/notifications': (_req, res) => {
      sendJSON(res, 410, { ok: false, code: SETUP_NOTIFICATION_INPUT_RETIRED });
    },

    'POST /api/setup/license': async (req, res) => {
      const body = await parseBody(req);
      const { key } = body;
      wizard.config.license.key = key || '';
      sendJSON(res, 200, { hasKey: !!key });
    },

    'POST /api/setup/complete': async (req, res) => {
      let errorCode = null;
      try {
        wizard.writeEnvFile();
        if (!wizard.complete()) {
          throw setupEnvironmentError(SETUP_STATE_WRITE_FAILED);
        }
      } catch (error) {
        errorCode = error instanceof SetupEnvironmentError
          ? error.code
          : SETUP_ENV_WRITE_FAILED;
      }
      if (errorCode !== null) {
        const status = errorCode === SETUP_ENV_WRITE_FAILED
          || errorCode === SETUP_ENV_PUBLICATION_UNKNOWN
          || errorCode === SETUP_STATE_WRITE_FAILED
          ? 503
          : 409;
        return sendJSON(res, status, { ok: false, code: errorCode });
      }
      return sendJSON(res, 200, { ok: true, completed: true });
    },
  };
}

// ─── CLI entry point ────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith('wizard.js')) {
  runInteractiveWizard().catch(err => {
    console.error('Setup failed:', err.message);
    process.exit(1);
  });
}

export default SetupWizard;
