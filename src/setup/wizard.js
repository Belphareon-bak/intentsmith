// Setup Wizard — First-Run Configuration (Phase F2)
// ══════════════════════════════════════════════════════════════════════════════
//
// Interactive terminal wizard for first-time setup.
// Also provides HTTP API for GUI-based setup (IDE/web).
//
// Collects:
//   - Ollama URL + model selection
//   - Language preference (cs/en)
//   - Notification channels (Telegram token, email SMTP)
//   - Data directory
//   - License key (if applicable)
//
// Stores in: data/c3-setup.json + updates config.js env vars
//
// Usage:
//   node src/setup/wizard.js          # Interactive terminal
//   Import { SetupWizard } from ...   # Programmatic
//
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { createInterface } from 'readline';
import { DEFAULT_MODEL_BINDINGS } from '../config.js';
import { logger } from '../core/logger.js';

// ─── Setup State ────────────────────────────────────────────────────────────

const SETUP_FILE = 'c3-setup.json';
const SETUP_SCHEMA_VERSION = 2;
const LEGACY_MODEL_DEFAULTS_V1 = Object.freeze({
  D1: Object.freeze(['deepseek-r1-32b', 'deepseek-r1:32b']),
  D2: Object.freeze(['qwen3-30b-a3b', 'qwen3-30b-a3b:latest']),
  CODE: Object.freeze(['qwen3.5:27b']),
  R1: Object.freeze(['deepseek-r1-32b', 'deepseek-r1:32b']),
  R2: Object.freeze(['qwen3.5:27b']),
  CHAT: Object.freeze(['qwen3.5:27b']),
  VISION: Object.freeze(['llava:13b']),
});
const DEFAULT_SETUP = {
  version: SETUP_SCHEMA_VERSION,
  completed: false,
  completedAt: null,
  ollama: {
    url: 'http://127.0.0.1:11434',
    models: { ...DEFAULT_MODEL_BINDINGS },
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

function cloneDefaultSetup() {
  return structuredClone(DEFAULT_SETUP);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function migrateSetupConfig(value) {
  if (!isObject(value)) throw new Error('Setup configuration must be an object');
  const sourceVersion = Number.isSafeInteger(value.version) ? value.version : 1;
  if (sourceVersion > SETUP_SCHEMA_VERSION) {
    throw new Error(`Unsupported setup configuration version: ${sourceVersion}`);
  }

  let migrated = structuredClone(value);
  if (sourceVersion < 2) {
    const oldModels = isObject(migrated.ollama?.models)
      ? migrated.ollama.models
      : {};
    const models = {};
    for (const [role, currentDefault] of Object.entries(DEFAULT_MODEL_BINDINGS)) {
      const previous = oldModels[role];
      const wasLegacyDefault = LEGACY_MODEL_DEFAULTS_V1[role]?.includes(previous);
      models[role] = previous === undefined || wasLegacyDefault
        ? currentDefault
        : previous;
    }
    migrated = {
      ...migrated,
      version: 2,
      ollama: {
        ...(isObject(migrated.ollama) ? migrated.ollama : {}),
        models,
      },
    };
  }
  return migrated;
}

function mergeSetupDefaults(value) {
  const defaults = cloneDefaultSetup();
  const ollama = isObject(value.ollama) ? value.ollama : {};
  const notifications = isObject(value.notifications) ? value.notifications : {};
  return {
    ...defaults,
    ...value,
    version: SETUP_SCHEMA_VERSION,
    ollama: {
      ...defaults.ollama,
      ...ollama,
      models: {
        ...defaults.ollama.models,
        ...(isObject(ollama.models) ? ollama.models : {}),
      },
    },
    notifications: {
      ...defaults.notifications,
      ...notifications,
      telegram: {
        ...defaults.notifications.telegram,
        ...(isObject(notifications.telegram) ? notifications.telegram : {}),
      },
      email: {
        ...defaults.notifications.email,
        ...(isObject(notifications.email) ? notifications.email : {}),
      },
      ntfy: {
        ...defaults.notifications.ntfy,
        ...(isObject(notifications.ntfy) ? notifications.ntfy : {}),
      },
    },
    license: {
      ...defaults.license,
      ...(isObject(value.license) ? value.license : {}),
    },
  };
}

// ─── Setup Wizard Class ─────────────────────────────────────────────────────

export class SetupWizard {
  constructor(dataDir = './data') {
    this.dataDir = dataDir;
    this.setupPath = path.join(dataDir, SETUP_FILE);
    this.config = cloneDefaultSetup();
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
        this.config = mergeSetupDefaults(migrateSetupConfig(data));
        if (JSON.stringify(this.config) !== JSON.stringify(data)) this.save();
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
    this.config.completed = true;
    this.config.completedAt = new Date().toISOString();
    return this.save();
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
   * Generate environment variables from setup config.
   */
  toEnvVars() {
    const env = {};
    env.OLLAMA_URL = this.config.ollama.url;
    env.C3_LANG = this.config.language;
    env.C3_DB_PATH = path.join(this.config.dataDir, 'c3.db');
    for (const role of Object.keys(DEFAULT_MODEL_BINDINGS)) {
      env[`C3_MODEL_${role}`] = this.config.ollama.models[role];
    }

    if (this.config.notifications.telegram.enabled) {
      env.TELEGRAM_BOT_TOKEN = this.config.notifications.telegram.token;
      env.TELEGRAM_CHAT_ID = this.config.notifications.telegram.chatId;
    }
    if (this.config.notifications.email.enabled) {
      env.SMTP_URL = this.config.notifications.email.smtp;
      env.EMAIL_FROM = this.config.notifications.email.from;
      env.EMAIL_TO = this.config.notifications.email.to;
    }
    if (this.config.notifications.ntfy.enabled) {
      env.NTFY_TOPIC = this.config.notifications.ntfy.topic;
      env.NTFY_SERVER = this.config.notifications.ntfy.server;
    }
    if (this.config.license.key) {
      env.C3_LICENSE_KEY = this.config.license.key;
    }

    return env;
  }

  /**
   * Write .env file from setup config.
   */
  writeEnvFile(outputPath = '.env') {
    const env = this.toEnvVars();
    const lines = Object.entries(env)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${v}`);
    
    fs.writeFileSync(outputPath, lines.join('\n') + '\n', 'utf-8');
    return outputPath;
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

async function askYesNo(rl, question, defaultYes = true) {
  const suffix = defaultYes ? ' [Y/n]' : ' [y/N]';
  const answer = await askQuestion(rl, `${question}${suffix}`);
  if (!answer) return defaultYes;
  return /^[yYaA]/i.test(answer);
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

    // Step 3: Notifications (optional)
    console.log(cs ? '\n🔔 Notifikace (volitelné)' : '\n🔔 Notifications (optional)');

    if (await askYesNo(rl, cs ? 'Nastavit Telegram?' : 'Configure Telegram?', false)) {
      const token = await askQuestion(rl, 'Bot token');
      const chatId = await askQuestion(rl, 'Chat ID');
      wizard.config.notifications.telegram = { enabled: true, token, chatId };
    }

    if (await askYesNo(rl, cs ? 'Nastavit ntfy.sh push?' : 'Configure ntfy.sh push?', false)) {
      const topic = await askQuestion(rl, 'Topic name');
      wizard.config.notifications.ntfy = { enabled: true, topic, server: 'https://ntfy.sh' };
    }

    // Step 4: Data directory
    console.log(cs ? '\n📁 Data' : '\n📁 Data');
    const dir = await askQuestion(rl, cs ? 'Složka pro data' : 'Data directory', wizard.config.dataDir);
    wizard.config.dataDir = dir;

    // Step 5: License key (optional)
    console.log(cs ? '\n🔑 Licence (volitelné)' : '\n🔑 License (optional)');
    const licKey = await askQuestion(rl, cs ? 'Licenční klíč (enter = přeskočit)' : 'License key (enter = skip)');
    if (licKey) {
      wizard.config.license.key = licKey;
    }

    // Save
    wizard.complete();
    const envPath = wizard.writeEnvFile(path.join(dataDir, '.env'));

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

    'POST /api/setup/notifications': async (req, res) => {
      const body = await parseBody(req);
      const { channel, config: channelConfig } = body;
      if (!['telegram', 'email', 'ntfy'].includes(channel)) {
        return sendJSON(res, 400, { error: 'Invalid channel' });
      }
      wizard.update('notifications', { [channel]: { enabled: true, ...channelConfig } });
      sendJSON(res, 200, { channel, enabled: true });
    },

    'POST /api/setup/license': async (req, res) => {
      const body = await parseBody(req);
      const { key } = body;
      wizard.config.license.key = key || '';
      sendJSON(res, 200, { hasKey: !!key });
    },

    'POST /api/setup/complete': async (req, res) => {
      wizard.complete();
      wizard.writeEnvFile();
      sendJSON(res, 200, { completed: true });
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
