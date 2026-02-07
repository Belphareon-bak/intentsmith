// Circuit Breaker v52.0
// ══════════════════════════════════════════════════════════════════════════════
//
// Implements the Circuit Breaker pattern for tool resilience.
//
// States:
//   CLOSED - Normal operation, requests flow through
//   OPEN   - Failures exceeded threshold, requests blocked
//   HALF_OPEN - Testing if service recovered
//
// Prevents cascade failures when tools are unhealthy.
//
// ══════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// CIRCUIT BREAKER STATE
// ════════════════════════════════════════════════════════════════════════════

export const CircuitState = {
  CLOSED: 'CLOSED',       // Normal - requests pass through
  OPEN: 'OPEN',           // Tripped - requests blocked
  HALF_OPEN: 'HALF_OPEN', // Testing - limited requests allowed
};

// ════════════════════════════════════════════════════════════════════════════
// CIRCUIT BREAKER
// ════════════════════════════════════════════════════════════════════════════

export class CircuitBreaker {
  constructor(config = {}) {
    this.config = {
      // Failure threshold before opening circuit
      failureThreshold: config.failureThreshold ?? 5,

      // Success threshold to close circuit from half-open
      successThreshold: config.successThreshold ?? 2,

      // Time to wait before trying half-open (ms)
      resetTimeout: config.resetTimeout ?? 30000,

      // Window for counting failures (ms)
      failureWindow: config.failureWindow ?? 60000,

      // Max requests in half-open state
      halfOpenMaxRequests: config.halfOpenMaxRequests ?? 3,
    };

    // State
    this.state = CircuitState.CLOSED;
    this.failures = [];
    this.successes = 0;
    this.lastFailureTime = null;
    this.openedAt = null;
    this.halfOpenRequests = 0;

    // Metrics
    this.metrics = {
      total_calls: 0,
      total_successes: 0,
      total_failures: 0,
      total_blocked: 0,
      state_changes: [],
    };
  }

  /**
   * Check if a request can proceed
   *
   * @returns {Object} { allowed, reason, state }
   */
  canProceed() {
    this.cleanupOldFailures();

    if (this.state === CircuitState.CLOSED) {
      return { allowed: true, reason: 'Circuit closed', state: this.state };
    }

    if (this.state === CircuitState.OPEN) {
      // Check if reset timeout has passed
      if (this.shouldAttemptReset()) {
        this.transitionTo(CircuitState.HALF_OPEN);
        return { allowed: true, reason: 'Testing recovery', state: this.state };
      }
      this.metrics.total_blocked++;
      return { allowed: false, reason: 'Circuit open', state: this.state };
    }

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.halfOpenRequests < this.config.halfOpenMaxRequests) {
        this.halfOpenRequests++;
        return { allowed: true, reason: 'Half-open test', state: this.state };
      }
      this.metrics.total_blocked++;
      return { allowed: false, reason: 'Half-open limit reached', state: this.state };
    }

    return { allowed: false, reason: 'Unknown state', state: this.state };
  }

  /**
   * Record a successful call
   */
  recordSuccess() {
    this.metrics.total_calls++;
    this.metrics.total_successes++;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        this.transitionTo(CircuitState.CLOSED);
      }
    }
  }

  /**
   * Record a failed call
   *
   * @param {Error} error - The error that occurred
   */
  recordFailure(error = null) {
    this.metrics.total_calls++;
    this.metrics.total_failures++;

    const now = Date.now();
    this.failures.push({ timestamp: now, error: error?.message });
    this.lastFailureTime = now;

    this.cleanupOldFailures();

    if (this.state === CircuitState.HALF_OPEN) {
      // Any failure in half-open opens the circuit again
      this.transitionTo(CircuitState.OPEN);
      return;
    }

    if (this.state === CircuitState.CLOSED) {
      if (this.failures.length >= this.config.failureThreshold) {
        this.transitionTo(CircuitState.OPEN);
      }
    }
  }

  /**
   * Clean up failures outside the window
   */
  cleanupOldFailures() {
    const cutoff = Date.now() - this.config.failureWindow;
    this.failures = this.failures.filter(f => f.timestamp > cutoff);
  }

  /**
   * Check if we should attempt reset
   */
  shouldAttemptReset() {
    if (!this.openedAt) return false;
    return (Date.now() - this.openedAt) >= this.config.resetTimeout;
  }

  /**
   * Transition to a new state
   */
  transitionTo(newState) {
    const oldState = this.state;
    this.state = newState;

    this.metrics.state_changes.push({
      from: oldState,
      to: newState,
      timestamp: new Date().toISOString(),
    });

    // State-specific initialization
    if (newState === CircuitState.OPEN) {
      this.openedAt = Date.now();
    } else if (newState === CircuitState.HALF_OPEN) {
      this.halfOpenRequests = 0;
      this.successes = 0;
    } else if (newState === CircuitState.CLOSED) {
      this.failures = [];
      this.openedAt = null;
      this.successes = 0;
    }
  }

  /**
   * Force open the circuit (for testing or manual intervention)
   */
  forceOpen() {
    this.transitionTo(CircuitState.OPEN);
  }

  /**
   * Force close the circuit (for testing or manual intervention)
   */
  forceClose() {
    this.transitionTo(CircuitState.CLOSED);
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      state: this.state,
      failures_in_window: this.failures.length,
      failure_threshold: this.config.failureThreshold,
      last_failure: this.lastFailureTime
        ? new Date(this.lastFailureTime).toISOString()
        : null,
      opened_at: this.openedAt
        ? new Date(this.openedAt).toISOString()
        : null,
      time_until_reset: this.state === CircuitState.OPEN && this.openedAt
        ? Math.max(0, this.config.resetTimeout - (Date.now() - this.openedAt))
        : null,
    };
  }

  /**
   * Get metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      current_state: this.state,
      failures_in_window: this.failures.length,
    };
  }

  /**
   * Reset metrics (for testing)
   */
  resetMetrics() {
    this.metrics = {
      total_calls: 0,
      total_successes: 0,
      total_failures: 0,
      total_blocked: 0,
      state_changes: [],
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CIRCUIT BREAKER REGISTRY
// ════════════════════════════════════════════════════════════════════════════

/**
 * Manages circuit breakers for multiple tools
 */
export class CircuitBreakerRegistry {
  constructor(defaultConfig = {}) {
    this.defaultConfig = defaultConfig;
    this.breakers = new Map();
  }

  /**
   * Get or create a circuit breaker for a tool
   *
   * @param {string} toolName - Tool identifier
   * @param {Object} config - Optional custom config
   * @returns {CircuitBreaker}
   */
  getBreaker(toolName, config = null) {
    if (!this.breakers.has(toolName)) {
      this.breakers.set(
        toolName,
        new CircuitBreaker(config || this.defaultConfig)
      );
    }
    return this.breakers.get(toolName);
  }

  /**
   * Check if a tool can proceed
   *
   * @param {string} toolName - Tool identifier
   * @returns {Object} { allowed, reason, state }
   */
  canProceed(toolName) {
    const breaker = this.getBreaker(toolName);
    return breaker.canProceed();
  }

  /**
   * Record success for a tool
   *
   * @param {string} toolName - Tool identifier
   */
  recordSuccess(toolName) {
    const breaker = this.getBreaker(toolName);
    breaker.recordSuccess();
  }

  /**
   * Record failure for a tool
   *
   * @param {string} toolName - Tool identifier
   * @param {Error} error - The error
   */
  recordFailure(toolName, error = null) {
    const breaker = this.getBreaker(toolName);
    breaker.recordFailure(error);
  }

  /**
   * Get status for all tools
   */
  getAllStatus() {
    const status = {};
    for (const [name, breaker] of this.breakers) {
      status[name] = breaker.getStatus();
    }
    return status;
  }

  /**
   * Get tools in OPEN state
   */
  getOpenCircuits() {
    return Array.from(this.breakers.entries())
      .filter(([_, breaker]) => breaker.state === CircuitState.OPEN)
      .map(([name]) => name);
  }

  /**
   * Reset all breakers
   */
  resetAll() {
    for (const breaker of this.breakers.values()) {
      breaker.forceClose();
      breaker.resetMetrics();
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default {
  CircuitBreaker,
  CircuitBreakerRegistry,
  CircuitState,
};
