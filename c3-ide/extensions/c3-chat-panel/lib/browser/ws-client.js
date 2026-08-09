// C3 Studio — WebSocket Client
// ══════════════════════════════════════════════════════════════════════════════
//
// WS transport layer: connect, handshake, reconnect, channel routing.
// Emits events to C3Bus, never calls render directly.
//
// Protocol (v1):
//   1. Connect to ws://host:port/c3/ws
//   2. Send {type:'hello', protocolVersion:1, ideVersion, features}
//   3. Receive hello_ack or hello_reject
//   4. Channel messages: {channel:'chat'|'agent'|'terminal'|'status'|'workspace'|'control', data:{...}}
//
// ══════════════════════════════════════════════════════════════════════════════

"use strict";

/* Globals expected: C3Bus (from event-bus.js), _sessions, _sessionActive, _backendBase, fetchBackendData */

var _wsReady = false;
var _serverVersion = null;
var _serverFeatures = [];
var _wsRetryCount = 0;
var _wsMaxRetry = 12;
var _wsRetryTimer = null;
var _wsDestroyed = false;
var _wsReconnectExhausted = false;
var _wsHandshakeTimer = null;
var _wsHandshakeTimeoutMs = 5000;
var _chatWs = null;
var _wsConnectionEpoch = 0;
var _rehydrateEpoch = 0;
var _pendingRehydrate = null;
var _rehydrateAckTimeoutMs = 5000;
var _rehydrateRequestCounter = 0;
/* Track which session made the last WS request — reliable fallback for routing */
var _lastSendSessionIdx = 0;
var _studioConversationCounter = 0;

function _isConversationId(value) {
  return typeof value === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function _createStudioConversationId() {
  _studioConversationCounter++;
  var randomPart = null;
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      randomPart = crypto.randomUUID();
    }
  } catch (e) {}
  if (!randomPart) {
    randomPart = Date.now().toString(36) + '-'
      + _studioConversationCounter.toString(36) + '-'
      + Math.random().toString(36).slice(2, 10);
  }
  return 'studio-' + randomPart;
}

function _selectConversationId(session) {
  if (!session || typeof session !== 'object') return null;
  if (_isConversationId(session._convId)) {
    return { conversationId: session._convId, isNew: false };
  }
  if (session._convId !== null && session._convId !== undefined && session._convId !== '') {
    return null;
  }
  return { conversationId: _createStudioConversationId(), isNew: true };
}

function _publishConversationId(session, sessionIdx, selected) {
  if (!selected || !selected.isNew) return;
  session._convId = selected.conversationId;
  session._rehydrateState = null;
  C3Bus.emit('session:identity', {
    idx: typeof sessionIdx === 'number' ? sessionIdx : null,
    conversationId: selected.conversationId
  });
}

/* ─── Session routing ─────────────────────────────────────────────────── */

function _routeToSession(data) {
  /* Route by terminal reqId (most reliable for terminal responses) */
  if (data.reqId && _termReqMap[data.reqId] !== undefined) {
    var termIdx = _termReqMap[data.reqId];
    /* Clean up on terminal completion */
    if (data.type === 'exec_result' || data.type === 'error') delete _termReqMap[data.reqId];
    return termIdx;
  }
  /* Route by conversationId (stable across restarts) */
  var convId = data.conversationId || (data.metadata && data.metadata.conversationId);
  if (convId && typeof _sessions !== 'undefined') {
    for (var i = 0; i < _sessions.length; i++) {
      if (_sessions[i]._convId === convId) return i;
    }
    /* convId present but no session matched — update the sender session's convId */
    if (typeof _sessions[_lastSendSessionIdx] !== 'undefined' && !_sessions[_lastSendSessionIdx]._convId) {
      _sessions[_lastSendSessionIdx]._convId = convId;
    }
  }
  /* Fallback: session that sent the last message (more reliable than _sessionActive) */
  return _lastSendSessionIdx;
}

/* ─── Rehydration after reconnect ─────────────────────────────────────── */

function _rehydrateBaseUrl() {
  return (typeof _backendBase !== 'undefined') ? _backendBase : (function(){try{if(typeof window!=='undefined'&&window.electronC3){var u=window.electronC3.getBackendUrl();if(u)return u;}}catch(e){}return 'http://127.0.0.1:3335';})();
}

function _isCurrentRehydrate(run) {
  return !!run
    && run.epoch === _rehydrateEpoch
    && run.connectionEpoch === _wsConnectionEpoch
    && run.socket === _chatWs;
}

function _createRehydrateRequestId(connectionEpoch, rehydrateEpoch) {
  _rehydrateRequestCounter++;
  var randomPart = null;
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      randomPart = crypto.randomUUID();
    }
  } catch (e) {}
  if (!randomPart) randomPart = Date.now().toString(36);
  return (
    'rehydrate-' + connectionEpoch + '-' + rehydrateEpoch + '-'
    + _rehydrateRequestCounter + '-' + randomPart
  ).slice(0, 128);
}

function _hasExactKeys(value, expectedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  var actualKeys = Object.keys(value).sort();
  var sortedExpected = expectedKeys.slice().sort();
  if (actualKeys.length !== sortedExpected.length) return false;
  for (var i = 0; i < actualKeys.length; i++) {
    if (actualKeys[i] !== sortedExpected[i]) return false;
  }
  return true;
}

function _snapshotSessionIsCurrent(snapshot) {
  return !!snapshot
    && typeof _sessions !== 'undefined'
    && snapshot.idx >= 0
    && snapshot.idx < _sessions.length
    && _sessions[snapshot.idx] === snapshot.session
    && snapshot.session
    && snapshot.session._convId === snapshot.conversationId;
}

function _emitRehydrateComplete(run, restoredCount, invalidCount, failedCount) {
  if (!_isCurrentRehydrate(run)) return;
  if (typeof fetchBackendData === 'function') {
    try { fetchBackendData(); } catch(e) {}
  }
  C3Bus.emit('ws:reconnected', {
    status: failedCount > 0 ? 'degraded' : 'ok',
    restoredCount: restoredCount,
    invalidCount: invalidCount,
    failedCount: failedCount
  });
}

function _clearInvalidSession(run, snapshot) {
  var s = snapshot.session;
  if (
    !_isCurrentRehydrate(run)
    || !_snapshotSessionIsCurrent(snapshot)
    || !_chatStateIsUnchanged(snapshot, snapshot.capturedChatState)
  ) return false;
  s._convId = null;
  s._agentId = null;
  s._label = '';
  s._rehydrateState = null;
  if (s.chat) {
    s.chat.msgs = [];
    s.chat._thinking = null;
  }
  C3Bus.emit('session:invalidated', {
    idx: snapshot.idx,
    sessionRef: s,
    previousConversationId: snapshot.conversationId
  });
  return true;
}

function _parseHistoryPayload(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.messages)) {
    return null;
  }
  var msgs = [];
  for (var i = 0; i < data.messages.length; i++) {
    var m = data.messages[i];
    if (!m || typeof m !== 'object' || typeof m.role !== 'string' || typeof m.content !== 'string') {
      return null;
    }
    var meta = null;
    if (m.metadata && typeof m.metadata === 'object' && !Array.isArray(m.metadata)) {
      meta = m.metadata;
    } else if (typeof m.metadata === 'string') {
      try { meta = JSON.parse(m.metadata); } catch(e) { meta = null; }
    }
    msgs.push({ role: m.role, text: m.content, tag: (meta && meta.mode) || 'LLM' });
  }
  return msgs;
}

function _captureChatState(snapshot) {
  if (!snapshot.session || !snapshot.session.chat || !Array.isArray(snapshot.session.chat.msgs)) {
    return null;
  }
  try {
    return {
      chat: snapshot.session.chat,
      messages: snapshot.session.chat.msgs,
      signature: JSON.stringify({
        messages: snapshot.session.chat.msgs,
        thinking: snapshot.session.chat._thinking
      })
    };
  } catch(e) {
    return null;
  }
}

function _chatStateIsUnchanged(snapshot, captured) {
  if (
    !captured
    || !_snapshotSessionIsCurrent(snapshot)
    || snapshot.session.chat !== captured.chat
    || snapshot.session.chat.msgs !== captured.messages
  ) return false;
  try {
    return JSON.stringify({
      messages: snapshot.session.chat.msgs,
      thinking: snapshot.session.chat._thinking
    }) === captured.signature;
  } catch(e) {
    return false;
  }
}

function _cancelPendingRehydrate(connectionEpoch) {
  if (_pendingRehydrate && _pendingRehydrate.connectionEpoch === connectionEpoch) {
    clearTimeout(_pendingRehydrate.timer);
    _pendingRehydrate = null;
  }
  _rehydrateEpoch++;
}

function _failPendingRehydrate(run) {
  if (!_isCurrentRehydrate(run)) return;
  clearTimeout(run.timer);
  if (_pendingRehydrate === run) _pendingRehydrate = null;
  _emitRehydrateComplete(
    run,
    0,
    0,
    run.snapshots.length + run.localQuarantinedCount
  );
}

function _rehydrateSessions(connectionEpoch, socket) {
  if (typeof _sessions === 'undefined') return;
  if (_pendingRehydrate) clearTimeout(_pendingRehydrate.timer);

  var rehydrateEpoch = ++_rehydrateEpoch;
  var run = {
    epoch: rehydrateEpoch,
    connectionEpoch: connectionEpoch,
    socket: socket,
    requestId: _createRehydrateRequestId(connectionEpoch, rehydrateEpoch),
    requestedIds: [],
    requestedSet: Object.create(null),
    snapshots: [],
    localQuarantinedCount: 0,
    timer: null
  };

  _sessions.forEach(function(s, idx) {
    if (!s || !s._convId) return;
    if (!_isConversationId(s._convId)) {
      s._rehydrateState = 'quarantined';
      run.localQuarantinedCount++;
      C3Bus.emit('session:quarantined', {
        idx: idx,
        sessionRef: s,
        sessionId: s._convId
      });
      return;
    }
    var snapshot = { session: s, idx: idx, conversationId: s._convId };
    snapshot.capturedChatState = _captureChatState(snapshot);
    run.snapshots.push(snapshot);
    if (!run.requestedSet[s._convId]) {
      run.requestedSet[s._convId] = true;
      run.requestedIds.push(s._convId);
    }
  });

  if (run.requestedIds.length === 0) {
    _pendingRehydrate = null;
    _emitRehydrateComplete(run, 0, 0, run.localQuarantinedCount);
    return;
  }
  if (run.requestedIds.length > 32) {
    _pendingRehydrate = null;
    _emitRehydrateComplete(
      run,
      0,
      0,
      run.snapshots.length + run.localQuarantinedCount
    );
    return;
  }
  if (!_isCurrentRehydrate(run) || !socket || socket.readyState !== 1) {
    _emitRehydrateComplete(
      run,
      0,
      0,
      run.snapshots.length + run.localQuarantinedCount
    );
    return;
  }

  run.timer = setTimeout(function() {
    _failPendingRehydrate(run);
  }, _rehydrateAckTimeoutMs);
  _pendingRehydrate = run;
  try {
    socket.send(JSON.stringify({
      channel: 'control',
      data: {
        action: 'rehydrate',
        rehydrateRequestId: run.requestId,
        conversationIds: run.requestedIds
      }
    }));
  } catch(e) {
    _failPendingRehydrate(run);
  }
}

function _handleRehydrateAck(data, connectionEpoch, socket) {
  var run = _pendingRehydrate;
  if (
    !run
    || !_isCurrentRehydrate(run)
    || run.connectionEpoch !== connectionEpoch
    || run.socket !== socket
  ) {
    return false;
  }
  if (data.rehydrateRequestId !== run.requestId) return false;

  function rejectMatchingMalformedAck() {
    clearTimeout(run.timer);
    if (_pendingRehydrate === run) _pendingRehydrate = null;
    _emitRehydrateComplete(
      run,
      0,
      0,
      run.snapshots.length + run.localQuarantinedCount
    );
    return true;
  }

  if (
    !_hasExactKeys(data, [
      'action',
      'rehydrateRequestId',
      'complete',
      'validIds',
      'invalidIds'
    ])
    || data.action !== 'rehydrate_ack'
    || data.complete !== true
    || !Array.isArray(data.validIds)
    || !Array.isArray(data.invalidIds)
  ) return rejectMatchingMalformedAck();

  var partitionSet = Object.create(null);
  var validSet = Object.create(null);
  var invalidSet = Object.create(null);
  var partitions = [
    { ids: data.validIds, target: validSet },
    { ids: data.invalidIds, target: invalidSet }
  ];
  for (var partitionIndex = 0; partitionIndex < partitions.length; partitionIndex++) {
    var partition = partitions[partitionIndex];
    for (var idIndex = 0; idIndex < partition.ids.length; idIndex++) {
      var id = partition.ids[idIndex];
      if (
        !_isConversationId(id)
        || !run.requestedSet[id]
        || partitionSet[id]
      ) return rejectMatchingMalformedAck();
      partitionSet[id] = true;
      partition.target[id] = true;
    }
  }
  if (Object.keys(partitionSet).length !== run.requestedIds.length) {
    return rejectMatchingMalformedAck();
  }

  clearTimeout(run.timer);
  _pendingRehydrate = null;

  var invalidCount = 0;
  var conflictedCount = 0;
  var validSnapshots = [];
  run.snapshots.forEach(function(snapshot) {
    if (validSet[snapshot.conversationId]) {
      if (_chatStateIsUnchanged(snapshot, snapshot.capturedChatState)) {
        validSnapshots.push(snapshot);
      } else {
        conflictedCount++;
      }
    } else if (invalidSet[snapshot.conversationId] && _clearInvalidSession(run, snapshot)) {
      invalidCount++;
    } else {
      conflictedCount++;
    }
  });

  var base = _rehydrateBaseUrl();
  var tasks = validSnapshots.map(function(snapshot) {
    return Promise.resolve().then(function() {
      return fetch(
        base + '/api/conversations/' + encodeURIComponent(snapshot.conversationId) + '/messages',
        { signal: AbortSignal.timeout(5000) }
      );
    }).then(function(response) {
      if (!response || response.ok !== true) throw new Error('rehydrate-http-failed');
      return response.json();
    }).then(function(payload) {
      var msgs = _parseHistoryPayload(payload);
      if (msgs === null) throw new Error('rehydrate-payload-invalid');
      if (
        !_isCurrentRehydrate(run)
        || snapshot.session._convId !== snapshot.conversationId
        || !_chatStateIsUnchanged(snapshot, snapshot.capturedChatState)
      ) {
        return false;
      }
      if (
        msgs.length === 0
        && (
          snapshot.session.chat.msgs.length > 0
          || snapshot.session.chat._thinking !== null
            && snapshot.session.chat._thinking !== undefined
        )
      ) {
        return false;
      }
      snapshot.session.chat.msgs = msgs;
      snapshot.session.chat._thinking = null;
      C3Bus.emit('session:changed', { idx: snapshot.idx });
      return true;
    }).catch(function() {
      return false;
    });
  });

  Promise.all(tasks).then(function(results) {
    if (!_isCurrentRehydrate(run)) return;
    var restoredCount = results.filter(function(value) { return value === true; }).length;
    _emitRehydrateComplete(
      run,
      restoredCount,
      invalidCount,
      run.localQuarantinedCount
        + conflictedCount
        + validSnapshots.length
        - restoredCount
    );
  });
  return true;
}

function _handleRehydrateReject(data, connectionEpoch, socket) {
  var run = _pendingRehydrate;
  if (
    !run
    || !_isCurrentRehydrate(run)
    || run.connectionEpoch !== connectionEpoch
    || run.socket !== socket
    || data.rehydrateRequestId !== run.requestId
  ) return false;

  var allowedReasons = {
    INVALID_CONVERSATION_SET: true,
    TOO_MANY_CONVERSATIONS: true,
    INVALID_CONVERSATION_ID: true,
    DUPLICATE_CONVERSATION_ID: true
  };
  if (
    !_hasExactKeys(data, ['action', 'rehydrateRequestId', 'reason'])
    || data.action !== 'rehydrate_reject'
    || allowedReasons[data.reason] !== true
  ) return false;

  clearTimeout(run.timer);
  _pendingRehydrate = null;
  _emitRehydrateComplete(
    run,
    0,
    0,
    run.snapshots.length + run.localQuarantinedCount
  );
  return true;
}

function _scheduleReconnect() {
  if (_wsDestroyed || _wsRetryTimer) return false;
  if (_wsRetryCount >= _wsMaxRetry) {
    if (!_wsReconnectExhausted) {
      _wsReconnectExhausted = true;
      C3Bus.emit('ws:reconnect_exhausted', {
        attempts: _wsRetryCount,
        maxAttempts: _wsMaxRetry
      });
    }
    return false;
  }

  var delay = Math.min(1000 * Math.pow(2, _wsRetryCount), 30000);
  _wsRetryCount++;
  _wsRetryTimer = setTimeout(function() {
    _wsRetryTimer = null;
    if (_wsDestroyed) return;
    _wsConnect();
  }, delay);
  return true;
}

function _clearHandshakeTimer() {
  if (_wsHandshakeTimer) clearTimeout(_wsHandshakeTimer);
  _wsHandshakeTimer = null;
}

function _closeFailedHandshake(connection, reason) {
  if (
    _wsDestroyed
    || !connection
    || connection.handshakeState !== 'PENDING'
    || connection.epoch !== _wsConnectionEpoch
    || connection.socket !== _chatWs
  ) {
    return;
  }
  connection.handshakeState = 'FAILED';
  _clearHandshakeTimer();
  _wsReady = false;
  try {
    connection.socket.close(4000, reason);
  } catch(e) {
    _scheduleReconnect();
  }
}

function _clearPendingEditsOnDisconnect() {
  Object.keys(_pendingEdits).forEach(function(k) {
    if (!_pendingEdits[k].resolved) {
      _pendingEdits[k].resolved = true;
      C3Bus.emit('edit:resolved', { reqId: k, action: 'disconnect' });
    }
  });
  _pendingEdits = {};
}

/* ─── Connect ─────────────────────────────────────────────────────────── */

function _wsConnect() {
  if (_wsDestroyed) return false;
  if (_wsRetryTimer) {
    clearTimeout(_wsRetryTimer);
    _wsRetryTimer = null;
  }
  _clearHandshakeTimer();
  _cancelPendingRehydrate(_wsConnectionEpoch);
  _wsReady = false;

  var _base = (typeof _backendBase !== 'undefined') ? _backendBase : (function(){try{if(typeof window!=='undefined'&&window.electronC3){var u=window.electronC3.getBackendUrl();if(u)return u;}}catch(e){}return 'http://127.0.0.1:3335';})();
  var wsUrl = _base.replace(/^http/, 'ws') + '/c3/ws';

  var connectionEpoch = ++_wsConnectionEpoch;
  var socket = null;
  var previousSocket = _chatWs;
  _chatWs = null;
  if (previousSocket && previousSocket.readyState !== 3) {
    _clearPendingEditsOnDisconnect();
    try { previousSocket.close(); } catch(e) {}
  }
  try {
    var _localCapability = null;
    try {
      if (typeof window !== 'undefined' && window.electronC3) {
        _localCapability = window.electronC3.getLocalCapability();
      }
    } catch (e) {}
    socket = _localCapability
      ? new WebSocket(wsUrl, ['c3-v1', 'c3-local-v1.' + _localCapability])
      : new WebSocket(wsUrl);
    _chatWs = socket;
  } catch (e) {
    console.error('[C3 WS] Failed to create WebSocket.');
    _scheduleReconnect();
    return false;
  }
  var connection = {
    epoch: connectionEpoch,
    handshakeState: 'PENDING',
    socket: socket
  };

  socket.onopen = function() {
    if (
      connection.handshakeState !== 'PENDING'
      || connectionEpoch !== _wsConnectionEpoch
      || socket !== _chatWs
    ) return;
    /* Hello handshake */
    try {
      socket.send(JSON.stringify({
        type: 'hello',
        protocolVersion: 1,
        ideVersion: 'c3-studio-0.2.0',
        features: ['workspace', 'terminal', 'merge-preview', 'edit-ask', 'audit']
      }));
    } catch(e) {
      _closeFailedHandshake(connection, 'Handshake send failed');
    }
  };

  socket.onclose = function() {
    if (connectionEpoch !== _wsConnectionEpoch || socket !== _chatWs) return;
    if (_wsDestroyed) return;
    connection.handshakeState = 'CLOSED';
    _clearHandshakeTimer();
    var wasReady = _wsReady;
    _wsReady = false;
    _cancelPendingRehydrate(connectionEpoch);

    /* Clear stale pending edits — backend session is gone */
    _clearPendingEditsOnDisconnect();

    C3Bus.emit('ws:disconnected', { wasReady: wasReady });

    _scheduleReconnect();
  };

  socket.onerror = function() { /* onclose handles reconnect */ };

  socket.onmessage = function(e) {
    if (connectionEpoch !== _wsConnectionEpoch || socket !== _chatWs) return;
    if (connection.handshakeState === 'FAILED' || connection.handshakeState === 'CLOSED') return;
    var msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }

    /* ═══ Handshake phase ═══ */
    if (msg.type === 'hello_ack') {
      if (connection.handshakeState !== 'PENDING') return;
      connection.handshakeState = 'ACCEPTED';
      _clearHandshakeTimer();
      _wsReady = true;
      _wsRetryCount = 0;
      _wsReconnectExhausted = false;
      _serverVersion = msg.serverVersion || msg.backendVersion || null;
      _serverFeatures = msg.features || [];
      console.log('[C3 WS] Handshake OK — server v' + _serverVersion + ' features=' + JSON.stringify(_serverFeatures));
      C3Bus.emit('ws:ready', { version: _serverVersion, features: _serverFeatures });
      _rehydrateSessions(connectionEpoch, socket);
      return;
    }
    if (msg.type === 'hello_reject') {
      if (connection.handshakeState !== 'PENDING') return;
      console.error('[C3 WS] Handshake rejected:', msg.reason);
      _closeFailedHandshake(connection, 'Handshake rejected');
      return;
    }
    if (connection.handshakeState !== 'ACCEPTED') return;

    /* ═══ Post-handshake: channel routing ═══ */
    var d = msg.data || {};
    /* Identity-authority frames must never pass through generic routing first. */
    if (msg.channel === 'control' && d.action === 'rehydrate_ack') {
      _handleRehydrateAck(d, connectionEpoch, socket);
      return;
    }
    if (msg.channel === 'control' && d.action === 'rehydrate_reject') {
      _handleRehydrateReject(d, connectionEpoch, socket);
      return;
    }
    if (msg.channel === 'control' && d.action === 'session_invalid') {
      /* Legacy notification has no complete request-bound authority. */
      C3Bus.emit('session:identity_warning', {
        sessionId: d.sessionId || d.conversationId || null
      });
      return;
    }
    var si = _routeToSession(d);

    switch (msg.channel) {
      case 'chat':
        if (d.type === 'assistant') {
          C3Bus.emit('chat:message', {
            sessionIdx: si,
            content: d.content,
            tag: (d.metadata && d.metadata.mode) || 'LLM',
            metadata: d.metadata || {}
          });
        } else if (d.type === 'system') {
          C3Bus.emit('chat:system', { sessionIdx: si, content: d.content });
        }
        break;

      case 'agent':
        C3Bus.emit('agent:event', { sessionIdx: si, event: d });
        if (d.type === 'edit_request') {
          C3Bus.emit('edit:request', { sessionIdx: si, event: d });
        }
        break;

      case 'terminal':
        C3Bus.emit('terminal:output', { sessionIdx: si, data: d });
        break;

      case 'status':
        C3Bus.emit('status:update', { sessionIdx: si, data: d });
        break;

      case 'workspace':
        C3Bus.emit('workspace:change', { data: d });
        break;

      case 'control':
        if (d.action === 'model_pull_progress') {
          C3Bus.emit('model:pull_progress', d);
        } else if (d.action === 'model_validation_progress') {
          C3Bus.emit('model:validation_progress', d);
        } else if (d.action === 'model_changed') {
          C3Bus.emit('model:changed', d);
        } else if (d.action === 'upgrade_progress') {
          C3Bus.emit('upgrade:progress', d);
        } else if (d.action === 'upgrade_error') {
          C3Bus.emit('upgrade:error', d);
        } else if (d.action === 'upgrade_verify_failed') {
          C3Bus.emit('upgrade:verify_failed', d);
        } else if (d.action === 'model_validation_prompt') {
          C3Bus.emit('model:validation_prompt', d);
        } else if (d.action === 'comfyui_progress') {
          C3Bus.emit('comfyui:progress', d);
        } else if (d.action === 'comfyui_complete') {
          C3Bus.emit('comfyui:complete', d);
        } else if (d.action === 'comfyui_error') {
          C3Bus.emit('comfyui:error', d);
        } else if (d.action === 'vram_state') {
          C3Bus.emit('vram:state', d);
        } else if (d.action === 'model_deleted') {
          C3Bus.emit('model:deleted', d);
        } else if (d.action === 'model_auto_cleaned') {
          C3Bus.emit('model:auto_cleaned', d);
        } else if (d.action === 'model_auto_rebound') {
          C3Bus.emit('model:auto_rebound', d);
        } else if (d.action === 'governor_report') {
          C3Bus.emit('governor:report', d);
        }
        break;
    }
  };
  _wsHandshakeTimer = setTimeout(function() {
    _wsHandshakeTimer = null;
    _closeFailedHandshake(connection, 'Handshake timeout');
  }, _wsHandshakeTimeoutMs);
  return true;
}

/* ─── Send helpers ────────────────────────────────────────────────────── */

function wsSend(channel, data) {
  if (_chatWs && _chatWs.readyState === 1 && _wsReady) {
    _chatWs.send(JSON.stringify({ channel: channel, data: data }));
    return true;
  }
  return false;
}

function wsSendChat(content, session, sessionIdx) {
  var selected = _selectConversationId(session);
  if (!selected) return false;
  var payload = {
    content: content,
    conversationId: selected.conversationId,
    editMode: session.chat.editMode || 'auto',
    agentId: session._agentId || null,
    projectId: session._projectId || null
  };
  if (session.chat._pendingAttachments) payload.attachments = session.chat._pendingAttachments;
  if (!wsSend('chat', payload)) return false;
  /* Identity becomes authoritative only after the frame entered the local socket. */
  _publishConversationId(session, sessionIdx, selected);
  /* Track sender session for reliable routing of response. */
  if (typeof sessionIdx === 'number') _lastSendSessionIdx = sessionIdx;
  return true;
}

/* Track terminal reqId → sessionIdx for reliable response routing */
var _termReqMap = {};  // reqId → sessionIdx

function wsSendTerminal(command, session, sessionIdx) {
  /* Track sender session (same pattern as wsSendChat) */
  if (typeof sessionIdx === 'number') _lastSendSessionIdx = sessionIdx;
  var reqId = 'term-' + Date.now();
  if (typeof sessionIdx === 'number') _termReqMap[reqId] = sessionIdx;
  // Pass project cwd so terminal executes in project dir, not backend cwd
  var cwd = (typeof window !== 'undefined' && window._wtRoot) ? window._wtRoot : undefined;
  return wsSend('terminal', {
    type: 'exec',
    command: command,
    reqId: reqId,
    conversationId: session._convId || null,
    cwd: cwd
  });
}

function wsSendCancel(session) {
  var conversationId = session && _isConversationId(session._convId)
    ? session._convId
    : null;
  if (!conversationId) return false;
  return wsSend('control', { action: 'cancel', conversationId: conversationId });
}

function wsSendEditApprove(reqId) {
  return wsSend('control', { action: 'edit_approve', requestId: reqId });
}

function wsSendEditReject(reqId) {
  return wsSend('control', { action: 'edit_reject', requestId: reqId });
}

// v85: Sync feature settings to backend (hot-toggle)
function wsSendSyncSettings(settings) {
  return wsSend('control', { action: 'sync_settings', settings: settings });
}

function wsIsReady() { return _wsReady; }
function wsServerVersion() { return _serverVersion; }
function wsServerFeatures() { return _serverFeatures; }
function wsHasFeature(f) { return _serverFeatures.indexOf(f) >= 0; }
function wsDestroy() {
  _wsDestroyed = true;
  if (_wsRetryTimer) clearTimeout(_wsRetryTimer);
  _wsRetryTimer = null;
  _clearHandshakeTimer();
  _wsReady = false;
  _clearPendingEditsOnDisconnect();
  _cancelPendingRehydrate(_wsConnectionEpoch);
  _wsConnectionEpoch++;
  var socket = _chatWs;
  _chatWs = null;
  if (socket) { try { socket.close(); } catch(e) {} }
}

/* ─── Edit ACK tracking ───────────────────────────────────────────────── */

var _pendingEdits = {};

function trackEditRequest(reqId, file, diff, sessionIdx) {
  _pendingEdits[reqId] = { file: file, diff: diff, sessionIdx: sessionIdx, timestamp: Date.now(), resolved: false };
}

function approveEdit(reqId) {
  var pe = _pendingEdits[reqId];
  if (!pe || pe.resolved) return;
  pe.resolved = true;
  wsSendEditApprove(reqId);
  C3Bus.emit('edit:resolved', { reqId: reqId, action: 'approve' });
  delete _pendingEdits[reqId];
}

function rejectEdit(reqId) {
  var pe = _pendingEdits[reqId];
  if (!pe || pe.resolved) return;
  pe.resolved = true;
  wsSendEditReject(reqId);
  C3Bus.emit('edit:resolved', { reqId: reqId, action: 'reject' });
  delete _pendingEdits[reqId];
}

function cleanupSessionEdits(sessionIdx) {
  Object.keys(_pendingEdits).forEach(function(k) {
    if (_pendingEdits[k].sessionIdx === sessionIdx && !_pendingEdits[k].resolved) {
      rejectEdit(k);
    }
  });
}

/* Timeout: auto-reject stale edit requests (30s) */
setInterval(function() {
  var now = Date.now();
  Object.keys(_pendingEdits).forEach(function(k) {
    if (!_pendingEdits[k].resolved && now - _pendingEdits[k].timestamp > 30000) {
      rejectEdit(k);
    }
  });
}, 5000);

/* ─── Exports ─────────────────────────────────────────────────────────── */

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    wsConnect: _wsConnect,
    wsSend: wsSend,
    wsSendChat: wsSendChat,
    wsSendTerminal: wsSendTerminal,
    wsSendCancel: wsSendCancel,
    wsSendSyncSettings: wsSendSyncSettings,
    wsIsReady: wsIsReady,
    wsServerVersion: wsServerVersion,
    wsServerFeatures: wsServerFeatures,
    wsHasFeature: wsHasFeature,
    wsDestroy: wsDestroy,
    trackEditRequest: trackEditRequest,
    approveEdit: approveEdit,
    rejectEdit: rejectEdit,
    cleanupSessionEdits: cleanupSessionEdits
  };
}
if (typeof window !== 'undefined') {
  window.C3WS = {
    connect: _wsConnect,
    send: wsSend,
    sendChat: wsSendChat,
    sendTerminal: wsSendTerminal,
    sendCancel: wsSendCancel,
    syncSettings: wsSendSyncSettings,
    isReady: wsIsReady,
    serverVersion: wsServerVersion,
    serverFeatures: wsServerFeatures,
    hasFeature: wsHasFeature,
    destroy: wsDestroy,
    trackEditRequest: trackEditRequest,
    approveEdit: approveEdit,
    rejectEdit: rejectEdit,
    cleanupSessionEdits: cleanupSessionEdits
  };
}
