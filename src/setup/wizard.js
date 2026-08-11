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
// setup state in c3-setup.json and delegates its exact four-key patch to the
// canonical project-root .env authority.
//
// Usage:
//   node src/setup/wizard.js          # Interactive terminal
//   Import { SetupWizard } from ...   # Programmatic
//
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { createInterface } from 'readline';
import { fileURLToPath } from 'node:url';
import { logger } from '../core/logger.js';
import { SETUP_ADMIN_AUTH_REQUIRED } from '../security/strict-admin-auth.js';
import {
  ROOT_ENVIRONMENT_OWNER,
  SETUP_ENV_DUPLICATE_OWNED_KEY,
  SETUP_ENV_OWNED_KEYS,
  SETUP_ENV_PUBLICATION_UNKNOWN,
  SETUP_ENV_TARGET_OUT_OF_SCOPE,
  SETUP_ENV_TARGET_UNSAFE,
  SETUP_ENV_VALUE_INVALID,
  SETUP_ENV_WRITE_FAILED,
  SetupEnvironmentError,
  patchRootEnvironmentFile,
  renderRootEnvironment,
  requireCanonicalRootEnvironmentProjectRoot,
  requireSafeRootEnvironmentTarget,
} from '../security/root-environment-file.js';

export {
  SETUP_ENV_DUPLICATE_OWNED_KEY,
  SETUP_ENV_OWNED_KEYS,
  SETUP_ENV_PUBLICATION_UNKNOWN,
  SETUP_ENV_TARGET_OUT_OF_SCOPE,
  SETUP_ENV_TARGET_UNSAFE,
  SETUP_ENV_VALUE_INVALID,
  SETUP_ENV_WRITE_FAILED,
  SetupEnvironmentError,
};

export const SETUP_NOTIFICATION_INPUT_RETIRED = 'SETUP_NOTIFICATION_INPUT_RETIRED';
export const SETUP_STATE_WRITE_FAILED = 'SETUP_STATE_WRITE_FAILED';
export const SETUP_STATE_INVALID = 'SETUP_STATE_INVALID';
export const SETUP_ALREADY_COMPLETE = 'SETUP_ALREADY_COMPLETE';

const DEFAULT_PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

function setupEnvironmentError(code) {
  return new SetupEnvironmentError(code);
}

// Backwards-compatible P0 test/API names delegate to the shared seam.
export function requireSafeSetupEnvTarget(stat, expectedUid) {
  return expectedUid === undefined
    ? requireSafeRootEnvironmentTarget(stat)
    : requireSafeRootEnvironmentTarget(stat, expectedUid);
}

export function renderSetupEnvironment(existingBytes, values) {
  return renderRootEnvironment(existingBytes, {
    owner: ROOT_ENVIRONMENT_OWNER.SETUP,
    values,
  });
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
    telegram: { enabled: false },
    email: { enabled: false },
    ntfy: { enabled: false },
  },
  dataDir: './data',
  license: { key: '', activated: false },
};

function createDefaultSetup() {
  return {
    ...DEFAULT_SETUP,
    ollama: {
      ...DEFAULT_SETUP.ollama,
      models: { ...DEFAULT_SETUP.ollama.models },
    },
    notifications: {
      telegram: { ...DEFAULT_SETUP.notifications.telegram },
      email: { ...DEFAULT_SETUP.notifications.email },
      ntfy: { ...DEFAULT_SETUP.notifications.ntfy },
    },
    license: { ...DEFAULT_SETUP.license },
  };
}

function normalizeProjectRoot(projectRoot) {
  return requireCanonicalRootEnvironmentProjectRoot(projectRoot);
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function requireOptionalType(record, key, predicate) {
  if (Object.hasOwn(record, key) && !predicate(record[key])) {
    throw setupEnvironmentError(SETUP_STATE_INVALID);
  }
}

function validateSetupState(state) {
  if (!isPlainObject(state)) throw setupEnvironmentError(SETUP_STATE_INVALID);
  requireOptionalType(state, 'version', value => Number.isInteger(value));
  requireOptionalType(state, 'completed', value => typeof value === 'boolean');
  requireOptionalType(
    state,
    'completedAt',
    value => value === null || typeof value === 'string',
  );
  requireOptionalType(state, 'language', value => typeof value === 'string');
  requireOptionalType(state, 'dataDir', value => typeof value === 'string');

  for (const container of ['ollama', 'notifications', 'license']) {
    requireOptionalType(state, container, isPlainObject);
  }
  if (state.ollama) {
    requireOptionalType(state.ollama, 'url', value => typeof value === 'string');
    requireOptionalType(state.ollama, 'verified', value => typeof value === 'boolean');
    requireOptionalType(state.ollama, 'models', isPlainObject);
    if (state.ollama.models) {
      for (const value of Object.values(state.ollama.models)) {
        if (typeof value !== 'string') throw setupEnvironmentError(SETUP_STATE_INVALID);
      }
    }
  }
  if (state.license) {
    requireOptionalType(state.license, 'key', value => typeof value === 'string');
    requireOptionalType(state.license, 'activated', value => typeof value === 'boolean');
  }
  if (state.notifications) {
    const notificationShapes = {
      telegram: { enabled: 'boolean', token: 'string', chatId: 'string' },
      email: { enabled: 'boolean', smtp: 'string', from: 'string', to: 'string' },
      ntfy: { enabled: 'boolean', topic: 'string', server: 'string' },
    };
    for (const [channel, leaves] of Object.entries(notificationShapes)) {
      requireOptionalType(state.notifications, channel, isPlainObject);
      const channelState = state.notifications[channel];
      if (!channelState) continue;
      for (const [key, type] of Object.entries(leaves)) {
        requireOptionalType(channelState, key, value => typeof value === type);
      }
    }
  }
  return state;
}

function readDurableSetupState(setupPath) {
  let bytes;
  try {
    bytes = fs.readFileSync(setupPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw setupEnvironmentError(SETUP_STATE_INVALID);
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return validateSetupState(JSON.parse(text));
  } catch (error) {
    if (error instanceof SetupEnvironmentError) throw error;
    throw setupEnvironmentError(SETUP_STATE_INVALID);
  }
}

// ─── Setup Wizard Class ─────────────────────────────────────────────────────

export class SetupWizard {
  constructor(dataDir = './data', { projectRoot = DEFAULT_PROJECT_ROOT } = {}) {
    this.dataDir = dataDir;
    this.setupPath = path.join(dataDir, SETUP_FILE);
    Object.defineProperty(this, 'projectRoot', {
      configurable: false,
      enumerable: true,
      value: normalizeProjectRoot(projectRoot),
      writable: false,
    });
    this.config = createDefaultSetup();
  }

  /**
   * Check if setup has been completed.
   */
  isComplete() {
    return readDurableSetupState(this.setupPath)?.completed === true;
  }

  /**
   * Load existing setup or defaults.
   */
  load() {
    const data = readDurableSetupState(this.setupPath);
    this.config = data === null
      ? createDefaultSetup()
      : { ...createDefaultSetup(), ...data };
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

    const required = Object.values(
      this.config.ollama.models || DEFAULT_SETUP.ollama.models,
    );
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
    env.OLLAMA_URL = this.config.ollama.url ?? DEFAULT_SETUP.ollama.url;
    env.C3_LANG = this.config.language;
    env.C3_DB_PATH = path.join(this.config.dataDir, 'c3.db');
    env.C3_LICENSE_KEY = this.config.license.key || '';

    return env;
  }

  /**
   * Atomically patch only the canonical project-root .env authority.
   */
  writeEnvFile(...requestedTargets) {
    if (requestedTargets.length !== 0) {
      throw setupEnvironmentError(SETUP_ENV_TARGET_OUT_OF_SCOPE);
    }
    patchRootEnvironmentFile({
      projectRoot: this.projectRoot,
      owner: ROOT_ENVIRONMENT_OWNER.SETUP,
      values: this.toEnvVars(),
    });
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
        telegram: this.config.notifications?.telegram?.enabled === true,
        email: this.config.notifications?.email?.enabled === true,
        ntfy: this.config.notifications?.ntfy?.enabled === true,
      },
      license: {
        hasKey: !!this.config.license?.key,
        activated: this.config.license?.activated === true,
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
    const envPath = path.join(wizard.projectRoot, '.env');

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
  const { sendJSON, parseBody, requireSetupAdminAuth } = deps;
  if (typeof requireSetupAdminAuth !== 'function') {
    throw setupEnvironmentError(SETUP_ADMIN_AUTH_REQUIRED);
  }
  const denyAdmin = res => sendJSON(res, 403, {
    ok: false,
    code: SETUP_ADMIN_AUTH_REQUIRED,
  });
  return {
    'GET /api/setup/status': (req, res) => {
      sendJSON(res, 200, wizard.getStatus());
    },

    'POST /api/setup/ollama': async (req, res) => {
      if (requireSetupAdminAuth(req) !== true) return denyAdmin(res);
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
      if (requireSetupAdminAuth(req) !== true) return denyAdmin(res);
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
      if (requireSetupAdminAuth(req) !== true) return denyAdmin(res);
      const body = await parseBody(req);
      const { key } = body;
      wizard.config.license.key = key || '';
      sendJSON(res, 200, { hasKey: !!key });
    },

    'POST /api/setup/complete': async (req, res) => {
      if (requireSetupAdminAuth(req) !== true) return denyAdmin(res);
      let errorCode = null;
      let alreadyComplete = false;
      try {
        alreadyComplete = wizard.isComplete();
      } catch (error) {
        errorCode = error instanceof SetupEnvironmentError
          ? error.code
          : SETUP_STATE_INVALID;
      }
      if (errorCode !== null) {
        return sendJSON(res, 409, { ok: false, code: errorCode });
      }
      if (alreadyComplete) {
        return sendJSON(res, 409, { ok: false, code: SETUP_ALREADY_COMPLETE });
      }

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
