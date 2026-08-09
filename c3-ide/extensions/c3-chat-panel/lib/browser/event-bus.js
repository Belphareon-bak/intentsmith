// C3 Studio — Event Bus
// ══════════════════════════════════════════════════════════════════════════════
//
// Centrální event bus pro komunikaci mezi transport vrstvou a UI.
// Transport emituje, UI subscribuje. Žádné přímé renderXXX() volání z transportu.
//
// Events:
//   ws:ready           — WS handshake OK {version, features}
//   ws:disconnected    — WS connection lost {wasReady}
//   ws:reconnected     — reconnect + rehydrate settled {status, restoredCount, invalidCount, failedCount}
//   ws:reconnect_exhausted — bounded retry stopped {attempts, maxAttempts}
//   chat:message       — assistant response {sessionIdx, content, tag, metadata}
//   chat:system        — system message {sessionIdx, content}
//   agent:event        — agent event {sessionIdx, event}
//   terminal:output    — terminal data {sessionIdx, data}
//   workspace:change   — file watcher batch {data}
//   status:update      — context%, health {sessionIdx?, data?, health?}
//   session:changed    — session state changed {idx}
//   session:invalidated — complete ACK cleared exact session {idx, sessionRef, previousConversationId}
//   session:quarantined — malformed local identity preserved read-only {idx, sessionRef, sessionId}
//   session:identity_warning — uncorrelated legacy identity warning {sessionId}
//   edit:request       — ask-mode edit request {sessionIdx, event}
//   edit:resolved      — approve/reject done {reqId, action}
//
// ══════════════════════════════════════════════════════════════════════════════

"use strict";

var _listeners = {};

var C3Bus = {
  on: function(evt, fn) {
    if (!_listeners[evt]) _listeners[evt] = [];
    _listeners[evt].push(fn);
  },

  off: function(evt, fn) {
    if (!_listeners[evt]) return;
    _listeners[evt] = _listeners[evt].filter(function(f) { return f !== fn; });
  },

  emit: function(evt, data) {
    if (!_listeners[evt]) return;
    for (var i = 0; i < _listeners[evt].length; i++) {
      try {
        _listeners[evt][i](data);
      } catch (err) {
        console.error('[C3Bus] Error in listener for "' + evt + '":', err);
      }
    }
  },

  /* Debug: list all registered events */
  _debug: function() {
    var result = {};
    Object.keys(_listeners).forEach(function(k) {
      result[k] = _listeners[k].length;
    });
    return result;
  }
};

/* Export for CommonJS (Theia bundler) */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { C3Bus: C3Bus };
}
/* Also expose globally for cross-module access */
if (typeof window !== 'undefined') {
  window.C3Bus = C3Bus;
}
