// v121: Capability Registry
// ══════════════════════════════════════════════════════════════════════════════
//
// N:M mapping between capabilities and specialists.
// Solves the 10+ specialist routing problem where a single expertise
// may be fulfilled by multiple specialists.
//
// Architecture:
//   capability → Map<specialistId, { priority }>
//   resolve(capability) → specialistId[] sorted by priority desc, then registration order
//
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Registry for capability → specialist[] mapping.
 * Used by CRE to resolve which specialist can handle a given capability.
 */
export class CapabilityRegistry {
  constructor() {
    /** @type {Map<string, Map<string, { priority: number, order: number }>>} */
    this._capabilities = new Map();
    /** @type {number} registration counter for stable ordering */
    this._counter = 0;
  }

  /**
   * Register a capability for a specialist.
   * Idempotent — re-registration updates priority.
   *
   * @param {string} capability - dotted notation (e.g. "tax.calculate")
   * @param {string} specialistId - specialist providing this capability
   * @param {number} [priority=10] - higher = preferred
   */
  register(capability, specialistId, priority = 10) {
    if (!this._capabilities.has(capability)) {
      this._capabilities.set(capability, new Map());
    }
    const existing = this._capabilities.get(capability).get(specialistId);
    this._capabilities.get(capability).set(specialistId, {
      priority,
      order: existing?.order ?? this._counter++,
    });
  }

  /**
   * Unregister a specific capability for a specialist.
   * @param {string} capability
   * @param {string} specialistId
   */
  unregister(capability, specialistId) {
    const entries = this._capabilities.get(capability);
    if (entries) {
      entries.delete(specialistId);
      if (entries.size === 0) {
        this._capabilities.delete(capability);
      }
    }
  }

  /**
   * Unregister ALL capabilities for a specialist.
   * Used during specialist disable/unregister for fail-safe cleanup.
   *
   * @param {string} specialistId
   */
  unregisterBySpecialist(specialistId) {
    for (const [capability, entries] of this._capabilities) {
      entries.delete(specialistId);
      if (entries.size === 0) {
        this._capabilities.delete(capability);
      }
    }
  }

  /**
   * Resolve a capability to specialist IDs.
   * Returns sorted by: 1) highest priority, 2) registration order (earliest first).
   *
   * @param {string} capability
   * @returns {string[]} specialistIds sorted by priority desc, then registration order
   */
  resolve(capability) {
    const entries = this._capabilities.get(capability);
    if (!entries || entries.size === 0) return [];

    return [...entries.entries()]
      .sort((a, b) => {
        // Higher priority first
        if (b[1].priority !== a[1].priority) return b[1].priority - a[1].priority;
        // Same priority: earlier registration first
        return a[1].order - b[1].order;
      })
      .map(([id]) => id);
  }

  /**
   * Get all capabilities a specialist provides.
   * @param {string} specialistId
   * @returns {string[]} capability names
   */
  getSpecialistCapabilities(specialistId) {
    const caps = [];
    for (const [capability, entries] of this._capabilities) {
      if (entries.has(specialistId)) {
        caps.push(capability);
      }
    }
    return caps;
  }

  /**
   * List all registered capabilities.
   * @returns {string[]}
   */
  listCapabilities() {
    return [...this._capabilities.keys()];
  }

  /**
   * Check if a capability is registered by any specialist.
   * @param {string} capability
   * @returns {boolean}
   */
  has(capability) {
    return this._capabilities.has(capability) && this._capabilities.get(capability).size > 0;
  }

  /**
   * Get the number of registered capabilities.
   * @returns {number}
   */
  get size() {
    return this._capabilities.size;
  }
}
