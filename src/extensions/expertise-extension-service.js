import {
  EXTENSION_KIND,
  canonicalizeExtensionManifestV1,
  satisfiesCoreContract,
} from '../../contracts/m3/extension-v1.js';
import { validateExactKeys } from '../../contracts/m1/shared.js';
import { validateExpertiseConfig } from '../expertises/expertise-store.js';
import { recomputeSharedTerms } from '../expertises/auto-select.js';

export const M3_EXPERTISE_EXTENSION_SCHEMA_VERSION = 1;

const STATUS = Object.freeze({
  ENABLED: 'enabled',
  DISABLED: 'disabled',
});

const DEFINITION_KEYS = Object.freeze([
  'name',
  'description',
  'domain',
  'systemPrompt',
  'temperature',
  'tone',
  'modules',
  'styleRules',
  'capabilities',
  'planningDepth',
  'reviewPolicy',
  'dataUsagePolicy',
  'outputBias',
  'strength',
  'weights',
]);

const ENVELOPE_KEYS = Object.freeze([
  'schemaVersion',
  'status',
  'manifest',
  'installedAtMs',
  'updatedAtMs',
]);

const EXPERTISE_ENUMS = Object.freeze({
  planningDepth: new Set(['none', 'light', 'deep']),
  reviewPolicy: new Set(['none', 'self', 'iterative']),
  dataUsagePolicy: new Set(['forbidden', 'evidence', 'controlled']),
  outputBias: new Set(['creative', 'analytical', 'conservative']),
  tone: new Set([
    'professional', 'casual', 'academic', 'empathetic', 'assertive', 'neutral',
    'creative', 'formal', 'technical', 'friendly', 'concise',
  ]),
});

function extensionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function validateDefinition(definition) {
  const errors = validateExactKeys(
    definition,
    ['name', 'description', 'domain', 'systemPrompt', 'temperature', 'modules'],
    DEFINITION_KEYS.filter((key) => ![
      'name', 'description', 'domain', 'systemPrompt', 'temperature', 'modules',
    ].includes(key)),
    'm3-expertise-definition',
  );
  if (!isPlainObject(definition)) return errors;
  const existing = validateExpertiseConfig(definition);
  errors.push(...existing.errors.map((error) => `m3-expertise-definition:${error}`));
  if (typeof definition.description !== 'string') {
    errors.push('m3-expertise-definition:description-must-be-string');
  }
  if (typeof definition.domain !== 'string' || definition.domain.length === 0) {
    errors.push('m3-expertise-definition:domain-must-be-non-empty-string');
  }
  if (typeof definition.systemPrompt !== 'string' || definition.systemPrompt.length === 0) {
    errors.push('m3-expertise-definition:systemPrompt-must-be-non-empty-string');
  }
  if (typeof definition.temperature !== 'number' || !Number.isFinite(definition.temperature)) {
    errors.push('m3-expertise-definition:temperature-must-be-finite-number');
  }
  if (!isPlainObject(definition.modules)) {
    errors.push('m3-expertise-definition:modules-must-be-object');
  }
  if (isPlainObject(definition.styleRules)) {
    errors.push(...validateExactKeys(
      definition.styleRules,
      [],
      ['tone', 'minResponseLength', 'forbiddenPhrases', 'requiredElements', 'toolEnforcement'],
      'm3-expertise-definition.styleRules',
    ));
  } else if (definition.styleRules !== undefined) {
    errors.push('m3-expertise-definition:styleRules-must-be-object');
  }
  if (isPlainObject(definition.weights)) {
    errors.push(...validateExactKeys(
      definition.weights,
      [],
      ['style', 'depth', 'vocabulary', 'caution'],
      'm3-expertise-definition.weights',
    ));
    if (Object.values(definition.weights).some((value) => typeof value !== 'string')) {
      errors.push('m3-expertise-definition:weights-values-must-be-strings');
    }
  } else if (definition.weights !== undefined) {
    errors.push('m3-expertise-definition:weights-must-be-object');
  }
  for (const [key, allowed] of Object.entries(EXPERTISE_ENUMS)) {
    if (definition[key] !== undefined && !allowed.has(definition[key])) {
      errors.push(`m3-expertise-definition:invalid-${key}`);
    }
  }
  if (
    definition.strength !== undefined
    && ![0, 25, 50, 75, 100].includes(definition.strength)
  ) errors.push('m3-expertise-definition:invalid-strength');
  return errors;
}

function toExpertiseConfig(manifest) {
  return Object.freeze({
    ...structuredClone(manifest.payload.definition),
    id: manifest.id,
    isCustom: true,
  });
}

function parseEnvelope(row) {
  if (!row || row.is_builtin !== 0) return null;
  let config;
  try {
    config = JSON.parse(row.config);
  } catch {
    return null;
  }
  const envelope = config?.m3Extension;
  if (!isPlainObject(envelope)) return null;
  const keys = Object.keys(envelope).sort();
  if (keys.length !== ENVELOPE_KEYS.length
    || !ENVELOPE_KEYS.every((key) => keys.includes(key))) return null;
  if (envelope.schemaVersion !== M3_EXPERTISE_EXTENSION_SCHEMA_VERSION) return null;
  if (!Object.values(STATUS).includes(envelope.status)) return null;
  if (!Number.isSafeInteger(envelope.installedAtMs) || envelope.installedAtMs < 0) return null;
  if (!Number.isSafeInteger(envelope.updatedAtMs) || envelope.updatedAtMs < envelope.installedAtMs) {
    return null;
  }
  try {
    const manifest = canonicalizeExtensionManifestV1(
      envelope.manifest,
      EXTENSION_KIND.EXPERTISE,
    );
    if (manifest.id !== row.id) return null;
    if (validateDefinition(manifest.payload.definition).length > 0) return null;
    return Object.freeze({
      schemaVersion: envelope.schemaVersion,
      status: envelope.status,
      manifest,
      installedAtMs: envelope.installedAtMs,
      updatedAtMs: envelope.updatedAtMs,
    });
  } catch {
    return null;
  }
}

function storedConfig(envelope) {
  return JSON.stringify({ m3Extension: envelope });
}

export class ExpertiseExtensionService {
  constructor({ db, expertiseRegistry, coreVersion, nowMs = () => Date.now() }) {
    if (!db?.prepare || !db?.transaction) throw new TypeError('expertise-extension:db-required');
    if (!expertiseRegistry?.addCustom || !expertiseRegistry?.removeCustom) {
      throw new TypeError('expertise-extension:registry-required');
    }
    if (typeof coreVersion !== 'string') throw new TypeError('expertise-extension:coreVersion-required');
    this.db = db;
    this.expertiseRegistry = expertiseRegistry;
    this.coreVersion = coreVersion;
    this.nowMs = nowMs;
    this._prepareStatements();
  }

  _prepareStatements() {
    this.statements = {
      get: this.db.prepare(`
        SELECT id, name, description, domain, system_prompt, temperature, config, is_builtin
        FROM expertises WHERE id = ?
      `),
      list: this.db.prepare(`
        SELECT id, name, description, domain, system_prompt, temperature, config, is_builtin
        FROM expertises WHERE is_builtin = 0 ORDER BY id
      `),
      insert: this.db.prepare(`
        INSERT INTO expertises (
          id, name, description, domain, system_prompt, temperature, config, is_builtin,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))
      `),
      updateConfig: this.db.prepare(`
        UPDATE expertises SET config = ?, updated_at = datetime('now') WHERE id = ? AND is_builtin = 0
      `),
      remove: this.db.prepare('DELETE FROM expertises WHERE id = ? AND is_builtin = 0'),
      tableExists: this.db.prepare(`
        SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?
      `),
    };
  }

  _now(previous = 0) {
    const now = this.nowMs();
    if (!Number.isSafeInteger(now) || now < previous) {
      throw new TypeError('expertise-extension:invalid-clock');
    }
    return now;
  }

  _canonicalManifest(value) {
    let manifest;
    try {
      manifest = canonicalizeExtensionManifestV1(value, EXTENSION_KIND.EXPERTISE);
    } catch (error) {
      throw extensionError('M3_EXPERTISE_MANIFEST_INVALID', error.message);
    }
    if (!satisfiesCoreContract(manifest.coreContract, this.coreVersion)) {
      throw extensionError(
        'M3_EXPERTISE_CORE_INCOMPATIBLE',
        `Expertise ${manifest.id} requires ${manifest.coreContract}; core is ${this.coreVersion}`,
      );
    }
    if (manifest.requiredCapabilities.length > 0 || manifest.optionalCapabilities.length > 0) {
      throw extensionError(
        'M3_EXPERTISE_CAPABILITY_AUTHORITY_FORBIDDEN',
        'Expertise extensions are data-only and cannot request host capabilities',
      );
    }
    const definitionErrors = validateDefinition(manifest.payload.definition);
    if (definitionErrors.length > 0) {
      throw extensionError('M3_EXPERTISE_DEFINITION_INVALID', definitionErrors.join(', '));
    }
    return manifest;
  }

  _register(manifest) {
    const current = this.expertiseRegistry.get?.(manifest.id) || null;
    if (current && !current.isCustom) {
      throw extensionError(
        'M3_EXPERTISE_BUILTIN_CONFLICT',
        `Expertise ID is owned by core: ${manifest.id}`,
      );
    }
    this.expertiseRegistry.addCustom(toExpertiseConfig(manifest));
    try {
      recomputeSharedTerms();
    } catch (error) {
      this.expertiseRegistry.removeCustom(manifest.id);
      throw error;
    }
  }

  _unregister(id) {
    const existing = this.expertiseRegistry.get?.(id) || null;
    this.expertiseRegistry.removeCustom(id);
    try {
      recomputeSharedTerms();
    } catch (error) {
      if (existing?.isCustom) {
        this.expertiseRegistry.addCustom(
          typeof existing.toJSON === 'function' ? existing.toJSON() : existing,
        );
      }
      throw error;
    }
  }

  boot() {
    const loaded = [];
    const quarantined = [];
    for (const row of this.statements.list.all()) {
      const envelope = parseEnvelope(row);
      if (!envelope) continue;
      if (envelope.status !== STATUS.ENABLED) continue;
      try {
        this._canonicalManifest(envelope.manifest);
        this._register(envelope.manifest);
        loaded.push(envelope.manifest.id);
      } catch (error) {
        this._unregister(row.id);
        quarantined.push({ id: row.id, errorCode: error.code || 'M3_EXPERTISE_BOOT_FAILED' });
      }
    }
    return Object.freeze({ loaded: Object.freeze(loaded), quarantined: Object.freeze(quarantined) });
  }

  install(value) {
    const manifest = this._canonicalManifest(value);
    if (this.expertiseRegistry.get?.(manifest.id)) {
      throw extensionError('M3_EXPERTISE_ID_CONFLICT', `Expertise already registered: ${manifest.id}`);
    }
    const existing = this.statements.get.get(manifest.id);
    if (existing) {
      const existingEnvelope = parseEnvelope(existing);
      if (!existingEnvelope) {
        throw extensionError('M3_EXPERTISE_ID_CONFLICT', `Expertise ID already persisted: ${manifest.id}`);
      }
      throw extensionError('M3_EXPERTISE_ALREADY_INSTALLED', `Expertise already installed: ${manifest.id}`);
    }

    const now = this._now();
    const status = manifest.payload.enabledByDefault ? STATUS.ENABLED : STATUS.DISABLED;
    const envelope = {
      schemaVersion: M3_EXPERTISE_EXTENSION_SCHEMA_VERSION,
      status,
      manifest,
      installedAtMs: now,
      updatedAtMs: now,
    };
    const definition = manifest.payload.definition;
    this.statements.insert.run(
      manifest.id,
      definition.name,
      definition.description,
      definition.domain,
      definition.systemPrompt,
      definition.temperature,
      storedConfig(envelope),
    );
    try {
      if (status === STATUS.ENABLED) this._register(manifest);
    } catch (error) {
      this.statements.remove.run(manifest.id);
      throw error;
    }
    return this.get(manifest.id);
  }

  get(id) {
    const envelope = parseEnvelope(this.statements.get.get(id));
    if (!envelope) return null;
    return Object.freeze({
      id: envelope.manifest.id,
      kind: envelope.manifest.kind,
      moduleVersion: envelope.manifest.moduleVersion,
      status: envelope.status,
      installedAtMs: envelope.installedAtMs,
      updatedAtMs: envelope.updatedAtMs,
      manifest: envelope.manifest,
    });
  }

  list() {
    return Object.freeze(this.statements.list.all()
      .map((row) => this.get(row.id))
      .filter(Boolean));
  }

  enable(id) {
    const row = this.statements.get.get(id);
    const envelope = parseEnvelope(row);
    if (!envelope) throw extensionError('M3_EXPERTISE_NOT_FOUND', `Expertise not found: ${id}`);
    if (envelope.status === STATUS.ENABLED) return this.get(id);
    const manifest = this._canonicalManifest(envelope.manifest);
    this._register(manifest);
    const updated = {
      ...envelope,
      status: STATUS.ENABLED,
      updatedAtMs: this._now(envelope.updatedAtMs),
    };
    try {
      this.statements.updateConfig.run(storedConfig(updated), id);
    } catch (error) {
      this._unregister(id);
      throw error;
    }
    return this.get(id);
  }

  disable(id) {
    const row = this.statements.get.get(id);
    const envelope = parseEnvelope(row);
    if (!envelope) throw extensionError('M3_EXPERTISE_NOT_FOUND', `Expertise not found: ${id}`);
    if (envelope.status === STATUS.DISABLED) return this.get(id);
    this._unregister(id);
    const updated = {
      ...envelope,
      status: STATUS.DISABLED,
      updatedAtMs: this._now(envelope.updatedAtMs),
    };
    try {
      this.statements.updateConfig.run(storedConfig(updated), id);
    } catch (error) {
      this._register(envelope.manifest);
      throw error;
    }
    return this.get(id);
  }

  remove(id) {
    const row = this.statements.get.get(id);
    const envelope = parseEnvelope(row);
    if (!envelope) throw extensionError('M3_EXPERTISE_NOT_FOUND', `Expertise not found: ${id}`);
    const wasEnabled = envelope.status === STATUS.ENABLED;
    if (wasEnabled) this._unregister(id);
    const removeTransaction = this.db.transaction(() => {
      for (const table of ['expertise_bindings', 'conversation_expertises', 'specialist_expertises']) {
        if (!this.statements.tableExists.get(table)) continue;
        this.db.prepare(`DELETE FROM ${table} WHERE expertise_id = ?`).run(id);
      }
      if (this.statements.tableExists.get('custom_expertises')) {
        this.db.prepare('DELETE FROM custom_expertises WHERE id = ?').run(id);
      }
      const result = this.statements.remove.run(id);
      if (result.changes !== 1) throw new Error(`expertise-extension:remove-race:${id}`);
    });
    try {
      removeTransaction();
    } catch (error) {
      if (wasEnabled) this._register(envelope.manifest);
      throw error;
    }
    return Object.freeze({ id, removed: true });
  }
}

export default { ExpertiseExtensionService };
