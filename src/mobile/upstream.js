// Upstream client — the gateway's only link to the legacy server.
// ==============================================================================
//
// The gateway holds no chat logic.  It forwards to the existing loopback server
// so CRE stays the single authority and QGv2 is not bypassed (PLAN.md §2
// rule 6).
//
// The distinction this module exists to make is `decided` vs ambiguous:
//
//   decided   — the upstream answered, and the answer was a refusal.  The
//               operation did not happen.  Safe to record as REJECTED.
//   ambiguous — connection reset, timeout, or a 5xx after the request was
//               already in flight.  We do not know whether the effect
//               happened, so the journal must record UNKNOWN and the client
//               must resolve it by reading, not retrying (MD-19 rule 3).
//
// Getting this wrong in the safe-looking direction (calling an ambiguous
// failure "rejected") is what produces duplicate sends, so ambiguity is the
// default and `decided` has to be earned.
//
// ==============================================================================

const DEFAULT_TIMEOUT_MS = 120_000;
const PROBE_TIMEOUT_MS = 2_000;

export class UpstreamClient {
  /**
   * @param {Object} options
   * @param {string} [options.baseUrl] loopback URL of the legacy server
   * @param {Function} [options.fetchImpl] injected for tests
   */
  constructor({ baseUrl = null, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.baseUrl = (baseUrl || process.env.C3_URL || 'http://127.0.0.1:3335').replace(/\/$/, '');
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  /** Cheap reachability check for /m1/health and /m1/capabilities. */
  async probe() {
    try {
      const response = await this._fetch('/api/health', { method: 'GET' }, PROBE_TIMEOUT_MS);
      if (!response.ok) return { reachable: false, reason: `upstream_status_${response.status}` };
      return { reachable: true };
    } catch (error) {
      return { reachable: false, reason: classify(error) };
    }
  }

  /**
   * @returns {Promise<{ok: true, data: Object}
   *                 |{ok: false, decided: boolean, code: string, status?: number}>}
   */
  async postChat({ conversationId, message }) {
    let response;
    try {
      response = await this._fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId, message }),
      });
    } catch (error) {
      // No response at all.  The request may still have been processed, so
      // this is ambiguous by definition.
      return { ok: false, decided: false, code: classify(error) };
    }

    if (response.status === 400) {
      // A validation refusal is a real decision: the upstream rejected the
      // request before doing anything with it.
      return { ok: false, decided: true, code: 'upstream_bad_request', status: 400 };
    }
    if (!response.ok) {
      // A 5xx can mean the handler died *after* persisting the user turn.
      // Treat it as ambiguous rather than assert nothing happened.
      return { ok: false, decided: false, code: `upstream_status_${response.status}`, status: response.status };
    }

    try {
      return { ok: true, data: await response.json() };
    } catch {
      // The upstream succeeded but we could not read the body — the effect
      // almost certainly happened, so this is not a rejection.
      return { ok: false, decided: false, code: 'upstream_unreadable_body' };
    }
  }

  /**
   * Narrow worker lifecycle command. The legacy server remains the owner of
   * AgentRepository + AgentScheduler; the gateway never mutates their tables
   * behind that live process.
   */
  async setWorkerEnabled({ id, expectedEnabled, enabled }) {
    const action = enabled ? 'enable' : 'disable';
    let response;
    try {
      response = await this._fetch(`/api/agents/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedEnabled }),
      });
    } catch (error) {
      return { ok: false, decided: false, code: classify(error) };
    }

    if ([400, 404, 409].includes(response.status)) {
      const code = response.status === 404
        ? 'worker_not_found'
        : response.status === 409 ? 'worker_state_conflict' : 'worker_request_invalid';
      return { ok: false, decided: true, code, status: response.status };
    }
    if (!response.ok) {
      return {
        ok: false,
        decided: false,
        code: `upstream_status_${response.status}`,
        status: response.status,
      };
    }

    try {
      const data = await response.json();
      const valid = data && data.ok === true
        && Object.keys(data).sort().join(',') === 'enabled,id,ok,previousEnabled'
        && data.id === id
        && data.enabled === enabled
        && data.previousEnabled === expectedEnabled;
      if (!valid) {
        return { ok: false, decided: false, code: 'upstream_unreadable_body' };
      }
      return {
        ok: true,
        data: { id: data.id, previousEnabled: data.previousEnabled, enabled: data.enabled },
      };
    } catch {
      return { ok: false, decided: false, code: 'upstream_unreadable_body' };
    }
  }

  async _fetch(path, init, timeoutMs = this.timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}

function classify(error) {
  if (error?.name === 'AbortError') return 'upstream_timeout';
  const cause = error?.cause?.code || error?.code;
  if (cause === 'ECONNREFUSED') return 'upstream_refused';
  if (cause === 'ENOTFOUND' || cause === 'EAI_AGAIN') return 'upstream_dns';
  if (cause === 'ECONNRESET') return 'upstream_reset';
  return 'upstream_unreachable';
}

/** Null upstream for boundary tests: reachable=false, every call ambiguous. */
export class OfflineUpstream {
  async probe() { return { reachable: false, reason: 'upstream_disabled' }; }
  async postChat() { return { ok: false, decided: false, code: 'upstream_disabled' }; }
  async setWorkerEnabled() { return { ok: false, decided: false, code: 'upstream_disabled' }; }
}

export default { UpstreamClient, OfflineUpstream };
