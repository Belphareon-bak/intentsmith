// Model Universe Store — factual metadata reconciliation and raw signals
// ══════════════════════════════════════════════════════════════════════════════

import { createHash, randomUUID } from 'node:crypto';
import { parseModelName } from './model-profiles.js';

const IDEMPOTENCY_TTL_MS = parseInt(
  process.env.C3_MODEL_UNIVERSE_IDEMPOTENCY_TTL_MS || String(24 * 60 * 60 * 1000),
  10
);
const IDEMPOTENCY_BUCKET_MS = parseInt(
  process.env.C3_MODEL_UNIVERSE_IDEMPOTENCY_BUCKET_MS || '60000',
  10
);
const RECONCILE_DELAY_MS = parseInt(process.env.C3_MODEL_UNIVERSE_RECONCILE_DELAY_MS || '1000', 10);

function asPositiveInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function asRatio(value, fallback) {
  const n = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : fallback;
}

const SIGNAL_FLUSH_INTERVAL_MS = asPositiveInt(process.env.C3_MODEL_SIGNAL_FLUSH_INTERVAL_MS, 10000);
const SIGNAL_BATCH_SIZE = asPositiveInt(process.env.C3_MODEL_SIGNAL_BATCH_SIZE, 100);
const SIGNAL_BUFFER_MAX = asPositiveInt(process.env.C3_MODEL_SIGNAL_BUFFER_MAX, 2000);
const SIGNAL_BASE_SAMPLE_RATE = asPositiveInt(process.env.C3_MODEL_SIGNAL_SAMPLE_RATE, 1);
const SIGNAL_PRESSURE_SAMPLE_RATE = asPositiveInt(process.env.C3_MODEL_SIGNAL_PRESSURE_SAMPLE_RATE, 10);
const SIGNAL_HIGH_WATERMARK_RATIO = asRatio(process.env.C3_MODEL_SIGNAL_HIGH_WATERMARK_RATIO, 0.8);
const FEATURE_UNIVERSE_ENABLED = (process.env.C3_MODEL_UNIVERSE_ENABLED || 'true') !== 'false';
const FEATURE_MIRROR_DISCOVERED = (process.env.C3_DISCOVERY_MIRROR_DISCOVERED_MODELS || 'true') !== 'false';

const METADATA_STATES = new Set(['STABLE', 'PARTIAL', 'UNSTABLE']);

const SOURCE_PRIORITY = Object.freeze({
  runtime: 1.0,
  validation: 0.98,
  benchmark: 0.90,
  registry: 0.75,
  heuristic: 0.55,
  fallback: 0.45,
  reconciled: 0.40,
  unknown: 0.35,
});

const FIELD_SPECS = [
  { field: 'parameters', label: 'parameters' },
  { field: 'context_length', label: 'context_length' },
  { field: 'quantization', label: 'quantization' },
  { field: 'modality', label: 'modality' },
];

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function toIso(ts) {
  if (!ts) return new Date().toISOString();
  return typeof ts === 'string' ? ts : new Date(ts).toISOString();
}

function safeJson(value) {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function safeJsonParse(value) {
  if (!value || typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeName(name) {
  return String(name || '').trim().toLowerCase();
}

function canonicalModelName(name) {
  return normalizeName(name).replace(/:latest$/, '');
}

function normalizeTag(modelName, tag) {
  if (tag) return String(tag).trim().toLowerCase();
  const n = String(modelName || '').trim().toLowerCase();
  const i = n.indexOf(':');
  return i >= 0 ? n.slice(i + 1) : '';
}

function normalizeState(state) {
  const s = String(state || 'PARTIAL').trim().toUpperCase();
  return METADATA_STATES.has(s) ? s : 'PARTIAL';
}

function normalizeSource(source) {
  const s = String(source || '').trim().toLowerCase();
  if (!s) return 'unknown';
  if (s === 'local' || s === 'runtime' || s === 'show' || s === 'universe') return 'runtime';
  if (s === 'validation' || s === 'validated') return 'validation';
  if (s === 'benchmark' || s === 'whatllm') return 'benchmark';
  if (s === 'registry' || s === 'catalog') return 'registry';
  if (s === 'l4' || s === 'discovered' || s === 'heuristic') return 'heuristic';
  if (s === 'fallback') return 'fallback';
  if (s === 'reconciled') return 'reconciled';
  return s;
}

function sourcePriority(source) {
  return SOURCE_PRIORITY[normalizeSource(source)] ?? SOURCE_PRIORITY.unknown;
}

function parseNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (!v) return null;
  const m = v.match(/(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const num = parseFloat(m[1]);
  return Number.isFinite(num) ? num : null;
}

function normalizeContextLength(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value);
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (!v) return null;
  const mk = v.match(/^(\d+(?:\.\d+)?)\s*k$/i);
  if (mk) return Math.round(parseFloat(mk[1]) * 1024);
  const m = v.match(/^(\d+(?:\.\d+)?)$/);
  if (m) return Math.round(parseFloat(m[1]));
  return null;
}

function normalizeQuantization(value) {
  if (!value) return null;
  let q = String(value).trim();
  if (!q) return null;
  q = q.replace(/\s+/g, '').replace(/-/g, '_').toUpperCase();
  if (!/^Q\d/.test(q)) {
    const m = q.match(/(Q\d[_A-Z0-9]*)/);
    q = m ? m[1] : q;
  }
  return q || null;
}

function normalizeModality(value) {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  if (!v) return null;
  if (v.includes('vision') || v.includes('image') || v.includes('vl')) return 'vision';
  if (v.includes('audio') || v.includes('speech')) return 'audio';
  if (v.includes('video')) return 'video';
  if (v.includes('text') || v.includes('chat') || v.includes('reason')) return 'text';
  return v;
}

export function normalizeFieldValue(field, value) {
  switch (field) {
    case 'parameters': {
      const num = parseNumber(value);
      return num != null && num > 0 ? num : null;
    }
    case 'context_length':
      return normalizeContextLength(value);
    case 'quantization':
      return normalizeQuantization(value);
    case 'modality':
      return normalizeModality(value);
    default:
      return value == null ? null : value;
  }
}

function valuesEqualNormalized(field, a, b) {
  const na = normalizeFieldValue(field, a);
  const nb = normalizeFieldValue(field, b);
  if (na == null && nb == null) return true;
  if (na == null || nb == null) return false;
  return na === nb;
}

function extractValidationContextFromMeta(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const candidates = [
    meta?.validation?.max_context_length,
    meta?.validation?.context_length,
    meta?.validation_context_length,
    meta?.max_context_length_validated,
    meta?.verified_context_length,
  ];
  for (const c of candidates) {
    const n = normalizeContextLength(c);
    if (n != null && n > 0) return n;
  }
  return null;
}

function computeRecencyFactor(ts) {
  if (!ts) return 0.45;
  const ageMs = Math.max(0, Date.now() - Date.parse(ts));
  const ageDays = ageMs / 86400000;
  return Math.max(0.30, Math.exp(-ageDays / 45));
}

function computeRowConfidence(row) {
  const baseByState = {
    STABLE: 0.85,
    PARTIAL: 0.55,
    UNSTABLE: 0.35,
  };
  let confidence = baseByState[normalizeState(row.metadata_state)] ?? 0.5;

  const meta = safeJsonParse(row.metadata_json);
  const metaConf = parseNumber(
    meta?.confidence
      ?? meta?.source_confidence
      ?? meta?.quality?.confidence
      ?? null
  );
  if (metaConf != null) {
    confidence = (confidence * 0.6) + (clamp01(metaConf) * 0.4);
  }

  const recency = computeRecencyFactor(row.last_verified_at || row.updated_at);
  return clamp01(confidence * recency);
}

function collectValidationContextCap(rows) {
  const caps = [];
  for (const row of rows) {
    if (normalizeSource(row.source) === 'validation') {
      const c = normalizeContextLength(row.context_length);
      if (c != null && c > 0) caps.push(c);
    }
    const fromMeta = extractValidationContextFromMeta(safeJsonParse(row.metadata_json));
    if (fromMeta != null && fromMeta > 0) caps.push(fromMeta);
  }
  if (caps.length === 0) return null;
  return Math.min(...caps);
}

function isRowNewer(a, b) {
  const aTs = Date.parse(a?.updated_at || a?.last_verified_at || 0) || 0;
  const bTs = Date.parse(b?.updated_at || b?.last_verified_at || 0) || 0;
  if (aTs !== bTs) return aTs > bTs;
  return (a?.id || 0) > (b?.id || 0);
}

function coalesceRowsByCanonicalSource(rows) {
  const bySource = new Map();
  for (const row of rows || []) {
    const source = normalizeSource(row?.source);
    const current = bySource.get(source);
    if (!current || isRowNewer(row, current)) {
      bySource.set(source, { ...row, source });
    }
  }
  return [...bySource.values()];
}

function hashObject(value) {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex');
}

export function resolveFieldValue(field, rows, opts = {}) {
  const validationContextCap = normalizeContextLength(opts.validationContextCap);
  const candidates = [];

  for (const row of rows) {
    const value = normalizeFieldValue(field, row[field]);
    if (value == null) continue;

    const source = normalizeSource(row.source);
    let confidence = computeRowConfidence(row);
    let effectivePriority = sourcePriority(source) * confidence;
    let reasonCode = 'higher_effective_priority';

    // If validation data contradicts registry context claims, down-weight registry.
    if (field === 'context_length' && validationContextCap != null && source === 'registry' && value > validationContextCap) {
      effectivePriority *= 0.2;
      confidence *= 0.5;
      reasonCode = 'validation_conflict_penalty';
    }

    candidates.push({
      rowId: row.id,
      source,
      value,
      confidence: clamp01(confidence),
      effectivePriority,
      updatedAt: Date.parse(row.updated_at || row.last_verified_at || 0) || 0,
      reasonCode,
    });
  }

  if (candidates.length === 0) {
    return {
      field,
      value: null,
      source: 'unknown',
      confidence: 0,
      effectivePriority: 0,
      reasonCode: 'missing',
      candidateCount: 0,
      agreement: 0,
      candidates: [],
    };
  }

  candidates.sort((a, b) => {
    if (b.effectivePriority !== a.effectivePriority) return b.effectivePriority - a.effectivePriority;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
    return b.rowId - a.rowId;
  });

  const winner = candidates[0];
  const sameValueCount = candidates.filter(c => valuesEqualNormalized(field, c.value, winner.value)).length;
  const agreement = sameValueCount / candidates.length;
  let reasonCode = winner.reasonCode;
  if (candidates.length === 1) reasonCode = 'single_source';
  else if (agreement >= 0.999) reasonCode = 'consensus';

  return {
    field,
    value: winner.value,
    source: winner.source,
    confidence: winner.confidence,
    effectivePriority: winner.effectivePriority,
    reasonCode,
    candidateCount: candidates.length,
    agreement,
    candidates,
  };
}

function computeDerivedState(modelName, tag, resolvedRaw, rows, resolutions) {
  const agreements = FIELD_SPECS
    .map(spec => resolutions[spec.field]?.agreement)
    .filter(v => Number.isFinite(v));
  const agreement = agreements.length > 0
    ? agreements.reduce((a, b) => a + b, 0) / agreements.length
    : 0.5;

  const newestTs = rows
    .map(r => Date.parse(r.last_verified_at || r.updated_at || 0) || 0)
    .reduce((m, t) => Math.max(m, t), 0);
  const recency = newestTs > 0 ? computeRecencyFactor(new Date(newestTs).toISOString()) : 0.45;
  const dataVolume = clamp01(rows.length / 5);

  const conflictCount = FIELD_SPECS
    .map(spec => resolutions[spec.field])
    .filter(r => r && r.candidateCount > 1 && r.agreement < 0.999)
    .length;
  const contradictionPenalty = Object.values(resolutions)
    .some(r => r?.reasonCode === 'validation_conflict_penalty')
    ? 0.10
    : 0;
  const conflictPenalty = Math.max(0.35, 1 - Math.min(0.55, conflictCount * 0.12 + contradictionPenalty));

  const confidence = clamp01(
    (dataVolume * 0.35 + agreement * 0.40 + recency * 0.25) * conflictPenalty
  );
  const confidenceState = confidence >= 0.75 ? 'HIGH' : confidence >= 0.45 ? 'MEDIUM' : 'LOW';

  const params = normalizeFieldValue('parameters', resolvedRaw.parameters);
  const contextLength = normalizeFieldValue('context_length', resolvedRaw.context_length);
  const quantization = normalizeFieldValue('quantization', resolvedRaw.quantization);
  const modality = normalizeFieldValue('modality', resolvedRaw.modality) || 'text';

  const rawFingerprint = rows.map(r => ({
    source: normalizeSource(r.source),
    metadata_state: normalizeState(r.metadata_state),
    parameters: normalizeFieldValue('parameters', r.parameters),
    context_length: normalizeFieldValue('context_length', r.context_length),
    quantization: normalizeFieldValue('quantization', r.quantization),
    modality: normalizeFieldValue('modality', r.modality),
    updated_at: r.updated_at || null,
    last_verified_at: r.last_verified_at || null,
  }));
  rawFingerprint.sort((a, b) => {
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    return String(a.updated_at || '').localeCompare(String(b.updated_at || ''));
  });

  const basedOnVersion = hashObject({
    model_name: modelName,
    tag,
    raw: rawFingerprint,
    resolved: {
      parameters: params,
      context_length: contextLength,
      quantization,
      modality,
    },
  });

  const capabilityVector = {
    parameters: params,
    context_length: contextLength,
    quantization,
    modality,
    sources: Object.fromEntries(
      FIELD_SPECS.map(spec => [spec.field, resolutions[spec.field]?.source || null])
    ),
    agreement: Object.fromEntries(
      FIELD_SPECS.map(spec => [spec.field, resolutions[spec.field]?.agreement ?? 0])
    ),
    conflict_count: conflictCount,
    row_count: rows.length,
  };

  return {
    confidence,
    confidenceState,
    capabilityVector,
    basedOnVersion,
    lastComputedAt: new Date().toISOString(),
  };
}

/**
 * Deterministic idempotency key for short replay windows.
 */
export function makeIdempotencyKey(modelName, tag = '', source = 'local', bucketMs = IDEMPOTENCY_BUCKET_MS) {
  const model = normalizeName(modelName);
  const t = normalizeTag(model, tag);
  const bucket = Math.floor(Date.now() / bucketMs) * bucketMs;
  return createHash('sha1').update(`${model}|${t}|${source}|${bucket}`).digest('hex');
}

class ModelUniverseStore {
  constructor() {
    this._db = null;
    this._stmts = null;
    this._discoveredStmt = null;
    this._derivedHasBasedOnVersion = false;
    this._derivedHasLastComputedAt = false;
    this._reconHasReasonCode = false;
    this._reconHasEffectivePriority = false;
    this._recomputeQueue = new Map(); // key -> { timer, reasonCode }
    this._signalBuffer = [];
    this._signalFlushTimer = null;
    this._signalSampleCounter = 0;
    this._signalStats = {
      received: 0,
      sampledOut: 0,
      dropped: 0,
      flushed: 0,
      inserted: 0,
      batches: 0,
      flushErrors: 0,
      bufferPeak: 0,
      lastFlushAt: null,
      lastFlushReason: null,
    };
    this._defaultSignalConfig = {
      flushIntervalMs: SIGNAL_FLUSH_INTERVAL_MS,
      batchSize: SIGNAL_BATCH_SIZE,
      bufferMax: SIGNAL_BUFFER_MAX,
      baseSampleRate: SIGNAL_BASE_SAMPLE_RATE,
      pressureSampleRate: SIGNAL_PRESSURE_SAMPLE_RATE,
      highWatermarkRatio: SIGNAL_HIGH_WATERMARK_RATIO,
    };
    this._signalConfig = { ...this._defaultSignalConfig };
  }

  setDb(db) {
    for (const task of this._recomputeQueue.values()) {
      clearTimeout(task.timer);
    }
    this._recomputeQueue.clear();
    this._clearSignalFlushTimer();
    this._signalBuffer = [];
    this._signalSampleCounter = 0;
    this._signalStats = {
      received: 0,
      sampledOut: 0,
      dropped: 0,
      flushed: 0,
      inserted: 0,
      batches: 0,
      flushErrors: 0,
      bufferPeak: 0,
      lastFlushAt: null,
      lastFlushReason: null,
    };
    this._signalConfig = { ...this._defaultSignalConfig };

    this._db = db;
    this._stmts = null;
    this._discoveredStmt = null;
    this._derivedHasBasedOnVersion = false;
    this._derivedHasLastComputedAt = false;
    this._reconHasReasonCode = false;
    this._reconHasEffectivePriority = false;
  }

  _clearSignalFlushTimer() {
    if (this._signalFlushTimer) {
      clearTimeout(this._signalFlushTimer);
      this._signalFlushTimer = null;
    }
  }

  setSignalIngestConfig(overrides = {}) {
    const next = { ...this._signalConfig };
    if (overrides.flushIntervalMs != null) next.flushIntervalMs = asPositiveInt(overrides.flushIntervalMs, next.flushIntervalMs);
    if (overrides.batchSize != null) next.batchSize = asPositiveInt(overrides.batchSize, next.batchSize);
    if (overrides.bufferMax != null) next.bufferMax = asPositiveInt(overrides.bufferMax, next.bufferMax);
    if (overrides.baseSampleRate != null) next.baseSampleRate = asPositiveInt(overrides.baseSampleRate, next.baseSampleRate);
    if (overrides.pressureSampleRate != null) next.pressureSampleRate = asPositiveInt(overrides.pressureSampleRate, next.pressureSampleRate);
    if (overrides.highWatermarkRatio != null) next.highWatermarkRatio = asRatio(overrides.highWatermarkRatio, next.highWatermarkRatio);
    this._signalConfig = next;
    return this.getSignalStats();
  }

  resetSignalIngestConfig() {
    this._signalConfig = { ...this._defaultSignalConfig };
    return this.getSignalStats();
  }

  _signalHighWatermark() {
    const limit = Math.max(1, this._signalConfig.bufferMax);
    const ratio = asRatio(this._signalConfig.highWatermarkRatio, 0.8);
    return Math.max(1, Math.floor(limit * ratio));
  }

  _currentSignalSampleRate() {
    const pressureRate = Math.max(1, this._signalConfig.pressureSampleRate);
    const baseRate = Math.max(1, this._signalConfig.baseSampleRate);
    return this._signalBuffer.length >= this._signalHighWatermark()
      ? Math.max(baseRate, pressureRate)
      : baseRate;
  }

  _shouldKeepSignalEvent(sampleRate) {
    const rate = Math.max(1, sampleRate || 1);
    if (rate <= 1) return true;
    this._signalSampleCounter += 1;
    return (this._signalSampleCounter % rate) === 0;
  }

  _scheduleSignalFlush() {
    if (this._signalFlushTimer) return;
    const delay = Math.max(1, this._signalConfig.flushIntervalMs);
    this._signalFlushTimer = setTimeout(() => {
      this._signalFlushTimer = null;
      this.flushSignalBuffer({ reason: 'interval' });
    }, delay);
    this._signalFlushTimer.unref?.();
  }

  _signalRowFromEvent(event = {}) {
    const modelName = canonicalModelName(event.modelName || event.model);
    if (!modelName) throw new Error('recordSignalEvent: missing modelName');
    return {
      modelName,
      tag: normalizeTag(modelName, event.tag),
      role: event.role || null,
      signalType: event.signalType || event.type || 'runtime',
      success: event.success == null ? null : (event.success ? 1 : 0),
      latencyMs: event.latencyMs ?? null,
      errorType: event.errorType ?? null,
      payloadJson: safeJson(event.payload),
      scheduleRecompute: event.scheduleRecompute !== false,
      recomputeDelayMs: event.delayMs ?? RECONCILE_DELAY_MS,
      sampleRate: asPositiveInt(event.sampleRate, this._currentSignalSampleRate()),
    };
  }

  _runInsertSignalBatch(rows = []) {
    if (rows.length === 0) return { ok: true, inserted: 0 };
    this._ensureUniverseStatements();
    const tx = this._db.transaction((batchRows) => {
      for (const row of batchRows) {
        this._stmts.insertSignalEvent.run(
          row.modelName,
          row.role,
          row.signalType,
          row.success,
          row.latencyMs,
          row.errorType,
          row.payloadJson
        );
      }
      return batchRows.length;
    });
    const inserted = tx(rows);
    return { ok: true, inserted };
  }

  flushSignalBuffer(opts = {}) {
    this._clearSignalFlushTimer();
    if (!FEATURE_UNIVERSE_ENABLED) return { ok: false, disabled: true, reason: 'feature_disabled' };
    this._ensureUniverseStatements();

    const reason = opts.reason || 'manual';
    const drain = opts.drain === true;
    const chunkSize = drain
      ? Number.MAX_SAFE_INTEGER
      : Math.max(1, asPositiveInt(opts.maxBatchSize, this._signalConfig.batchSize));

    let insertedTotal = 0;
    let batches = 0;
    try {
      while (this._signalBuffer.length > 0) {
        const rows = this._signalBuffer.splice(0, chunkSize);
        if (rows.length === 0) break;
        const result = this._runInsertSignalBatch(rows);
        insertedTotal += result.inserted;
        batches += 1;
        if (!drain) break;
      }
    } catch (err) {
      this._signalStats.flushErrors += 1;
      if (this._signalBuffer.length > 0 && !this._signalFlushTimer) this._scheduleSignalFlush();
      return { ok: false, error: err.message, inserted: insertedTotal, batches };
    }

    this._signalStats.flushed += insertedTotal;
    this._signalStats.inserted += insertedTotal;
    this._signalStats.batches += batches;
    this._signalStats.lastFlushAt = new Date().toISOString();
    this._signalStats.lastFlushReason = reason;
    if (this._signalBuffer.length > 0 && !this._signalFlushTimer) this._scheduleSignalFlush();

    return {
      ok: true,
      inserted: insertedTotal,
      batches,
      remaining: this._signalBuffer.length,
      reason,
    };
  }

  getSignalStats() {
    return {
      ...this._signalStats,
      bufferLength: this._signalBuffer.length,
      sampleRate: this._currentSignalSampleRate(),
      config: {
        ...this._signalConfig,
        highWatermark: this._signalHighWatermark(),
      },
    };
  }

  _ensureDb() {
    if (!this._db) throw new Error('ModelUniverseStore DB not initialized');
  }

  _ensureUniverseStatements() {
    this._ensureDb();
    if (this._stmts) return;

    try {
      const derivedCols = this._db.prepare(`PRAGMA table_info('model_universe_derived')`).all();
      this._derivedHasBasedOnVersion = derivedCols.some(c => c.name === 'based_on_version');
      this._derivedHasLastComputedAt = derivedCols.some(c => c.name === 'last_computed_at');
    } catch (_) {
      this._derivedHasBasedOnVersion = false;
      this._derivedHasLastComputedAt = false;
    }

    try {
      const reconCols = this._db.prepare(`PRAGMA table_info('model_reconciliation_log')`).all();
      this._reconHasReasonCode = reconCols.some(c => c.name === 'reason_code');
      this._reconHasEffectivePriority = reconCols.some(c => c.name === 'effective_priority');
    } catch (_) {
      this._reconHasReasonCode = false;
      this._reconHasEffectivePriority = false;
    }

    const derivedColumns = [
      'model_name',
      'tag',
      'confidence',
      'confidence_state',
      'capability_vector_json',
      'recompute_at',
    ];
    if (this._derivedHasBasedOnVersion) derivedColumns.push('based_on_version');
    if (this._derivedHasLastComputedAt) derivedColumns.push('last_computed_at');

    const derivedUpdate = [
      'confidence = COALESCE(excluded.confidence, model_universe_derived.confidence)',
      'confidence_state = COALESCE(excluded.confidence_state, model_universe_derived.confidence_state)',
      'capability_vector_json = COALESCE(excluded.capability_vector_json, model_universe_derived.capability_vector_json)',
      'recompute_at = COALESCE(excluded.recompute_at, model_universe_derived.recompute_at)',
    ];
    if (this._derivedHasBasedOnVersion) {
      derivedUpdate.push('based_on_version = COALESCE(excluded.based_on_version, model_universe_derived.based_on_version)');
    }
    if (this._derivedHasLastComputedAt) {
      derivedUpdate.push('last_computed_at = COALESCE(excluded.last_computed_at, model_universe_derived.last_computed_at)');
    }

    const upsertDerivedSql = `
      INSERT INTO model_universe_derived (
        ${derivedColumns.join(', ')},
        updated_at
      ) VALUES (
        ${derivedColumns.map(() => '?').join(', ')},
        CURRENT_TIMESTAMP
      )
      ON CONFLICT(model_name, tag) DO UPDATE SET
        ${derivedUpdate.join(',\n        ')},
        updated_at = CURRENT_TIMESTAMP
    `;

    const reconColumns = [
      'model_name',
      'tag',
      'field',
      'old_value',
      'new_value',
      'source',
      'confidence',
    ];
    if (this._reconHasReasonCode) reconColumns.push('reason_code');
    if (this._reconHasEffectivePriority) reconColumns.push('effective_priority');

    const insertReconSql = `
      INSERT INTO model_reconciliation_log (
        ${reconColumns.join(', ')}
      ) VALUES (
        ${reconColumns.map(() => '?').join(', ')}
      )
    `;

    this._stmts = {
      findRawByIdempotency: this._db.prepare(`
        SELECT id, model_name, tag, source
        FROM model_universe_raw
        WHERE idempotency_key = ?
          AND (idempotency_expires_at IS NULL OR idempotency_expires_at > datetime('now'))
        LIMIT 1
      `),
      upsertRaw: this._db.prepare(`
        INSERT INTO model_universe_raw (
          model_name, tag, source, write_source, write_token,
          idempotency_key, idempotency_expires_at, metadata_state,
          parameters, context_length, quantization, modality,
          metadata_json, last_verified_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(model_name, tag, source) DO UPDATE SET
          write_source = excluded.write_source,
          write_token = excluded.write_token,
          idempotency_key = excluded.idempotency_key,
          idempotency_expires_at = excluded.idempotency_expires_at,
          metadata_state = excluded.metadata_state,
          parameters = COALESCE(excluded.parameters, model_universe_raw.parameters),
          context_length = COALESCE(excluded.context_length, model_universe_raw.context_length),
          quantization = COALESCE(excluded.quantization, model_universe_raw.quantization),
          modality = COALESCE(excluded.modality, model_universe_raw.modality),
          metadata_json = COALESCE(excluded.metadata_json, model_universe_raw.metadata_json),
          last_verified_at = COALESCE(excluded.last_verified_at, model_universe_raw.last_verified_at),
          updated_at = CURRENT_TIMESTAMP
      `),
      upsertReconciledRaw: this._db.prepare(`
        INSERT INTO model_universe_raw (
          model_name, tag, source, write_source, write_token,
          idempotency_key, idempotency_expires_at, metadata_state,
          parameters, context_length, quantization, modality,
          metadata_json, last_verified_at, updated_at
        ) VALUES (?, ?, ?, 'reconcile', ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(model_name, tag, source) DO UPDATE SET
          write_source = 'reconcile',
          write_token = excluded.write_token,
          metadata_state = excluded.metadata_state,
          parameters = COALESCE(excluded.parameters, model_universe_raw.parameters),
          context_length = COALESCE(excluded.context_length, model_universe_raw.context_length),
          quantization = COALESCE(excluded.quantization, model_universe_raw.quantization),
          modality = COALESCE(excluded.modality, model_universe_raw.modality),
          metadata_json = COALESCE(excluded.metadata_json, model_universe_raw.metadata_json),
          last_verified_at = COALESCE(excluded.last_verified_at, model_universe_raw.last_verified_at),
          updated_at = CURRENT_TIMESTAMP
      `),
      upsertDerived: this._db.prepare(upsertDerivedSql),
      listRawByModelTag: this._db.prepare(`
        SELECT *
        FROM model_universe_raw
        WHERE model_name = ? AND tag = ? AND source <> 'reconciled'
        ORDER BY updated_at DESC, id DESC
      `),
      getReconciledRaw: this._db.prepare(`
        SELECT *
        FROM model_universe_raw
        WHERE model_name = ? AND tag = ? AND source = 'reconciled'
        LIMIT 1
      `),
      getLatestRawByModel: this._db.prepare(`
        SELECT *
        FROM model_universe_raw
        WHERE model_name = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `),
      getDerivedByModelTag: this._db.prepare(`
        SELECT *
        FROM model_universe_derived
        WHERE model_name = ? AND tag = ?
        LIMIT 1
      `),
      insertReconLog: this._db.prepare(insertReconSql),
      insertSignalEvent: this._db.prepare(`
        INSERT INTO model_signal_events (
          model_name, role, signal_type, success, latency_ms, error_type, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `),
      writeLog: this._db.prepare(`
        INSERT INTO model_write_log (
          model_name, tag, write_token, write_source, status, error
        ) VALUES (?, ?, ?, ?, ?, ?)
      `),
    };
  }

  _ensureDiscoveredStatement() {
    this._ensureDb();
    if (this._discoveredStmt) return;

    const discoveredSql = `
        INSERT INTO discovered_models (
          name, family, params, category, base_vram_mb, context_window,
          capabilities_json, source, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(name) DO UPDATE SET
          family = excluded.family,
          params = COALESCE(excluded.params, discovered_models.params),
          category = COALESCE(excluded.category, discovered_models.category),
          base_vram_mb = COALESCE(excluded.base_vram_mb, discovered_models.base_vram_mb),
          context_window = COALESCE(excluded.context_window, discovered_models.context_window),
          capabilities_json = COALESCE(excluded.capabilities_json, discovered_models.capabilities_json),
          source = COALESCE(excluded.source, discovered_models.source),
          updated_at = CURRENT_TIMESTAMP
      `;
    this._discoveredStmt = this._db.prepare(discoveredSql);
  }

  _writeLog(modelName, tag, writeToken, writeSource, status, errMsg = null) {
    try {
      this._ensureUniverseStatements();
      this._stmts.writeLog.run(
        normalizeName(modelName),
        normalizeTag(modelName, tag),
        writeToken || null,
        writeSource || 'unknown',
        status,
        errMsg ? String(errMsg).slice(0, 500) : null
      );
    } catch (_) {}
  }

  _runUpsertDerived(entry = {}) {
    const modelName = normalizeName(entry.modelName);
    const tag = normalizeTag(modelName, entry.tag);
    const values = [
      modelName,
      tag,
      entry.confidence ?? null,
      entry.confidenceState ?? null,
      safeJson(entry.capabilityVector),
      entry.recomputeAt ? toIso(entry.recomputeAt) : null,
    ];
    if (this._derivedHasBasedOnVersion) values.push(entry.basedOnVersion ?? null);
    if (this._derivedHasLastComputedAt) values.push(entry.lastComputedAt ? toIso(entry.lastComputedAt) : null);
    this._stmts.upsertDerived.run(...values);
  }

  _insertReconciliationLog(entry = {}) {
    const values = [
      normalizeName(entry.modelName),
      normalizeTag(entry.modelName, entry.tag),
      entry.field || '',
      entry.oldValue == null ? null : String(entry.oldValue),
      entry.newValue == null ? null : String(entry.newValue),
      normalizeSource(entry.source || 'unknown'),
      entry.confidence ?? null,
    ];
    if (this._reconHasReasonCode) values.push(entry.reasonCode || null);
    if (this._reconHasEffectivePriority) values.push(entry.effectivePriority ?? null);
    this._stmts.insertReconLog.run(...values);
  }

  upsertRaw(entry = {}) {
    this._ensureUniverseStatements();
    if (!FEATURE_UNIVERSE_ENABLED) {
      return { ok: false, disabled: true, reason: 'feature_disabled' };
    }

    const modelName = normalizeName(entry.modelName);
    if (!modelName) throw new Error('upsertRaw: missing modelName');

    const tag = normalizeTag(modelName, entry.tag);
    const source = normalizeSource(entry.source || 'local');
    const writeSource = String(entry.writeSource || 'universe').trim().toLowerCase();
    const writeToken = entry.writeToken || randomUUID();
    const idempotencyKey = entry.idempotencyKey || makeIdempotencyKey(modelName, tag, source);
    const idempotencyExpiresAt = toIso(entry.idempotencyExpiresAt || Date.now() + IDEMPOTENCY_TTL_MS);
    const metadataState = normalizeState(entry.metadataState);
    const metadataJson = safeJson(entry.metadata);
    const lastVerifiedAt = entry.lastVerifiedAt ? toIso(entry.lastVerifiedAt) : new Date().toISOString();

    // Replay dedupe window: if same key is still valid, return existing row.
    if (idempotencyKey) {
      const existing = this._stmts.findRawByIdempotency.get(idempotencyKey);
      if (existing) {
        this._writeLog(modelName, tag, writeToken, writeSource, 'deduped');
        return { ok: true, deduped: true, writeToken, row: existing };
      }
    }

    this._stmts.upsertRaw.run(
      modelName, tag, source, writeSource, writeToken,
      idempotencyKey, idempotencyExpiresAt, metadataState,
      entry.parameters ?? null,
      entry.contextLength ?? null,
      entry.quantization ?? null,
      entry.modality ?? null,
      metadataJson,
      lastVerifiedAt
    );

    this._writeLog(modelName, tag, writeToken, writeSource, 'ok');
    return { ok: true, deduped: false, writeToken };
  }

  upsertDerived(entry = {}) {
    this._ensureUniverseStatements();
    if (!FEATURE_UNIVERSE_ENABLED) {
      return { ok: false, disabled: true, reason: 'feature_disabled' };
    }

    const modelName = normalizeName(entry.modelName);
    if (!modelName) throw new Error('upsertDerived: missing modelName');
    this._runUpsertDerived(entry);
    return { ok: true };
  }

  mirrorToDiscovered(entry = {}) {
    this._ensureDiscoveredStatement();
    if (!FEATURE_MIRROR_DISCOVERED) {
      return { ok: false, skipped: true, reason: 'mirror_disabled' };
    }

    const modelName = normalizeName(entry.modelName);
    if (!modelName) throw new Error('mirrorToDiscovered: missing modelName');

    const parsed = parseModelName(modelName);
    const family = parsed.family || 'unknown';
    const params = entry.parameters ?? parsed.params ?? null;
    const category = entry.category || parsed.category || 'general';
    const baseVramMb = entry.baseVramMb ?? null;
    const contextWindow = entry.contextLength ?? null;
    const capabilitiesJson = safeJson(entry.capabilities);
    const source = entry.source || 'universe';
    this._discoveredStmt.run(
      modelName, family, params, category, baseVramMb, contextWindow,
      capabilitiesJson, source
    );

    return { ok: true };
  }

  recordSignalEvent(event = {}) {
    this._ensureUniverseStatements();
    if (!FEATURE_UNIVERSE_ENABLED) return { ok: false, disabled: true, reason: 'feature_disabled' };

    const row = this._signalRowFromEvent(event);
    this._signalStats.received += 1;

    const keep = this._shouldKeepSignalEvent(row.sampleRate);
    if (!keep) {
      this._signalStats.sampledOut += 1;
      return { ok: true, sampledOut: true, sampleRate: row.sampleRate };
    }

    const maxBuffer = Math.max(1, this._signalConfig.bufferMax);
    while (this._signalBuffer.length >= maxBuffer) {
      this._signalBuffer.shift();
      this._signalStats.dropped += 1;
    }
    this._signalBuffer.push(row);
    this._signalStats.bufferPeak = Math.max(this._signalStats.bufferPeak, this._signalBuffer.length);

    if (this._signalBuffer.length >= this._signalConfig.batchSize) {
      this.flushSignalBuffer({ reason: 'batch_size', maxBatchSize: this._signalConfig.batchSize });
    } else {
      this._scheduleSignalFlush();
    }

    const shouldSchedule = row.scheduleRecompute;
    if (shouldSchedule) {
      this.scheduleDerivedRecompute(row.modelName, row.tag, {
        delayMs: row.recomputeDelayMs,
        reasonCode: 'signal_update',
      });
    }

    return { ok: true, buffered: true, bufferLength: this._signalBuffer.length, sampleRate: row.sampleRate };
  }

  scheduleDerivedRecompute(modelName, tag = '', opts = {}) {
    if (!FEATURE_UNIVERSE_ENABLED) return { ok: false, disabled: true, reason: 'feature_disabled' };
    this._ensureUniverseStatements();

    const normalizedModel = normalizeName(modelName);
    if (!normalizedModel) return { ok: false, reason: 'missing_model' };
    const normalizedTag = normalizeTag(normalizedModel, tag);
    const key = `${normalizedModel}|${normalizedTag}`;
    if (this._recomputeQueue.has(key)) return { ok: true, queued: false, reason: 'already_scheduled' };

    const delayMs = Number.isFinite(opts.delayMs) ? Math.max(0, Math.floor(opts.delayMs)) : RECONCILE_DELAY_MS;
    const reasonCode = opts.reasonCode || 'scheduled_recompute';

    const timer = setTimeout(() => {
      this._recomputeQueue.delete(key);
      try {
        this.reconcileAndRecompute(normalizedModel, normalizedTag, { reasonCode });
      } catch (err) {
        this._writeLog(normalizedModel, normalizedTag, null, 'reconcile', 'error', err.message);
      }
    }, delayMs);
    timer.unref?.();

    this._recomputeQueue.set(key, { timer, reasonCode, queuedAt: Date.now() });
    return { ok: true, queued: true, key };
  }

  reconcileAndRecompute(modelName, tag = '', opts = {}) {
    this._ensureUniverseStatements();
    if (!FEATURE_UNIVERSE_ENABLED) return { ok: false, disabled: true, reason: 'feature_disabled' };

    const normalizedModel = normalizeName(modelName);
    if (!normalizedModel) throw new Error('reconcileAndRecompute: missing modelName');
    const normalizedTag = normalizeTag(normalizedModel, tag);
    const reasonCode = opts.reasonCode || 'reconcile';
    const writeToken = opts.writeToken || randomUUID();

    const tx = this._db.transaction(() => {
      const allRows = this._stmts.listRawByModelTag.all(normalizedModel, normalizedTag);
      if (!allRows || allRows.length === 0) {
        return { ok: false, reason: 'no_raw_rows', modelName: normalizedModel, tag: normalizedTag };
      }
      const rows = coalesceRowsByCanonicalSource(allRows);

      const validationContextCap = collectValidationContextCap(rows);
      const resolutions = {};
      const resolvedRaw = {};
      for (const spec of FIELD_SPECS) {
        const resolved = resolveFieldValue(spec.field, rows, { validationContextCap });
        resolutions[spec.field] = resolved;
        resolvedRaw[spec.field] = resolved.value;
      }

      const metadataState = (
        resolvedRaw.parameters != null &&
        resolvedRaw.context_length != null &&
        resolvedRaw.quantization != null &&
        resolvedRaw.modality != null
      ) ? 'STABLE' : 'PARTIAL';

      const previous = this._stmts.getReconciledRaw.get(normalizedModel, normalizedTag);
      const metadata = {
        reasonCode,
        reconciledAt: new Date().toISOString(),
        rowCount: allRows.length,
        sourceRowCount: rows.length,
        validationContextCap,
        fields: Object.fromEntries(
          FIELD_SPECS.map(spec => [spec.field, {
            source: resolutions[spec.field].source,
            confidence: resolutions[spec.field].confidence,
            effectivePriority: resolutions[spec.field].effectivePriority,
            reasonCode: resolutions[spec.field].reasonCode,
            candidateCount: resolutions[spec.field].candidateCount,
            agreement: resolutions[spec.field].agreement,
          }])
        ),
      };

      this._stmts.upsertReconciledRaw.run(
        normalizedModel,
        normalizedTag,
        'reconciled',
        writeToken,
        metadataState,
        resolvedRaw.parameters,
        resolvedRaw.context_length,
        resolvedRaw.quantization,
        resolvedRaw.modality,
        safeJson(metadata),
        new Date().toISOString()
      );

      const changedFields = [];
      for (const spec of FIELD_SPECS) {
        const oldValue = previous ? previous[spec.field] : null;
        const newValue = resolvedRaw[spec.field];
        if (valuesEqualNormalized(spec.field, oldValue, newValue)) continue;

        const r = resolutions[spec.field];
        this._insertReconciliationLog({
          modelName: normalizedModel,
          tag: normalizedTag,
          field: spec.label,
          oldValue,
          newValue,
          source: r.source,
          confidence: r.confidence,
          reasonCode: r.reasonCode,
          effectivePriority: r.effectivePriority,
        });
        changedFields.push(spec.field);
      }

      const derived = computeDerivedState(normalizedModel, normalizedTag, resolvedRaw, rows, resolutions);
      this._runUpsertDerived({
        modelName: normalizedModel,
        tag: normalizedTag,
        confidence: derived.confidence,
        confidenceState: derived.confidenceState,
        capabilityVector: derived.capabilityVector,
        recomputeAt: null,
        basedOnVersion: derived.basedOnVersion,
        lastComputedAt: derived.lastComputedAt,
      });

      return {
        ok: true,
        modelName: normalizedModel,
        tag: normalizedTag,
        metadataState,
        changedFields,
        resolvedRaw,
        derived,
      };
    });

    return tx();
  }

  /**
   * Primary write policy:
   *   1) Write model_universe_raw (primary)
   *   2) Optional best-effort mirror to discovered_models
   *   3) If primary fails, hard fallback write to discovered_models
   */
  persistRawWithFallback(entry = {}, opts = {}) {
    const mirrorEnabled = opts.mirrorEnabled ?? FEATURE_MIRROR_DISCOVERED;
    const scheduleRecompute = opts.scheduleRecompute === true;

    try {
      const primary = this.upsertRaw({ ...entry, writeSource: 'universe' });
      if (primary?.disabled) {
        if (!mirrorEnabled) {
          return { ok: false, writeSource: 'disabled', primary };
        }
        const mirror = this.mirrorToDiscovered({ ...entry, source: 'fallback' });
        this._writeLog(entry.modelName, entry.tag, null, 'fallback', 'ok', 'primary_disabled');
        return { ok: true, writeSource: 'fallback', primary, mirror };
      }
      let mirror = { ok: false, skipped: true };
      if (mirrorEnabled) {
        try {
          mirror = this.mirrorToDiscovered({ ...entry, source: 'universe' });
        } catch (err) {
          this._writeLog(entry.modelName, entry.tag, primary.writeToken, 'universe', 'mirror_failed', err.message);
          mirror = { ok: false, error: err.message };
        }
      }
      if (scheduleRecompute) {
        this.scheduleDerivedRecompute(entry.modelName, entry.tag, {
          reasonCode: 'raw_write',
          delayMs: opts.recomputeDelayMs ?? RECONCILE_DELAY_MS,
        });
      }
      return { ok: true, writeSource: 'universe', primary, mirror };
    } catch (primaryErr) {
      // Hard fallback path: discovered_models write must still succeed.
      try {
        const fallback = this.mirrorToDiscovered({ ...entry, source: 'fallback' });
        this._writeLog(entry.modelName, entry.tag, null, 'fallback', 'ok', primaryErr.message);
        return { ok: true, writeSource: 'fallback', fallback, primaryError: primaryErr.message };
      } catch (fallbackErr) {
        this._writeLog(entry.modelName, entry.tag, null, 'fallback', 'error', fallbackErr.message);
        throw new Error(`persistRawWithFallback failed: primary=${primaryErr.message}; fallback=${fallbackErr.message}`);
      }
    }
  }

  getLatestRawByModel(modelName) {
    this._ensureUniverseStatements();
    return this._stmts.getLatestRawByModel.get(normalizeName(modelName)) || null;
  }

  getReconciledRaw(modelName, tag = '') {
    this._ensureUniverseStatements();
    const normalizedModel = normalizeName(modelName);
    const normalizedTag = normalizeTag(normalizedModel, tag);
    return this._stmts.getReconciledRaw.get(normalizedModel, normalizedTag) || null;
  }

  getDerived(modelName, tag = '') {
    this._ensureUniverseStatements();
    const normalizedModel = normalizeName(modelName);
    const normalizedTag = normalizeTag(normalizedModel, tag);
    return this._stmts.getDerivedByModelTag.get(normalizedModel, normalizedTag) || null;
  }

  _mapUniverseRow(row = {}) {
    return {
      modelName: row.model_name,
      tag: row.tag || '',
      metadataState: row.metadata_state || null,
      parameters: row.parameters != null ? Number(row.parameters) : null,
      contextLength: row.context_length != null ? Number(row.context_length) : null,
      quantization: row.quantization || null,
      modality: row.modality || null,
      confidence: row.confidence != null ? Number(row.confidence) : null,
      confidenceState: row.confidence_state || null,
      lastComputedAt: row.derived_last_computed_at || row.derived_updated_at || null,
      updatedAt: row.raw_updated_at || null,
      lastVerifiedAt: row.last_verified_at || null,
    };
  }

  listUniverse(opts = {}) {
    this._ensureUniverseStatements();
    if (!FEATURE_UNIVERSE_ENABLED) {
      return { ok: false, disabled: true, reason: 'feature_disabled', models: [], total: 0, limit: 0, offset: 0, snapshotId: null };
    }

    const limitRaw = Number.parseInt(String(opts.limit ?? 50), 10);
    const offsetRaw = Number.parseInt(String(opts.offset ?? 0), 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;

    const stateInput = String(opts.state || '').trim().toUpperCase();
    const stateFilter = stateInput && METADATA_STATES.has(stateInput) ? stateInput : null;

    const sortInput = String(opts.sort || 'confidence').trim().toLowerCase();
    const orderInput = String(opts.order || 'desc').trim().toLowerCase();
    const sortMap = {
      confidence: 'd.confidence',
      updated: 'COALESCE(d.last_computed_at, d.updated_at, r.updated_at)',
      name: 'r.model_name',
      context: 'r.context_length',
      params: 'r.parameters',
    };
    const sortBy = sortMap[sortInput] ? sortInput : 'confidence';
    const sortSql = sortMap[sortBy];
    const orderSql = orderInput === 'asc' ? 'ASC' : 'DESC';

    const where = [`r.source = 'reconciled'`];
    const params = [];
    if (stateFilter) {
      where.push('r.metadata_state = ?');
      params.push(stateFilter);
    }
    const fromSql = `
      FROM model_universe_raw r
      LEFT JOIN model_universe_derived d
        ON d.model_name = r.model_name AND d.tag = r.tag
      WHERE ${where.join(' AND ')}
    `;

    const rows = this._db.prepare(`
      SELECT
        r.model_name, r.tag, r.metadata_state,
        r.parameters, r.context_length, r.quantization, r.modality,
        r.updated_at AS raw_updated_at, r.last_verified_at,
        d.confidence, d.confidence_state,
        d.last_computed_at AS derived_last_computed_at, d.updated_at AS derived_updated_at
      ${fromSql}
      ORDER BY ${sortSql} ${orderSql}, r.model_name ASC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    const totalRow = this._db.prepare(`
      SELECT COUNT(*) AS c
      ${fromSql}
    `).get(...params);

    const snapshotRow = this._db.prepare(`
      SELECT
        MAX(COALESCE(d.last_computed_at, d.updated_at, r.updated_at)) AS max_updated,
        COUNT(*) AS c
      ${fromSql}
    `).get(...params);

    const maxUpdatedMs = Date.parse(snapshotRow?.max_updated || 0) || 0;
    const snapshotId = `u1:${snapshotRow?.c || 0}:${maxUpdatedMs}`;

    return {
      ok: true,
      models: rows.map(r => this._mapUniverseRow(r)),
      total: totalRow?.c || 0,
      limit,
      offset,
      snapshotId,
      state: stateFilter,
      sortBy,
      order: orderSql.toLowerCase(),
    };
  }

  getUniverseModelDetails(modelName, opts = {}) {
    this._ensureUniverseStatements();
    if (!FEATURE_UNIVERSE_ENABLED) {
      return { ok: false, disabled: true, reason: 'feature_disabled', model: null, sources: [], signals: [], snapshotId: null };
    }

    const normalizedModel = canonicalModelName(modelName);
    if (!normalizedModel) return { ok: false, reason: 'missing_model', model: null, sources: [], signals: [], snapshotId: null };

    const requestedTag = normalizeTag(normalizedModel, opts.tag || '');
    const includeSignals = opts.includeSignals === true;
    const sourceLimitRaw = Number.parseInt(String(opts.sourceLimit ?? 30), 10);
    const signalLimitRaw = Number.parseInt(String(opts.signalLimit ?? 20), 10);
    const sourceLimit = Number.isFinite(sourceLimitRaw) ? Math.max(1, Math.min(200, sourceLimitRaw)) : 30;
    const signalLimit = Number.isFinite(signalLimitRaw) ? Math.max(1, Math.min(200, signalLimitRaw)) : 20;

    const detailWhere = requestedTag
      ? `r.model_name = ? AND r.tag = ?`
      : `r.model_name = ?`;
    const detailParams = requestedTag ? [normalizedModel, requestedTag] : [normalizedModel];

    let row = this._db.prepare(`
      SELECT
        r.model_name, r.tag, r.metadata_state,
        r.parameters, r.context_length, r.quantization, r.modality,
        r.metadata_json, r.updated_at AS raw_updated_at, r.last_verified_at,
        d.confidence, d.confidence_state,
        d.capability_vector_json, d.based_on_version,
        d.last_computed_at AS derived_last_computed_at, d.updated_at AS derived_updated_at
      FROM model_universe_raw r
      LEFT JOIN model_universe_derived d
        ON d.model_name = r.model_name AND d.tag = r.tag
      WHERE ${detailWhere} AND r.source = 'reconciled'
      ORDER BY r.updated_at DESC, r.id DESC
      LIMIT 1
    `).get(...detailParams);

    if (!row) {
      row = this._db.prepare(`
        SELECT
          r.model_name, r.tag, r.metadata_state,
          r.parameters, r.context_length, r.quantization, r.modality,
          r.metadata_json, r.updated_at AS raw_updated_at, r.last_verified_at,
          d.confidence, d.confidence_state,
          d.capability_vector_json, d.based_on_version,
          d.last_computed_at AS derived_last_computed_at, d.updated_at AS derived_updated_at
        FROM model_universe_raw r
        LEFT JOIN model_universe_derived d
          ON d.model_name = r.model_name AND d.tag = r.tag
        WHERE ${detailWhere}
        ORDER BY (r.source = 'reconciled') DESC, r.updated_at DESC, r.id DESC
        LIMIT 1
      `).get(...detailParams);
    }

    if (!row) {
      return {
        ok: true,
        model: null,
        sources: [],
        signals: [],
        snapshotId: `u1:${normalizedModel}:0`,
      };
    }

    const modelTag = row.tag || '';
    const sourceRows = this._db.prepare(`
      SELECT
        source, metadata_state, parameters, context_length, quantization, modality,
        updated_at, last_verified_at
      FROM model_universe_raw
      WHERE model_name = ? AND tag = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `).all(normalizedModel, modelTag, sourceLimit);

    let signals = [];
    if (includeSignals) {
      signals = this._db.prepare(`
        SELECT signal_type, success, latency_ms, error_type, created_at
        FROM model_signal_events
        WHERE model_name = ?
        ORDER BY id DESC
        LIMIT ?
      `).all(normalizedModel, signalLimit);
    }

    const snapshotTs = Date.parse(
      row.derived_last_computed_at || row.derived_updated_at || row.raw_updated_at || 0
    ) || 0;
    const snapshotId = `u1:${normalizedModel}:${modelTag}:${snapshotTs}`;
    const metadata = safeJsonParse(row.metadata_json);
    const capabilityVector = safeJsonParse(row.capability_vector_json);

    return {
      ok: true,
      snapshotId,
      model: {
        ...this._mapUniverseRow(row),
        metadata,
        capabilityVector,
        basedOnVersion: row.based_on_version || null,
      },
      sources: sourceRows.map(s => ({
        source: s.source,
        metadataState: s.metadata_state || null,
        parameters: s.parameters != null ? Number(s.parameters) : null,
        contextLength: s.context_length != null ? Number(s.context_length) : null,
        quantization: s.quantization || null,
        modality: s.modality || null,
        updatedAt: s.updated_at || null,
        lastVerifiedAt: s.last_verified_at || null,
      })),
      signals: includeSignals
        ? signals.map(s => ({
          signalType: s.signal_type,
          success: s.success == null ? null : !!s.success,
          latencyMs: s.latency_ms != null ? Number(s.latency_ms) : null,
          errorType: s.error_type || null,
          createdAt: s.created_at || null,
        }))
        : [],
    };
  }
}

export const modelUniverseStore = new ModelUniverseStore();

export default { modelUniverseStore, makeIdempotencyKey, normalizeFieldValue, resolveFieldValue };
