// C3 Studio — Terminal Client
// ══════════════════════════════════════════════════════════════════════════════
//
// Terminal WS channel handler: send commands, track running state,
// prevent command spam with execution lock.
//
// Subscribes to C3Bus 'terminal:output' for exec_result/error unlock.
// Emits 'terminal:line' with formatted terminal entries.
//
// ══════════════════════════════════════════════════════════════════════════════

"use strict";

/* Globals expected: C3Bus (from event-bus.js), _sessions, C3WS (from ws-client.js) */

var _termExecuting = {};  // sessionIdx → boolean

/* ─── Send command ────────────────────────────────────────────────────── */

function termSend(sessionIdx, command) {
  if (_termExecuting[sessionIdx]) return false;  // lock — nelze spamovat

  var sessions = (typeof _sessions !== 'undefined') ? _sessions : [];
  var s = sessions[sessionIdx];
  if (!s) return false;

  _termExecuting[sessionIdx] = true;

  /* Local echo */
  var entry = {
    text: '$ ' + command,
    ts: new Date().toISOString(),
    accent: false,
    type: 'input'
  };
  s.term.push(entry);
  C3Bus.emit('terminal:line', { sessionIdx: sessionIdx, entry: entry });

  /* Send via WS (pass sessionIdx for routing) */
  if (typeof C3WS !== 'undefined') {
    C3WS.sendTerminal(command, s, sessionIdx);
  } else if (typeof wsSendTerminal === 'function') {
    wsSendTerminal(command, s, sessionIdx);
  }

  return true;
}

/* ─── Bus subscriber ──────────────────────────────────────────────────── */

function initTerminalClient() {
  if (typeof C3Bus === 'undefined') {
    console.error('[C3 Terminal] C3Bus not available');
    return;
  }

  C3Bus.on('terminal:output', function(ev) {
    var sessionIdx = ev.sessionIdx;
    var d = ev.data || {};

    var sessions = (typeof _sessions !== 'undefined') ? _sessions : [];
    var s = sessions[sessionIdx];
    if (!s) return;

    /* exec_start — backend confirms execution (no duplicate echo) */
    if (d.type === 'exec_start') {
      _termExecuting[sessionIdx] = true;
      return;
    }

    /* exec_result — command output + unlock */
    if (d.type === 'exec_result') {
      var lines = (d.output || d.stdout || '').split('\n');
      lines.forEach(function(line) {
        if (line === '' && lines.length === 1) return;
        var lineEntry = {
          text: line,
          ts: d.timestamp || new Date().toISOString(),
          accent: false,
          type: 'output'
        };
        s.term.push(lineEntry);
      });

      /* stderr */
      if (d.stderr) {
        d.stderr.split('\n').forEach(function(line) {
          if (!line) return;
          var errEntry = {
            text: line,
            ts: d.timestamp || new Date().toISOString(),
            accent: true,
            type: 'stderr'
          };
          s.term.push(errEntry);
        });
      }

      /* Exit code */
      if (d.exitCode !== undefined && d.exitCode !== 0) {
        var exitEntry = {
          text: '[exit ' + d.exitCode + ']',
          ts: d.timestamp || new Date().toISOString(),
          accent: true,
          type: 'exit'
        };
        s.term.push(exitEntry);
      }

      /* Prompt */
      s.term.push({ text: '$ ', ts: new Date().toISOString(), type: 'prompt' });

      _termExecuting[sessionIdx] = false;
      C3Bus.emit('terminal:line', { sessionIdx: sessionIdx, entry: null, done: true });
      if (typeof renderAgent === 'function') renderAgent();
      return;
    }

    /* error — unlock */
    if (d.type === 'error') {
      var errEntry2 = {
        text: '[ERROR] ' + (d.message || d.error || 'Neznámá chyba'),
        ts: d.timestamp || new Date().toISOString(),
        accent: true,
        type: 'error'
      };
      s.term.push(errEntry2);
      s.term.push({ text: '$ ', ts: new Date().toISOString(), type: 'prompt' });

      _termExecuting[sessionIdx] = false;
      C3Bus.emit('terminal:line', { sessionIdx: sessionIdx, entry: errEntry2, done: true });
      if (typeof renderAgent === 'function') renderAgent();
      return;
    }

    /* stream — real-time output chunks */
    if (d.type === 'stream' || d.type === 'stdout') {
      var streamEntry = {
        text: d.data || d.text || '',
        ts: d.timestamp || new Date().toISOString(),
        accent: false,
        type: 'stream'
      };
      s.term.push(streamEntry);
      C3Bus.emit('terminal:line', { sessionIdx: sessionIdx, entry: streamEntry });
      return;
    }

    /* Generic terminal data (fallback) */
    if (d.text || d.content) {
      var genericEntry = {
        text: d.text || d.content,
        ts: d.timestamp || new Date().toISOString(),
        accent: !!d.accent,
        type: d.type || 'output'
      };
      s.term.push(genericEntry);
      C3Bus.emit('terminal:line', { sessionIdx: sessionIdx, entry: genericEntry });
    }
  });
}

/* ─── Helpers ─────────────────────────────────────────────────────────── */

function isTermExecuting(sessionIdx) {
  return !!_termExecuting[sessionIdx];
}

function termCancel(sessionIdx) {
  _termExecuting[sessionIdx] = false;
  var sessions = (typeof _sessions !== 'undefined') ? _sessions : [];
  var s = sessions[sessionIdx];
  if (s) {
    s.term.push({
      text: '^C',
      ts: new Date().toISOString(),
      accent: true,
      type: 'cancel'
    });
    s.term.push({ text: '$ ', ts: new Date().toISOString(), type: 'prompt' });
  }
}

/* ─── Exports ─────────────────────────────────────────────────────────── */

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    initTerminalClient: initTerminalClient,
    termSend: termSend,
    termCancel: termCancel,
    isTermExecuting: isTermExecuting
  };
}
if (typeof window !== 'undefined') {
  window.C3Terminal = {
    init: initTerminalClient,
    send: termSend,
    cancel: termCancel,
    isExecuting: isTermExecuting
  };
}
