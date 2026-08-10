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

/* Generated during the mandatory Studio prebuild. Missing runtime validation
   is a build failure, never a permissive legacy fallback. */
var _m1Protocol = require('@c3/protocol');
if (
  !_m1Protocol
  || _m1Protocol.M1_CONTRACT_VERSION !== 1
  || typeof _m1Protocol.validateM1Contract !== 'function'
  || typeof _m1Protocol.validateCoreEventStream !== 'function'
  || typeof _m1Protocol.classifyTerminal !== 'function'
) {
  throw new Error('Generated @c3/protocol M1 runtime is unavailable');
}

var _wsReady = false;
var _serverVersion = null;
var _serverFeatures = [];
var _m1WireFeature = 'm1-wire-v1';
var _m1WireNegotiated = false;
var _m1AttachmentPolicy = null;
var _m1LastSendRejection = null;
var _m1WireMetadataVersion = 1;
var _m1InlineImageMimeTypes = Object.freeze([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
  'image/bmp', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/tiff', 'image/avif'
]);
var _clientFeatures = Object.freeze([
  'workspace', 'terminal', 'merge-preview', 'edit-ask', 'audit', _m1WireFeature
]);
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
var _m1IdentityCounter = 0;
var _m1Ledger = Object.create(null);
var _m1LedgerOrder = [];
var _m1ProtocolFailedEpoch = null;
var _m1LedgerLimit = 256;
var _m1MaxEventsPerTurn = 256;
var _m1MaxSerializedBytesPerTurn = 1048576;

function _m1Utf8ByteLength(value) {
  var bytes = 0;
  for (var index = 0; index < value.length; index++) {
    var codeUnit = value.charCodeAt(index);
    if (codeUnit < 0x80) {
      bytes += 1;
    } else if (codeUnit < 0x800) {
      bytes += 2;
    } else if (
      codeUnit >= 0xd800
      && codeUnit <= 0xdbff
      && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xdc00
      && value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index++;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

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

function _createM1Identity(prefix) {
  _m1IdentityCounter++;
  var randomPart = null;
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      randomPart = crypto.randomUUID();
    }
  } catch (e) {}
  if (!randomPart) {
    randomPart = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  return (
    prefix + '-' + _m1IdentityCounter.toString(36) + '-' + randomPart
  ).slice(0, 128);
}

function _normalizeM1ContextIdentifier(value) {
  if (value === null || value === undefined || value === '') return null;
  var normalized = String(value);
  return _isConversationId(normalized) ? normalized : undefined;
}

function _rejectM1Send(reason, retryable) {
  _m1LastSendRejection = Object.freeze({
    status: 'NOT_SENT',
    retryable: retryable === true,
    reason: reason,
    serverAcknowledged: false
  });
  return false;
}

function _m1Base64Value(character) {
  var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  return alphabet.indexOf(character);
}

function _m1CanonicalBase64ByteLength(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) return null;
  var padding = value.endsWith('==') ? 2 : (value.endsWith('=') ? 1 : 0);
  if (
    (padding === 2 && (_m1Base64Value(value.charAt(value.length - 3)) & 15) !== 0)
    || (padding === 1 && (_m1Base64Value(value.charAt(value.length - 2)) & 3) !== 0)
  ) return null;
  return (value.length / 4) * 3 - padding;
}

function _normalizeM1Attachments(attachments) {
  var policy = _m1AttachmentPolicy;
  if (!policy) return { valid: false, reason: 'M1_ATTACHMENT_POLICY_UNAVAILABLE' };
  if (attachments === null || attachments === undefined) attachments = [];
  if (!Array.isArray(attachments)) {
    return { valid: false, reason: 'M1_ATTACHMENT_STATE_INVALID' };
  }
  if (attachments.length > policy.maxCount) {
    return { valid: false, reason: 'M1_ATTACHMENT_COUNT_EXCEEDED' };
  }
  var aggregateBytes = 0;
  var normalized = [];
  for (var index = 0; index < attachments.length; index++) {
    var attachment = attachments[index];
    if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) {
      return { valid: false, reason: 'M1_ATTACHMENT_INPUT_INVALID' };
    }
    if (attachment.path !== null && attachment.path !== undefined) {
      return { valid: false, reason: 'M1_ATTACHMENT_PATH_FORBIDDEN' };
    }
    if (
      typeof attachment.name !== 'string'
      || attachment.name.length < 1
      || attachment.name.length > 255
      || attachment.name !== attachment.name.trim()
      || /[\\/\u0000-\u001f\u007f]/.test(attachment.name)
    ) return { valid: false, reason: 'M1_ATTACHMENT_NAME_INVALID' };
    if (attachment.type !== 'text' && attachment.type !== 'image') {
      return { valid: false, reason: 'M1_ATTACHMENT_TYPE_UNSUPPORTED' };
    }
    if (typeof attachment.content !== 'string') {
      return { valid: false, reason: 'M1_ATTACHMENT_CONTENT_UNAVAILABLE' };
    }

    var decodedBytes;
    if (attachment.type === 'text') {
      decodedBytes = _m1Utf8ByteLength(attachment.content);
      if (decodedBytes > policy.maxTextBytes) {
        return { valid: false, reason: 'M1_ATTACHMENT_TEXT_TOO_LARGE' };
      }
    } else {
      var match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(attachment.content);
      if (!match || policy.imageMimeTypes.indexOf(match[1]) < 0) {
        return { valid: false, reason: 'M1_ATTACHMENT_IMAGE_INVALID' };
      }
      decodedBytes = _m1CanonicalBase64ByteLength(match[2]);
      if (decodedBytes === null || decodedBytes === 0) {
        return { valid: false, reason: 'M1_ATTACHMENT_IMAGE_INVALID' };
      }
      if (decodedBytes > policy.maxImageBytes) {
        return { valid: false, reason: 'M1_ATTACHMENT_IMAGE_TOO_LARGE' };
      }
    }
    aggregateBytes += decodedBytes;
    if (aggregateBytes > policy.maxAggregateBytes) {
      return { valid: false, reason: 'M1_ATTACHMENT_AGGREGATE_TOO_LARGE' };
    }
    normalized.push({
      name: attachment.name,
      type: attachment.type,
      content: attachment.content
    });
  }
  return { valid: true, attachments: normalized };
}

function _createM1Context(session) {
  if (!session || !session.chat) {
    _rejectM1Send('M1_CONTEXT_INVALID', false);
    return null;
  }
  var attachments = _normalizeM1Attachments(session.chat._pendingAttachments);
  if (!attachments.valid) {
    _rejectM1Send(attachments.reason, false);
    return null;
  }
  var agentId = _normalizeM1ContextIdentifier(session._agentId);
  var projectId = _normalizeM1ContextIdentifier(session._projectId);
  if (agentId === undefined || projectId === undefined) {
    _rejectM1Send('M1_CONTEXT_INVALID', false);
    return null;
  }
  var editMode = session.chat.editMode || 'auto';
  if (editMode !== 'auto' && editMode !== 'ask') {
    _rejectM1Send('M1_CONTEXT_INVALID', false);
    return null;
  }
  return {
    editMode: editMode,
    agentId: agentId,
    projectId: projectId,
    attachments: attachments.attachments
  };
}

function _m1SessionStillOwns(entry) {
  if (!entry || typeof _sessions === 'undefined' || !entry.session) return false;
  var currentIndex = _sessions.indexOf(entry.session);
  if (currentIndex < 0 || entry.session._convId !== entry.conversationId) return false;
  entry.sessionIdx = currentIndex;
  return true;
}

function _emitM1LocalTerminal(entry, status, code, message) {
  if (!_m1SessionStillOwns(entry)) return;
  C3Bus.emit('chat:terminal', {
    sessionIdx: entry.sessionIdx,
    action: entry.action,
    requestId: entry.requestId,
    conversationId: entry.conversationId,
    turnId: entry.turnId,
    status: status,
    renderAssistant: false,
    result: {
      status: status,
      error: { code: code, message: message }
    }
  });
}

function _trimM1Ledger(maxEntries) {
  while (_m1LedgerOrder.length > maxEntries) {
    var removableIndex = -1;
    for (var index = 0; index < _m1LedgerOrder.length; index++) {
      var candidate = _m1Ledger[_m1LedgerOrder[index]];
      if (!candidate || candidate.terminalStatus !== null) {
        removableIndex = index;
        break;
      }
    }
    if (removableIndex < 0) return false;
    var requestId = _m1LedgerOrder.splice(removableIndex, 1)[0];
    delete _m1Ledger[requestId];
  }
  return true;
}

function _registerM1Turn(entry) {
  if (_m1Ledger[entry.requestId]) return false;
  _trimM1Ledger(_m1LedgerLimit - 1);
  if (_m1LedgerOrder.length >= _m1LedgerLimit) return false;
  _m1Ledger[entry.requestId] = entry;
  _m1LedgerOrder.push(entry.requestId);
  return true;
}

function _removeM1Turn(requestId) {
  delete _m1Ledger[requestId];
  var index = _m1LedgerOrder.indexOf(requestId);
  if (index >= 0) _m1LedgerOrder.splice(index, 1);
}

function _interruptM1Turns(connectionEpoch, code, message) {
  _m1LedgerOrder.slice().forEach(function(requestId) {
    var entry = _m1Ledger[requestId];
    if (!entry || entry.connectionEpoch !== connectionEpoch) return;
    if (entry.terminalStatus === null) {
      entry.terminalStatus = 'error';
      _emitM1LocalTerminal(entry, 'error', code, message);
    }
    _removeM1Turn(requestId);
  });
}

function _failM1Protocol(connectionEpoch, socket, reason) {
  if (_m1ProtocolFailedEpoch === connectionEpoch) return;
  _m1ProtocolFailedEpoch = connectionEpoch;
  _interruptM1Turns(
    connectionEpoch,
    'M1_PROTOCOL_ERROR',
    'The negotiated event stream was rejected: ' + reason
  );
  try { socket.close(1008, 'Invalid M1 event stream'); } catch(e) {}
}

function _handleM1CoreEvent(event, connectionEpoch, socket) {
  var validation = _m1Protocol.validateM1Contract(event, 'CoreEvent');
  if (!validation || validation.valid !== true) {
    _failM1Protocol(connectionEpoch, socket, 'invalid-core-event');
    return true;
  }
  var entry = _m1Ledger[event.requestId];
  if (
    !entry
    || entry.connectionEpoch !== connectionEpoch
    || entry.socket !== socket
    || entry.conversationId !== event.conversationId
    || entry.turnId !== event.turnId
  ) {
    _failM1Protocol(connectionEpoch, socket, 'foreign-identity');
    return true;
  }
  if (entry.terminalStatus !== null) {
    _failM1Protocol(connectionEpoch, socket, 'event-after-terminal');
    return true;
  }
  if (!Number.isSafeInteger(event.sequence) || event.sequence <= entry.lastSequence) {
    _failM1Protocol(connectionEpoch, socket, 'out-of-order-sequence');
    return true;
  }

  var serializedEvent;
  try { serializedEvent = JSON.stringify(event); } catch (e) {
    _failM1Protocol(connectionEpoch, socket, 'unserializable-core-event');
    return true;
  }
  var serializedBytes = _m1Utf8ByteLength(serializedEvent);
  if (
    entry.events.length >= _m1MaxEventsPerTurn
    || serializedBytes > _m1MaxSerializedBytesPerTurn - entry.serializedBytes
  ) {
    _failM1Protocol(connectionEpoch, socket, 'core-event-stream-limit');
    return true;
  }
  if (
    event.phase === 'terminal'
    && entry.action === 'cancel'
    && event.terminalStatus === 'cancelled'
  ) {
    var target = _m1Ledger[entry.targetRequestId];
    if (
      !target
      || target.conversationId !== entry.conversationId
      || target.turnId !== entry.targetTurnId
      || target.terminalStatus !== 'cancelled'
    ) {
      _failM1Protocol(connectionEpoch, socket, 'cancel-terminal-before-target');
      return true;
    }
  }

  entry.events.push(event);
  entry.serializedBytes += serializedBytes;
  entry.lastSequence = event.sequence;
  if (event.phase === 'progress') {
    if (_m1SessionStillOwns(entry)) {
      var legacyEvent = {
        id: 'm1-' + event.requestId + '-' + event.sequence,
        seq: event.sequence,
        turnId: event.turnId,
        conversationId: event.conversationId,
        transport: 'm1',
        type: event.eventType,
        payload: event.payload
      };
      C3Bus.emit('agent:event', { sessionIdx: entry.sessionIdx, event: legacyEvent });
      if (event.eventType === 'edit_request') {
        C3Bus.emit('edit:request', { sessionIdx: entry.sessionIdx, event: legacyEvent });
      }
    }
    return true;
  }

  var stream = _m1Protocol.validateCoreEventStream(entry.events);
  var terminal = _m1Protocol.classifyTerminal(event.payload.result, {
    allowPartial: true,
    priorStatus: entry.terminalStatus,
    responseKind: 'conversation'
  });
  if (!stream || stream.valid !== true || !terminal || terminal.valid !== true) {
    _failM1Protocol(connectionEpoch, socket, 'invalid-terminal-stream');
    return true;
  }
  entry.terminalStatus = terminal.status;
  if (_m1SessionStillOwns(entry)) {
    C3Bus.emit('chat:terminal', {
      sessionIdx: entry.sessionIdx,
      action: entry.action,
      requestId: entry.requestId,
      conversationId: entry.conversationId,
      turnId: entry.turnId,
      status: terminal.status,
      renderAssistant: terminal.renderAssistant === true,
      result: event.payload.result
    });
  }
  /* A terminal tombstone keeps only ordering/identity. Full event history and
     the pane reference are not retained in the bounded connection ledger. */
  entry.events = [];
  entry.serializedBytes = 0;
  entry.session = null;
  entry.socket = null;
  _trimM1Ledger(_m1LedgerLimit);
  return true;
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

function _isPositiveSafeInteger(value) {
  return typeof value === 'number'
    && isFinite(value)
    && Math.floor(value) === value
    && value > 0
    && value <= Number.MAX_SAFE_INTEGER;
}

function _readM1AttachmentPolicy(helloAck) {
  if (!helloAck || !_hasExactKeys(helloAck.featureMetadata, [_m1WireFeature])) return null;
  var metadata = helloAck.featureMetadata[_m1WireFeature];
  if (!_hasExactKeys(metadata, ['version', 'attachmentPolicy'])) return null;
  if (metadata.version !== _m1WireMetadataVersion) return null;
  var policy = metadata.attachmentPolicy;
  if (!_hasExactKeys(policy, [
    'version', 'mode', 'maxCount', 'maxTextBytes', 'maxImageBytes',
    'maxAggregateBytes', 'maxFrameBytes', 'imageMimeTypes'
  ])) return null;
  if (policy.version !== _m1WireMetadataVersion || policy.mode !== 'inline-only') return null;
  if (![
    policy.maxCount,
    policy.maxTextBytes,
    policy.maxImageBytes,
    policy.maxAggregateBytes,
    policy.maxFrameBytes
  ].every(_isPositiveSafeInteger)) return null;
  if (
    policy.maxAggregateBytes < Math.max(policy.maxTextBytes, policy.maxImageBytes)
    || policy.maxFrameBytes <= policy.maxAggregateBytes
    || !Array.isArray(policy.imageMimeTypes)
    || policy.imageMimeTypes.length !== _m1InlineImageMimeTypes.length
  ) return null;
  for (var index = 0; index < _m1InlineImageMimeTypes.length; index++) {
    if (policy.imageMimeTypes[index] !== _m1InlineImageMimeTypes[index]) return null;
  }
  var mimeTypes = Object.freeze(policy.imageMimeTypes.slice());
  return Object.freeze({
    version: policy.version,
    mode: policy.mode,
    maxCount: policy.maxCount,
    maxTextBytes: policy.maxTextBytes,
    maxImageBytes: policy.maxImageBytes,
    maxAggregateBytes: policy.maxAggregateBytes,
    maxFrameBytes: policy.maxFrameBytes,
    imageMimeTypes: mimeTypes
  });
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
      if (!response || response.ok !== true || response.status !== 200) {
        throw new Error('rehydrate-http-failed');
      }
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
  _interruptM1Turns(
    _wsConnectionEpoch,
    'M1_CONNECTION_REPLACED',
    'The connection changed before the M1 turn reached a terminal result.'
  );
  _wsReady = false;
  _serverFeatures = [];
  _m1WireNegotiated = false;
  _m1AttachmentPolicy = null;

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
    offeredFeatures: _clientFeatures.slice(),
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
        features: connection.offeredFeatures
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
    _serverFeatures = [];
    _m1WireNegotiated = false;
    _m1AttachmentPolicy = null;
    _cancelPendingRehydrate(connectionEpoch);
    _interruptM1Turns(
      connectionEpoch,
      'M1_CONNECTION_INTERRUPTED',
      'The connection closed before the M1 turn reached a terminal result.'
    );

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
      var acknowledgedFeatures = Array.isArray(msg.features)
        ? msg.features.filter(function(feature){return typeof feature === 'string';})
        : [];
      var m1FeatureAcknowledged = msg.protocolVersion === 1
        && connection.offeredFeatures.indexOf(_m1WireFeature) >= 0
        && acknowledgedFeatures.indexOf(_m1WireFeature) >= 0;
      var attachmentPolicy = m1FeatureAcknowledged
        ? _readM1AttachmentPolicy(msg)
        : null;
      if (m1FeatureAcknowledged && !attachmentPolicy) {
        _closeFailedHandshake(connection, 'Invalid M1 negotiation metadata');
        return;
      }
      connection.handshakeState = 'ACCEPTED';
      _clearHandshakeTimer();
      _wsReady = true;
      _wsRetryCount = 0;
      _wsReconnectExhausted = false;
      _serverVersion = msg.serverVersion || msg.backendVersion || null;
      _serverFeatures = acknowledgedFeatures;
      _m1WireNegotiated = m1FeatureAcknowledged;
      _m1AttachmentPolicy = attachmentPolicy;
      _m1ProtocolFailedEpoch = null;
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
    /* Negotiated chat has one authority: issued M1 identities. Never let a
       CoreEvent or legacy assistant reach the last-sender fallback router. */
    if (msg.channel === 'chat' && _m1WireNegotiated) {
      if (d && d.contract === 'CoreEvent') {
        _handleM1CoreEvent(d, connectionEpoch, socket);
      } else {
        _failM1Protocol(connectionEpoch, socket, 'legacy-or-malformed-chat-envelope');
      }
      return;
    }
    if (msg.channel === 'chat' && d && d.contract === 'CoreEvent') {
      _failM1Protocol(connectionEpoch, socket, 'core-event-without-negotiation');
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
        C3Bus.emit('status:update', {
          sessionIdx: si,
          transport: _m1WireNegotiated ? 'm1' : 'legacy',
          data: d
        });
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
        } else if (d.action === 'upgrade_verify_cleared') {
          C3Bus.emit('upgrade:verify_cleared', d);
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

function _sendM1Command(command, context, session, sessionIdx, targetEntry) {
  var validation = _m1Protocol.validateM1Contract(command, 'ConversationCommand');
  if (!validation || validation.valid !== true) {
    return _rejectM1Send('M1_COMMAND_INVALID', false);
  }
  var resolvedSessionIdx = typeof sessionIdx === 'number'
    ? sessionIdx
    : (typeof _sessions !== 'undefined' ? _sessions.indexOf(session) : -1);
  if (resolvedSessionIdx < 0) return _rejectM1Send('M1_SESSION_UNOWNED', false);
  if (!_m1AttachmentPolicy) {
    return _rejectM1Send('M1_ATTACHMENT_POLICY_UNAVAILABLE', false);
  }
  var encodedFrame = JSON.stringify({
    channel: 'chat',
    data: { command: command, context: context }
  });
  if (_m1Utf8ByteLength(encodedFrame) > _m1AttachmentPolicy.maxFrameBytes) {
    return _rejectM1Send('M1_FRAME_TOO_LARGE', false);
  }
  var entry = {
    action: command.action,
    connectionEpoch: _wsConnectionEpoch,
    conversationId: command.conversationId,
    events: [],
    lastSequence: 0,
    serializedBytes: 0,
    requestId: command.requestId,
    session: session,
    sessionIdx: resolvedSessionIdx,
    socket: _chatWs,
    targetRequestId: targetEntry ? targetEntry.requestId : null,
    targetTurnId: targetEntry ? targetEntry.turnId : null,
    terminalStatus: null,
    turnId: command.turnId
  };
  if (!_registerM1Turn(entry)) {
    return _rejectM1Send('M1_LEDGER_CAPACITY_EXCEEDED', true);
  }
  try {
    if (!_chatWs || _chatWs.readyState !== 1 || !_wsReady) {
      _removeM1Turn(command.requestId);
      return false;
    }
    _chatWs.send(encodedFrame);
  } catch (error) {
    _removeM1Turn(command.requestId);
    throw error;
  }
  return true;
}

function _findActiveM1Send(conversationId) {
  for (var index = _m1LedgerOrder.length - 1; index >= 0; index--) {
    var entry = _m1Ledger[_m1LedgerOrder[index]];
    if (
      entry
      && entry.action === 'send'
      && entry.terminalStatus === null
      && entry.connectionEpoch === _wsConnectionEpoch
      && entry.conversationId === conversationId
    ) return entry;
  }
  return null;
}

function wsSendChat(content, session, sessionIdx) {
  _m1LastSendRejection = null;
  var selected = _selectConversationId(session);
  if (!selected) return false;
  if (_m1WireNegotiated) {
    if (_findActiveM1Send(selected.conversationId)) {
      return _rejectM1Send('M1_CONVERSATION_BUSY', true);
    }
    var context = _createM1Context(session);
    if (!context) return false;
    var command = {
      contract: 'ConversationCommand',
      version: _m1Protocol.M1_CONTRACT_VERSION,
      requestId: _createM1Identity('studio-request'),
      conversationId: selected.conversationId,
      turnId: _createM1Identity('studio-turn'),
      action: 'send',
      input: content
    };
    if (!_sendM1Command(command, context, session, sessionIdx)) return false;
    _publishConversationId(session, sessionIdx, selected);
    if (typeof sessionIdx === 'number') _lastSendSessionIdx = sessionIdx;
    return true;
  }
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
  _m1LastSendRejection = null;
  var conversationId = session && _isConversationId(session._convId)
    ? session._convId
    : null;
  if (!conversationId) return false;
  if (_m1WireNegotiated) {
    var target = _findActiveM1Send(conversationId);
    if (!target) return false;
    var context = _createM1Context(target.session);
    if (!context) return false;
    return _sendM1Command({
      contract: 'ConversationCommand',
      version: _m1Protocol.M1_CONTRACT_VERSION,
      requestId: _createM1Identity('studio-cancel-request'),
      conversationId: conversationId,
      turnId: _createM1Identity('studio-cancel-turn'),
      action: 'cancel'
    }, context, target.session, target.sessionIdx, target);
  }
  return wsSend('control', { action: 'cancel', conversationId: conversationId });
}

function wsHasActiveM1Turn(session) {
  if (!_m1WireNegotiated || !session || !_isConversationId(session._convId)) return false;
  return _findActiveM1Send(session._convId) !== null;
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
function wsIsM1WireNegotiated() { return _m1WireNegotiated; }
function wsM1AttachmentPolicy() { return _m1AttachmentPolicy; }
function wsConnectionEpoch() { return _wsConnectionEpoch; }
function wsTakeM1SendRejection() {
  var rejection = _m1LastSendRejection;
  _m1LastSendRejection = null;
  return rejection;
}
function wsDestroy() {
  _wsDestroyed = true;
  if (_wsRetryTimer) clearTimeout(_wsRetryTimer);
  _wsRetryTimer = null;
  _clearHandshakeTimer();
  _wsReady = false;
  _serverFeatures = [];
  _m1WireNegotiated = false;
  _m1AttachmentPolicy = null;
  _m1LastSendRejection = null;
  _clearPendingEditsOnDisconnect();
  _cancelPendingRehydrate(_wsConnectionEpoch);
  _interruptM1Turns(
    _wsConnectionEpoch,
    'M1_CLIENT_DESTROYED',
    'The Studio client stopped before the M1 turn reached a terminal result.'
  );
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
    wsHasActiveM1Turn: wsHasActiveM1Turn,
    wsIsM1WireNegotiated: wsIsM1WireNegotiated,
    wsM1AttachmentPolicy: wsM1AttachmentPolicy,
    wsConnectionEpoch: wsConnectionEpoch,
    wsTakeM1SendRejection: wsTakeM1SendRejection,
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
    hasActiveM1Turn: wsHasActiveM1Turn,
    isM1WireNegotiated: wsIsM1WireNegotiated,
    m1AttachmentPolicy: wsM1AttachmentPolicy,
    connectionEpoch: wsConnectionEpoch,
    takeM1SendRejection: wsTakeM1SendRejection,
    destroy: wsDestroy,
    trackEditRequest: trackEditRequest,
    approveEdit: approveEdit,
    rejectEdit: rejectEdit,
    cleanupSessionEdits: cleanupSessionEdits
  };
}
