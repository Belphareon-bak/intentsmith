// License System — Offline Hardware-Bound Keys (Phase F5)
// ══════════════════════════════════════════════════════════════════════════════
//
// DESIGN: Offline-first, no license server needed.
//
// How it works:
//   1. Generate hardware fingerprint (CPU + hostname + platform + MAC hint)
//   2. License key = base64(JSON { tier, hwHash, expiry, features }) + HMAC signature
//   3. Validation: re-derive fingerprint, verify HMAC, check expiry
//
// Key format: C3-XXXX-XXXX-XXXX-XXXX (base64url encoded, 4 groups)
//
// Tiers:
//   - FREE: basic chat, 1 project, no agents, no export
//   - PRO: unlimited chat + projects, agents, export, workers
//   - ENTERPRISE: PRO + multi-user, priority support
//
// SECURITY NOTE: This is deterrent-level protection (like most Node.js apps).
//   Determined users can bypass it. The goal is to make casual piracy inconvenient.
//   Real revenue protection comes from value, not DRM.
//
// ══════════════════════════════════════════════════════════════════════════════

import crypto from 'crypto';
import os from 'os';
import { logger } from '../core/logger.js';

// ─── Constants ──────────────────────────────────────────────────────────────

// HMAC secret — in production, embed a unique secret per build
const LICENSE_SECRET = process.env.C3_LICENSE_SECRET || 'c3-agent-license-v1-default-secret';

const TIERS = Object.freeze({
  FREE: 'FREE',
  PRO: 'PRO',
  ENTERPRISE: 'ENTERPRISE',
});

const TIER_FEATURES = Object.freeze({
  FREE: {
    maxProjects: 1,
    agents: false,
    workers: false,
    export: ['md', 'txt'],
    specialists: false,
    maxConversationsPerDay: 50,
  },
  PRO: {
    maxProjects: Infinity,
    agents: true,
    workers: true,
    export: ['md', 'txt', 'html', 'pdf', 'docx'],
    specialists: true,
    maxConversationsPerDay: Infinity,
  },
  ENTERPRISE: {
    maxProjects: Infinity,
    agents: true,
    workers: true,
    export: ['md', 'txt', 'html', 'pdf', 'docx'],
    specialists: true,
    maxConversationsPerDay: Infinity,
    multiUser: true,
    prioritySupport: true,
  },
});

// ─── Hardware Fingerprint ───────────────────────────────────────────────────

/**
 * Generate a hardware fingerprint for this machine.
 * Combines multiple signals for reasonable uniqueness.
 * Not cryptographically unique, but sufficient for license binding.
 */
export function generateFingerprint() {
  const components = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.cpus()?.[0]?.model || 'unknown-cpu',
    os.cpus()?.length?.toString() || '0',
    os.totalmem().toString(),
    // MAC address hint (first non-internal interface)
    getFirstMacAddress(),
  ];

  const raw = components.join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

function getFirstMacAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
        return iface.mac;
      }
    }
  }
  return 'no-mac';
}

// ─── License Key Generation ─────────────────────────────────────────────────

/**
 * Generate a license key for a specific hardware fingerprint.
 * This would typically run on YOUR machine (the developer), not the user's.
 *
 * @param {Object} opts
 * @param {string} opts.hwFingerprint - Target machine fingerprint
 * @param {string} opts.tier - 'FREE' | 'PRO' | 'ENTERPRISE'
 * @param {string} [opts.expiry] - ISO date string (null = never expires)
 * @param {string} [opts.owner] - Owner name/email for tracking
 * @param {string} [opts.secret] - Override HMAC secret
 */
export function generateLicenseKey({
  hwFingerprint,
  tier = TIERS.PRO,
  expiry = null,
  owner = '',
  secret = LICENSE_SECRET,
}) {
  if (!TIERS[tier]) throw new Error(`Invalid tier: ${tier}`);
  if (!hwFingerprint || hwFingerprint.length < 8) {
    throw new Error('Invalid hardware fingerprint');
  }

  const payload = {
    v: 1,                            // version
    t: tier,                         // tier
    hw: hwFingerprint.slice(0, 16),  // hardware hash (truncated)
    exp: expiry || null,             // expiry date
    o: owner.slice(0, 64),           // owner
    iat: new Date().toISOString(),   // issued at
  };

  const payloadStr = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadStr).toString('base64url');

  // HMAC signature (hex for safe separator handling)
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payloadB64);
  const signature = hmac.digest('hex').slice(0, 32);

  // Encode combined payload+sig as hex to avoid base64url dash collision
  const combined = Buffer.from(payloadB64 + '.' + signature).toString('hex');
  
  // Format as C3-XXXXXXXX-XXXXXXXX-...
  const chunks = [];
  for (let i = 0; i < combined.length; i += 8) {
    chunks.push(combined.slice(i, i + 8));
  }

  return 'C3-' + chunks.join('-');
}

// ─── License Key Validation ─────────────────────────────────────────────────

/**
 * Validate a license key against the current machine's fingerprint.
 *
 * @param {string} key - License key (C3-XXXX-XXXX-...)
 * @param {Object} [opts]
 * @param {string} [opts.hwFingerprint] - Override fingerprint (for testing)
 * @param {string} [opts.secret] - Override HMAC secret
 * @returns {Object} { valid, tier, features, error, payload }
 */
export function validateLicenseKey(key, opts = {}) {
  const secret = opts.secret || LICENSE_SECRET;

  try {
    // 1. Parse key format
    if (!key || !key.startsWith('C3-')) {
      return { valid: false, tier: TIERS.FREE, features: TIER_FEATURES.FREE, error: 'Invalid key format' };
    }

    // Decode hex → payload.signature
    const hex = key.slice(3).replace(/-/g, '');
    let decoded;
    try {
      decoded = Buffer.from(hex, 'hex').toString('utf-8');
    } catch {
      return { valid: false, tier: TIERS.FREE, features: TIER_FEATURES.FREE, error: 'Invalid key encoding' };
    }

    const dotIdx = decoded.lastIndexOf('.');
    if (dotIdx === -1) {
      return { valid: false, tier: TIERS.FREE, features: TIER_FEATURES.FREE, error: 'Invalid key structure' };
    }

    const payloadB64 = decoded.slice(0, dotIdx);
    const signature = decoded.slice(dotIdx + 1);

    // 2. Verify HMAC (hex-based)
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payloadB64);
    const expectedSig = hmac.digest('hex').slice(0, 32);

    if (signature !== expectedSig) {
      return { valid: false, tier: TIERS.FREE, features: TIER_FEATURES.FREE, error: 'Invalid signature' };
    }

    // 3. Decode payload
    const payloadStr = Buffer.from(payloadB64, 'base64url').toString('utf-8');
    const payload = JSON.parse(payloadStr);

    // 4. Check version
    if (payload.v !== 1) {
      return { valid: false, tier: TIERS.FREE, features: TIER_FEATURES.FREE, error: 'Unsupported key version' };
    }

    // 5. Check expiry
    if (payload.exp) {
      const expiryDate = new Date(payload.exp);
      if (expiryDate < new Date()) {
        return {
          valid: false,
          tier: TIERS.FREE,
          features: TIER_FEATURES.FREE,
          error: `License expired on ${payload.exp}`,
          payload,
        };
      }
    }

    // 6. Check hardware fingerprint
    const currentHw = opts.hwFingerprint || generateFingerprint();
    const currentHwTruncated = currentHw.slice(0, 16);

    if (payload.hw !== currentHwTruncated) {
      return {
        valid: false,
        tier: TIERS.FREE,
        features: TIER_FEATURES.FREE,
        error: 'Hardware mismatch — license bound to different machine',
        payload,
      };
    }

    // 7. Valid!
    const tier = TIERS[payload.t] || TIERS.FREE;
    const features = TIER_FEATURES[tier] || TIER_FEATURES.FREE;

    return {
      valid: true,
      tier,
      features,
      error: null,
      payload,
      expiresAt: payload.exp || null,
      owner: payload.o || null,
    };

  } catch (err) {
    return {
      valid: false,
      tier: TIERS.FREE,
      features: TIER_FEATURES.FREE,
      error: `Validation error: ${err.message}`,
    };
  }
}

// ─── License Manager (runtime) ──────────────────────────────────────────────

export class LicenseManager {
  constructor() {
    this._cache = null;
    this._cacheKey = null;
  }

  /**
   * Get current license status (cached).
   */
  getStatus(key = process.env.C3_LICENSE_KEY) {
    if (!key) {
      return { valid: false, tier: TIERS.FREE, features: TIER_FEATURES.FREE };
    }

    // Cache validation result per key
    if (this._cacheKey === key && this._cache) {
      return this._cache;
    }

    this._cache = validateLicenseKey(key);
    this._cacheKey = key;
    return this._cache;
  }

  /**
   * Check if a specific feature is allowed.
   */
  hasFeature(feature, key = process.env.C3_LICENSE_KEY) {
    const status = this.getStatus(key);
    return !!status.features?.[feature];
  }

  /**
   * Get current tier.
   */
  getTier(key = process.env.C3_LICENSE_KEY) {
    return this.getStatus(key).tier;
  }

  /**
   * Invalidate cache (e.g., when key changes).
   */
  invalidate() {
    this._cache = null;
    this._cacheKey = null;
  }
}

// ─── CLI: Generate key ──────────────────────────────────────────────────────

export function cliGenerateKey() {
  const fp = generateFingerprint();
  console.log(`Hardware fingerprint: ${fp}`);

  const tier = process.argv[3]?.toUpperCase() || 'PRO';
  const expiry = process.argv[4] || null;
  const owner = process.argv[5] || '';

  const key = generateLicenseKey({ hwFingerprint: fp, tier, expiry, owner });
  console.log(`License key (${tier}):\n  ${key}`);

  const validation = validateLicenseKey(key, { hwFingerprint: fp });
  console.log(`Validation: ${validation.valid ? '✅ VALID' : '❌ INVALID'}`);

  return key;
}

// ─── Singleton ──────────────────────────────────────────────────────────────

export const licenseManager = new LicenseManager();

// ─── Exports ────────────────────────────────────────────────────────────────

export default {
  generateFingerprint,
  generateLicenseKey,
  validateLicenseKey,
  LicenseManager,
  licenseManager,
  TIERS,
  TIER_FEATURES,
};
