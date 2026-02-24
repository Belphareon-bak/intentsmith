// CRE v36.7 LLM Gateway
// ══════════════════════════════════════════════════════════════════════════════
//
// CENTRAL CONTROLLED ACCESS TO LLM
//
// This is the ONLY place that can call Ollama/LLM.
// All callers must have a valid LLMAuthToken.
//
// Features:
// - Capability-based authorization
// - Token validation
// - Audit logging
// - Rate limiting
// - Single point of control
//
// ══════════════════════════════════════════════════════════════════════════════

import { config } from '../config.js';
import { logger } from '../core/logger.js';
import { 
  validateAuthToken, 
  hasCapability, 
  LLMCallerRole,
  LLMCapability 
} from './auth-types.js';

// ════════════════════════════════════════════════════════════════════════════
// AUDIT LOG
// ════════════════════════════════════════════════════════════════════════════

class LLMAuditLog {
  constructor() {
    this.logs = [];
    this.maxLogs = 1000;
  }
  
  log(event, data) {
    const entry = {
      timestamp: Date.now(),
      event,
      ...data
    };
    
    this.logs.push(entry);
    
    // Trim if too many
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
    
    // Also log to standard logger
    if (event === 'UNAUTHORIZED_CALL') {
      logger.error('LLMGateway', `UNAUTHORIZED LLM CALL BLOCKED`, data);
    } else if (event === 'CAPABILITY_DENIED') {
      logger.warn('LLMGateway', `Capability denied: ${data.capability}`, data);
    } else {
      logger.debug('LLMGateway', event, { 
        role: data.role, 
        decisionId: data.decisionId,
        duration: data.duration 
      });
    }
  }
  
  getLogs(since = 0) {
    return this.logs.filter(l => l.timestamp >= since);
  }
  
  getStats() {
    const last5min = Date.now() - 300000;
    const recentLogs = this.logs.filter(l => l.timestamp >= last5min);
    
    return {
      totalCalls: this.logs.filter(l => l.event === 'LLM_CALL_COMPLETE').length,
      recentCalls: recentLogs.filter(l => l.event === 'LLM_CALL_COMPLETE').length,
      unauthorizedAttempts: this.logs.filter(l => l.event === 'UNAUTHORIZED_CALL').length,
      byRole: this.groupByRole(recentLogs)
    };
  }
  
  groupByRole(logs) {
    const byRole = {};
    for (const log of logs) {
      if (log.role) {
        byRole[log.role] = (byRole[log.role] || 0) + 1;
      }
    }
    return byRole;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// LLM GATEWAY
// ════════════════════════════════════════════════════════════════════════════

class LLMGateway {
  constructor() {
    this.currentAuth = null;
    this.audit = new LLMAuditLog();
    this.callCount = 0;
    
    // Rate limiting
    this.rateLimits = {
      maxCallsPerMinute: 60,
      currentMinuteCalls: 0,
      currentMinuteStart: Date.now()
    };
    
    // v36.9: Strict mode is NOW DEFAULT
    // ONLY authorized calls go through. Legacy calls require ALLOW_LEGACY_LLM env var.
    this.strictMode = true;
  }
  
  /**
   * Enable strict mode - blocks all unauthorized calls
   */
  enableStrictMode() {
    this.strictMode = true;
    logger.info('LLMGateway', 'Strict mode ENABLED - unauthorized calls will be blocked');
  }
  
  /**
   * Disable strict mode - allows legacy calls with warning
   */
  disableStrictMode() {
    this.strictMode = false;
    logger.warn('LLMGateway', 'Strict mode DISABLED - legacy calls allowed');
  }
  
  /**
   * Authorize a caller to make LLM calls
   * 
   * @param {LLMAuthToken} token
   */
  authorize(token) {
    const validation = validateAuthToken(token);
    
    if (!validation.valid) {
      throw new Error(`Invalid LLM auth token: ${validation.error}`);
    }
    
    this.currentAuth = token;
    
    this.audit.log('LLM_AUTHORIZED', {
      role: token.role,
      decisionId: token.decisionId,
      sessionId: token.auditContext?.sessionId,
      maxTokens: token.maxTokens,
      capabilities: token.allowedCapabilities
    });
  }
  
  /**
   * Revoke current authorization
   */
  revoke() {
    if (this.currentAuth) {
      this.audit.log('LLM_REVOKED', {
        role: this.currentAuth.role,
        decisionId: this.currentAuth.decisionId
      });
    }
    this.currentAuth = null;
  }
  
  /**
   * Check if currently authorized
   * @returns {boolean}
   */
  isAuthorized() {
    if (!this.currentAuth) return false;

    const validation = validateAuthToken(this.currentAuth);
    return validation.valid;
  }

  /**
   * Check if there's an active valid token (for external guards)
   * @returns {boolean}
   */
  hasActiveToken() {
    return this.isAuthorized();
  }
  
  /**
   * Get current auth info (for debugging)
   */
  getCurrentAuth() {
    return this.currentAuth ? {
      role: this.currentAuth.role,
      decisionId: this.currentAuth.decisionId,
      expiresIn: this.currentAuth.expiresAt - Date.now()
    } : null;
  }
  
  /**
   * Check rate limit
   * @returns {{ allowed: boolean, retryAfter?: number }}
   */
  checkRateLimit() {
    const now = Date.now();
    
    // Reset counter if minute has passed
    if (now - this.rateLimits.currentMinuteStart > 60000) {
      this.rateLimits.currentMinuteCalls = 0;
      this.rateLimits.currentMinuteStart = now;
    }
    
    if (this.rateLimits.currentMinuteCalls >= this.rateLimits.maxCallsPerMinute) {
      const retryAfter = 60000 - (now - this.rateLimits.currentMinuteStart);
      return { allowed: false, retryAfter };
    }
    
    return { allowed: true };
  }
  
  /**
   * Main call method - ALL LLM calls go through here
   * 
   * @param {string} prompt - The prompt to send
   * @param {Object} options - Call options
   * @param {string} [options.systemPrompt] - System prompt
   * @param {string} [options.capability] - Required capability for this call
   * @param {string} [options.model] - Model override
   * @param {number} [options.temperature] - Temperature
   * @param {number} [options.maxTokens] - Max tokens
   * @param {string} [options.legacyRole] - Legacy role (for migration)
   * @returns {Promise<{content: string, model: string, duration: number}>}
   */
  async call(prompt, options = {}) {
    const startTime = Date.now();

    // ════════════════════════════════════════════════════════════════════════
    // v44.0: INLINE AUTH TOKEN SUPPORT (avoids race condition)
    // ════════════════════════════════════════════════════════════════════════

    // Use inline token if provided, otherwise fall back to singleton
    const authToken = options._authToken || this.currentAuth;
    const isAuthorizedCall = authToken && validateAuthToken(authToken).valid;

    // ════════════════════════════════════════════════════════════════════════
    // AUTHORIZATION CHECK
    // ════════════════════════════════════════════════════════════════════════

    if (!isAuthorizedCall) {
      if (this.strictMode) {
        // v36.9: Check if LEGACY_DIRECT is allowed via env flag
        if (options.legacyRole && process.env.ALLOW_LEGACY_LLM === '1') {
          // Legacy allowed but LOUD
          logger.warn('LLMGateway', `[DEPRECATED] LEGACY_DIRECT LLM call from role: ${options.legacyRole}. MIGRATE TO AUTH TOKENS.`, {
            legacyRole: options.legacyRole,
            promptLength: prompt.length,
            stack: new Error().stack?.split('\n').slice(2, 5).join(' <- ')
          });
          this.audit.log('LEGACY_CALL_ALLOWED', {
            legacyRole: options.legacyRole,
            promptLength: prompt.length
          });
        } else {
          // HARD BLOCK - no auth token, no env flag
          this.audit.log('UNAUTHORIZED_CALL', {
            promptPreview: prompt.substring(0, 100),
            hasInlineToken: !!options._authToken,
            hasSingletonAuth: !!this.currentAuth,
            options: { ...options, _authToken: undefined },
            stack: new Error().stack?.split('\n').slice(2, 5).join(' <- ')
          });
          throw new Error('LLM_CALL_OUTSIDE_CRE: No valid auth token. All LLM calls must go through CRE with proper authorization.');
        }
      } else {
        // Non-strict mode (only for tests)
        logger.warn('LLMGateway', 'LEGACY CALL - No auth token (non-strict mode)', {
          legacyRole: options.legacyRole,
          promptLength: prompt.length
        });
        this.audit.log('LEGACY_CALL', {
          legacyRole: options.legacyRole,
          promptLength: prompt.length
        });
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // CAPABILITY CHECK
    // ════════════════════════════════════════════════════════════════════════

    if (authToken && options.capability) {
      if (!hasCapability(authToken, options.capability)) {
        this.audit.log('CAPABILITY_DENIED', {
          role: authToken.role,
          decisionId: authToken.decisionId,
          capability: options.capability,
          allowed: authToken.allowedCapabilities
        });
        throw new Error(`CAPABILITY_NOT_ALLOWED: ${options.capability}`);
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // RATE LIMIT CHECK
    // ════════════════════════════════════════════════════════════════════════

    const rateCheck = this.checkRateLimit();
    if (!rateCheck.allowed) {
      this.audit.log('RATE_LIMITED', {
        role: authToken?.role,
        retryAfter: rateCheck.retryAfter
      });
      throw new Error(`RATE_LIMITED: Retry after ${rateCheck.retryAfter}ms`);
    }

    // ════════════════════════════════════════════════════════════════════════
    // DETERMINE LIMITS
    // ════════════════════════════════════════════════════════════════════════

    const effectiveMaxTokens = Math.min(
      options.maxTokens || 4096,
      authToken?.maxTokens || 4096
    );
    
    // ════════════════════════════════════════════════════════════════════════
    // MAKE THE CALL
    // ════════════════════════════════════════════════════════════════════════
    
    const model = options.model || config.models?.CHAT || 'qwen2.5:32b';
    const timeout = options.timeout || config.timeouts?.CHAT || 60000;
    
    // Build messages (support pre-built array via options.messages)
    const messages = options.messages || (() => {
      const msgs = [];
      if (options.systemPrompt) {
        msgs.push({ role: 'system', content: options.systemPrompt });
      }
      msgs.push({ role: 'user', content: prompt });
      return msgs;
    })();
    
    const body = {
      model,
      messages,
      stream: false,
      options: {
        temperature: options.temperature ?? 0.3,
        top_p: options.top_p ?? 0.75,
        repeat_penalty: options.repeat_penalty ?? 1.1,
        num_predict: effectiveMaxTokens,
        // v72: Allow callers to override context window size (e.g. 1024 for classification)
        ...(options.num_ctx ? { num_ctx: options.num_ctx } : {}),
      }
    };

    // Pass format through if specified (e.g. 'json' for structured output)
    if (options.format) {
      body.format = options.format;
    }
    
    let lastError;
    const maxRetries = config.ollama?.retries || 3;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        // v63.0: Connect user cancel signal to LLM abort controller
        // When the user disconnects (req.on('close')), abort the LLM call too
        const userSignal = options.signal;
        let userAbortHandler;
        if (userSignal) {
          if (userSignal.aborted) {
            clearTimeout(timeoutId);
            throw new Error('Request cancelled by user');
          }
          userAbortHandler = () => controller.abort();
          userSignal.addEventListener('abort', userAbortHandler, { once: true });
        }

        const response = await fetch(`${config.ollama?.baseUrl || 'http://127.0.0.1:11434'}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        if (userAbortHandler) userSignal.removeEventListener('abort', userAbortHandler);
        
        if (!response.ok) {
          throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`);
        }
        
        const data = await response.json();
        const output = data.message?.content || data.response || '';
        const duration = Date.now() - startTime;
        
        // Update rate limit counter
        this.rateLimits.currentMinuteCalls++;
        this.callCount++;
        
        // Audit successful call
        this.audit.log('LLM_CALL_COMPLETE', {
          role: authToken?.role || options.legacyRole || 'UNKNOWN',
          decisionId: authToken?.decisionId,
          sessionId: authToken?.auditContext?.sessionId,
          model,
          promptLength: prompt.length,
          outputLength: output.length,
          duration,
          attempt
        });

        return {
          content: output,
          model,
          duration,
          role: authToken?.role || options.legacyRole,
          promptEvalCount: data.prompt_eval_count || null,
          evalCount: data.eval_count || null,
        };
        
      } catch (err) {
        lastError = err;

        // v63.0: Distinguish abort sources for proper handling
        if (err.name === 'AbortError') {
          const userSignal = options.signal;
          if (userSignal?.aborted) {
            // User cancelled (frontend disconnect / cancel button)
            logger.info('LLMGateway', `User cancelled LLM call (attempt ${attempt}/${maxRetries})`, {
              abortSource: 'user_cancel',
              sessionId: authToken?.auditContext?.sessionId,
            });
            // Don't retry on user cancel — break immediately
            this.audit.log('LLM_CALL_CANCELLED', {
              role: authToken?.role,
              decisionId: authToken?.decisionId,
              abortSource: 'user_cancel',
            });
            throw new Error('LLM call cancelled by user');
          } else {
            // Timeout — controller.abort() from setTimeout
            logger.warn('LLMGateway', `Timeout after ${timeout}ms (attempt ${attempt}/${maxRetries})`, {
              abortSource: 'timeout',
            });
          }
        } else if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
          logger.warn('LLMGateway', `Network error (attempt ${attempt}/${maxRetries}): ${err.code}`, {
            abortSource: 'network',
          });
        } else {
          logger.warn('LLMGateway', `Error (attempt ${attempt}/${maxRetries}): ${err.message}`);
        }

        if (attempt < maxRetries) {
          await this.sleep((config.ollama?.retryDelay || 1000) * attempt);
        }
      }
    }
    
    this.audit.log('LLM_CALL_FAILED', {
      role: authToken?.role,
      decisionId: authToken?.decisionId,
      error: lastError?.message
    });

    throw new Error(`LLM failed after ${maxRetries} attempts: ${lastError?.message}`);
  }
  
  /**
   * Helper for sleep
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Get audit stats
   */
  getStats() {
    return {
      ...this.audit.getStats(),
      totalCallCount: this.callCount,
      strictMode: this.strictMode,
      currentAuth: this.getCurrentAuth()
    };
  }
  
  /**
   * Get audit logs
   */
  getAuditLogs(since = 0) {
    return this.audit.getLogs(since);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ════════════════════════════════════════════════════════════════════════════

// Global singleton - THE ONLY way to call LLM
export const llmGateway = new LLMGateway();

// ════════════════════════════════════════════════════════════════════════════
// CONVENIENCE FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Call LLM with auth token (convenience wrapper)
 * Use this in places that have their own auth token
 *
 * v44.0: Pass token directly to call() to avoid race conditions with singleton
 */
export async function callWithAuth(token, prompt, options = {}) {
  // v44.0: Pass token in options to avoid singleton race condition
  return await llmGateway.call(prompt, {
    ...options,
    _authToken: token
  });
}

/**
 * Legacy call - for migration period ONLY
 * This should be removed once all callers are migrated
 */
export async function legacyCall(role, prompt, systemPrompt = '', options = {}) {
  logger.warn('LLMGateway', `LEGACY CALL from role: ${role} - MIGRATE TO AUTH TOKENS`);
  
  return await llmGateway.call(prompt, {
    ...options,
    systemPrompt,
    legacyRole: role
  });
}

export default {
  llmGateway,
  callWithAuth,
  legacyCall
};
