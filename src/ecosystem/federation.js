// CRE v43.x Ecosystem — Federation
// ══════════════════════════════════════════════════════════════════════════════
//
// Více CRE instancí spolupracuje
//
// Federation enables multiple CRE instances to:
// - Share knowledge and skills
// - Delegate tasks to specialized instances
// - Coordinate complex multi-step operations
// - Maintain consistency across the network
//
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Federation node states
 */
export const NodeState = Object.freeze({
  OFFLINE: 'OFFLINE',
  JOINING: 'JOINING',
  SYNCING: 'SYNCING',
  ONLINE: 'ONLINE',
  DEGRADED: 'DEGRADED',
  LEAVING: 'LEAVING',
});

/**
 * Node roles in federation
 */
export const NodeRole = Object.freeze({
  LEADER: 'LEADER',       // Coordinates federation
  FOLLOWER: 'FOLLOWER',   // Standard participant
  OBSERVER: 'OBSERVER',   // Read-only access
  SPECIALIST: 'SPECIALIST', // Domain specialist
});

/**
 * Disclosure levels for federated messages
 *
 * Controls how much information is shared with other nodes.
 * Used for privacy and security in multi-tenant environments.
 */
export const DisclosureLevel = Object.freeze({
  FULL: 'FULL',           // Share complete payload
  SUMMARY: 'SUMMARY',     // Share summary/aggregated data only
  METADATA: 'METADATA',   // Share only metadata (types, counts, not content)
});

/**
 * Disclosure level payload filters
 */
export const DISCLOSURE_FILTERS = Object.freeze({
  [DisclosureLevel.FULL]: (payload) => payload,
  [DisclosureLevel.SUMMARY]: (payload) => {
    // Return summary - strip detailed content
    const summary = {};
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === 'object' && value !== null) {
        if (Array.isArray(value)) {
          summary[key] = { _type: 'array', _count: value.length };
        } else {
          summary[key] = { _type: 'object', _keys: Object.keys(value) };
        }
      } else {
        summary[key] = value;
      }
    }
    return summary;
  },
  [DisclosureLevel.METADATA]: (payload) => {
    // Return only structure metadata
    return {
      _type: 'object',
      _keys: Object.keys(payload),
      _timestamp: new Date().toISOString(),
    };
  },
});

/**
 * Federation message types
 */
export const MessageType = Object.freeze({
  // Membership
  JOIN_REQUEST: 'JOIN_REQUEST',
  JOIN_ACCEPT: 'JOIN_ACCEPT',
  JOIN_REJECT: 'JOIN_REJECT',
  LEAVE_ANNOUNCE: 'LEAVE_ANNOUNCE',
  HEARTBEAT: 'HEARTBEAT',

  // Coordination
  TASK_DELEGATE: 'TASK_DELEGATE',
  TASK_RESULT: 'TASK_RESULT',
  TASK_CANCEL: 'TASK_CANCEL',

  // Knowledge
  KNOWLEDGE_SHARE: 'KNOWLEDGE_SHARE',
  KNOWLEDGE_QUERY: 'KNOWLEDGE_QUERY',
  KNOWLEDGE_RESPONSE: 'KNOWLEDGE_RESPONSE',

  // Consensus
  PROPOSE: 'PROPOSE',
  VOTE: 'VOTE',
  COMMIT: 'COMMIT',
  ABORT: 'ABORT',
});

/**
 * Federation Node Identity
 */
export class NodeIdentity {
  #id;
  #name;
  #endpoint;
  #publicKey;
  #capabilities;
  #role;
  #version;

  /**
   * @param {Object} config
   * @param {string} config.id - Unique node identifier
   * @param {string} config.name - Human-readable name
   * @param {string} config.endpoint - Network endpoint
   * @param {string} [config.publicKey] - Public key for verification
   * @param {string[]} [config.capabilities] - Node capabilities
   * @param {string} [config.role] - Node role
   * @param {string} [config.version] - CRE version
   */
  constructor(config) {
    const {
      id,
      name,
      endpoint,
      publicKey = '',
      capabilities = [],
      role = NodeRole.FOLLOWER,
      version = '43.0.0',
    } = config;

    if (!id || typeof id !== 'string') {
      throw new Error('NodeIdentity requires id string');
    }

    if (!name || typeof name !== 'string') {
      throw new Error('NodeIdentity requires name string');
    }

    if (!endpoint || typeof endpoint !== 'string') {
      throw new Error('NodeIdentity requires endpoint string');
    }

    this.#id = id;
    this.#name = name;
    this.#endpoint = endpoint;
    this.#publicKey = publicKey;
    this.#capabilities = Object.freeze([...capabilities]);
    this.#role = role;
    this.#version = version;
  }

  get id() { return this.#id; }
  get name() { return this.#name; }
  get endpoint() { return this.#endpoint; }
  get publicKey() { return this.#publicKey; }
  get capabilities() { return this.#capabilities; }
  get role() { return this.#role; }
  get version() { return this.#version; }

  /**
   * Check if node has capability
   * @param {string} capability
   * @returns {boolean}
   */
  hasCapability(capability) {
    return this.#capabilities.includes(capability);
  }

  toJSON() {
    return {
      id: this.#id,
      name: this.#name,
      endpoint: this.#endpoint,
      publicKey: this.#publicKey,
      capabilities: [...this.#capabilities],
      role: this.#role,
      version: this.#version,
    };
  }

  static fromJSON(data) {
    return new NodeIdentity(data);
  }
}

/**
 * Federation Message - Message between nodes
 */
export class FederationMessage {
  #id;
  #type;
  #senderId;
  #recipientId;
  #payload;
  #disclosureLevel;
  #timestamp;
  #correlationId;
  #signature;

  /**
   * @param {Object} config
   * @param {string} config.type - MessageType
   * @param {string} config.senderId - Sender node ID
   * @param {string} [config.recipientId] - Recipient node ID (null for broadcast)
   * @param {Object} config.payload - Message payload
   * @param {string} [config.disclosureLevel] - DisclosureLevel for privacy control
   * @param {string} [config.correlationId] - For request-response correlation
   */
  constructor(config) {
    const {
      type,
      senderId,
      recipientId = null,
      payload = {},
      disclosureLevel = DisclosureLevel.FULL,
      correlationId = null,
    } = config;

    if (!Object.values(MessageType).includes(type)) {
      throw new Error(`Invalid message type: ${type}`);
    }

    if (!senderId || typeof senderId !== 'string') {
      throw new Error('FederationMessage requires senderId string');
    }

    if (!Object.values(DisclosureLevel).includes(disclosureLevel)) {
      throw new Error(`Invalid disclosure level: ${disclosureLevel}`);
    }

    this.#id = `msg_${crypto.randomUUID()}`;
    this.#type = type;
    this.#senderId = senderId;
    this.#recipientId = recipientId;
    this.#payload = Object.freeze({ ...payload });
    this.#disclosureLevel = disclosureLevel;
    this.#timestamp = new Date().toISOString();
    this.#correlationId = correlationId || this.#id;
    this.#signature = null;
  }

  get id() { return this.#id; }
  get type() { return this.#type; }
  get senderId() { return this.#senderId; }
  get recipientId() { return this.#recipientId; }
  get payload() { return this.#payload; }
  get disclosureLevel() { return this.#disclosureLevel; }
  get timestamp() { return this.#timestamp; }
  get correlationId() { return this.#correlationId; }
  get signature() { return this.#signature; }

  /**
   * Get payload filtered by disclosure level
   * @returns {Object}
   */
  getDisclosedPayload() {
    const filter = DISCLOSURE_FILTERS[this.#disclosureLevel];
    return filter(this.#payload);
  }

  /**
   * Check if message is broadcast
   * @returns {boolean}
   */
  isBroadcast() {
    return this.#recipientId === null;
  }

  /**
   * Sign the message (placeholder for actual crypto)
   * @param {string} privateKey
   */
  sign(privateKey) {
    // In production, use actual cryptographic signing
    this.#signature = `sig_${this.#id}_${privateKey.substring(0, 8)}`;
  }

  /**
   * Create a reply message
   * @param {string} type - MessageType
   * @param {Object} payload
   * @param {string} [disclosureLevel] - Inherit from original or override
   * @returns {FederationMessage}
   */
  createReply(type, payload, disclosureLevel = null) {
    return new FederationMessage({
      type,
      senderId: this.#recipientId,
      recipientId: this.#senderId,
      payload,
      disclosureLevel: disclosureLevel || this.#disclosureLevel,
      correlationId: this.#correlationId,
    });
  }

  toJSON() {
    return {
      id: this.#id,
      type: this.#type,
      senderId: this.#senderId,
      recipientId: this.#recipientId,
      payload: this.#payload,
      disclosureLevel: this.#disclosureLevel,
      timestamp: this.#timestamp,
      correlationId: this.#correlationId,
      signature: this.#signature,
    };
  }

  /**
   * Serialize with disclosure level filtering applied
   * @returns {Object}
   */
  toDisclosedJSON() {
    return {
      id: this.#id,
      type: this.#type,
      senderId: this.#senderId,
      recipientId: this.#recipientId,
      payload: this.getDisclosedPayload(),
      disclosureLevel: this.#disclosureLevel,
      timestamp: this.#timestamp,
      correlationId: this.#correlationId,
      signature: this.#signature,
    };
  }

  static fromJSON(data) {
    const msg = new FederationMessage({
      type: data.type,
      senderId: data.senderId,
      recipientId: data.recipientId,
      payload: data.payload,
      disclosureLevel: data.disclosureLevel || DisclosureLevel.FULL,
      correlationId: data.correlationId,
    });
    msg.#id = data.id;
    msg.#timestamp = data.timestamp;
    msg.#signature = data.signature;
    return msg;
  }
}

/**
 * Federation Peer - Represents a remote federation node
 */
export class FederationPeer {
  #identity;
  #state;
  #lastSeen;
  #lastHeartbeat;
  #latencyMs;
  #failedHeartbeats;

  /**
   * @param {NodeIdentity} identity
   */
  constructor(identity) {
    if (!(identity instanceof NodeIdentity)) {
      identity = new NodeIdentity(identity);
    }

    this.#identity = identity;
    this.#state = NodeState.OFFLINE;
    this.#lastSeen = null;
    this.#lastHeartbeat = null;
    this.#latencyMs = 0;
    this.#failedHeartbeats = 0;
  }

  get id() { return this.#identity.id; }
  get identity() { return this.#identity; }
  get state() { return this.#state; }
  get lastSeen() { return this.#lastSeen; }
  get lastHeartbeat() { return this.#lastHeartbeat; }
  get latencyMs() { return this.#latencyMs; }
  get failedHeartbeats() { return this.#failedHeartbeats; }

  /**
   * Check if peer is online
   * @returns {boolean}
   */
  isOnline() {
    return this.#state === NodeState.ONLINE;
  }

  /**
   * Mark peer as online
   */
  markOnline() {
    this.#state = NodeState.ONLINE;
    this.#lastSeen = new Date().toISOString();
    this.#failedHeartbeats = 0;
  }

  /**
   * Record heartbeat
   * @param {number} latencyMs
   */
  recordHeartbeat(latencyMs) {
    this.#lastHeartbeat = new Date().toISOString();
    this.#latencyMs = latencyMs;
    this.#failedHeartbeats = 0;
    this.markOnline();
  }

  /**
   * Record failed heartbeat
   */
  recordHeartbeatFailure() {
    this.#failedHeartbeats++;
    if (this.#failedHeartbeats >= 3) {
      this.#state = NodeState.DEGRADED;
    }
    if (this.#failedHeartbeats >= 5) {
      this.#state = NodeState.OFFLINE;
    }
  }

  /**
   * Mark peer as offline
   */
  markOffline() {
    this.#state = NodeState.OFFLINE;
  }

  toJSON() {
    return {
      identity: this.#identity.toJSON(),
      state: this.#state,
      lastSeen: this.#lastSeen,
      lastHeartbeat: this.#lastHeartbeat,
      latencyMs: this.#latencyMs,
      failedHeartbeats: this.#failedHeartbeats,
    };
  }
}

/**
 * FederationManager - Manages federation membership and communication
 */
export class FederationManager {
  #localNode;
  #peers;
  #state;
  #leader;
  #messageHandlers;
  #pendingRequests;
  #sharedKnowledge;
  #heartbeatInterval;

  /**
   * @param {NodeIdentity|Object} localNode - Local node identity
   */
  constructor(localNode) {
    if (!(localNode instanceof NodeIdentity)) {
      localNode = new NodeIdentity(localNode);
    }

    this.#localNode = localNode;
    this.#peers = new Map();
    this.#state = NodeState.OFFLINE;
    this.#leader = null;
    this.#messageHandlers = new Map();
    this.#pendingRequests = new Map();
    this.#sharedKnowledge = new Map();
    this.#heartbeatInterval = null;

    this.#setupDefaultHandlers();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Getters
  // ─────────────────────────────────────────────────────────────────────────────

  get localNode() { return this.#localNode; }
  get state() { return this.#state; }
  get leader() { return this.#leader; }

  /**
   * Check if this node is the leader
   * @returns {boolean}
   */
  isLeader() {
    return this.#leader === this.#localNode.id;
  }

  /**
   * Get all peers
   * @returns {FederationPeer[]}
   */
  getPeers() {
    return Array.from(this.#peers.values());
  }

  /**
   * Get online peers
   * @returns {FederationPeer[]}
   */
  getOnlinePeers() {
    return this.getPeers().filter(p => p.isOnline());
  }

  /**
   * Get peer by ID
   * @param {string} peerId
   * @returns {FederationPeer|null}
   */
  getPeer(peerId) {
    return this.#peers.get(peerId) || null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Federation Lifecycle
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Join the federation
   * @param {string[]} seedPeers - Initial peer endpoints to connect to
   * @returns {Promise<void>}
   */
  async join(seedPeers = []) {
    if (this.#state !== NodeState.OFFLINE) {
      throw new Error(`Cannot join in state: ${this.#state}`);
    }

    this.#state = NodeState.JOINING;

    try {
      // Connect to seed peers
      for (const endpoint of seedPeers) {
        await this.#connectToPeer(endpoint);
      }

      // Sync state with peers
      this.#state = NodeState.SYNCING;
      await this.#syncWithPeers();

      // Start heartbeat
      this.#startHeartbeat();

      this.#state = NodeState.ONLINE;

      // If no leader, potentially become leader
      if (!this.#leader && this.getPeers().length === 0) {
        this.#leader = this.#localNode.id;
      }

    } catch (error) {
      this.#state = NodeState.OFFLINE;
      throw error;
    }
  }

  /**
   * Leave the federation
   * @returns {Promise<void>}
   */
  async leave() {
    if (this.#state === NodeState.OFFLINE) {
      return;
    }

    this.#state = NodeState.LEAVING;

    // Stop heartbeat
    this.#stopHeartbeat();

    // Announce departure
    await this.broadcast({
      type: MessageType.LEAVE_ANNOUNCE,
      payload: { nodeId: this.#localNode.id },
    });

    // Clear peers
    this.#peers.clear();
    this.#leader = null;

    this.#state = NodeState.OFFLINE;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Messaging
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Send message to specific peer
   * @param {string} peerId
   * @param {Object} message
   * @returns {Promise<FederationMessage>}
   */
  async send(peerId, message) {
    const peer = this.#peers.get(peerId);
    if (!peer) {
      throw new Error(`Peer not found: ${peerId}`);
    }

    if (!peer.isOnline()) {
      throw new Error(`Peer offline: ${peerId}`);
    }

    const msg = message instanceof FederationMessage
      ? message
      : new FederationMessage({
          ...message,
          senderId: this.#localNode.id,
          recipientId: peerId,
        });

    // Simulate sending (in production, this would be actual network)
    await this.#simulateSend(msg);

    return msg;
  }

  /**
   * Broadcast message to all online peers
   * @param {Object} message
   * @returns {Promise<void>}
   */
  async broadcast(message) {
    const msg = new FederationMessage({
      ...message,
      senderId: this.#localNode.id,
      recipientId: null,
    });

    const onlinePeers = this.getOnlinePeers();
    await Promise.all(
      onlinePeers.map(peer =>
        this.send(peer.id, {
          ...msg.toJSON(),
          recipientId: peer.id,
        }).catch(() => {})
      )
    );
  }

  /**
   * Handle incoming message
   * @param {FederationMessage|Object} message
   */
  async handleMessage(message) {
    if (!(message instanceof FederationMessage)) {
      message = FederationMessage.fromJSON(message);
    }

    const handler = this.#messageHandlers.get(message.type);
    if (handler) {
      await handler(message);
    }
  }

  /**
   * Register message handler
   * @param {string} type - MessageType
   * @param {Function} handler - (message) => Promise<void>
   */
  onMessage(type, handler) {
    this.#messageHandlers.set(type, handler);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Task Delegation
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Delegate task to capable peer
   * @param {Object} task
   * @param {string[]} [requiredCapabilities] - Required peer capabilities
   * @returns {Promise<Object>}
   */
  async delegateTask(task, requiredCapabilities = []) {
    // Find capable peer
    const capablePeers = this.getOnlinePeers().filter(peer =>
      requiredCapabilities.every(cap => peer.identity.hasCapability(cap))
    );

    if (capablePeers.length === 0) {
      throw new Error('No capable peers available');
    }

    // Select peer with lowest latency
    const peer = capablePeers.reduce((best, current) =>
      current.latencyMs < best.latencyMs ? current : best
    );

    // Send delegation request
    const correlationId = `task_${crypto.randomUUID()}`;

    const resultPromise = new Promise((resolve, reject) => {
      this.#pendingRequests.set(correlationId, { resolve, reject });

      // Timeout
      setTimeout(() => {
        if (this.#pendingRequests.has(correlationId)) {
          this.#pendingRequests.delete(correlationId);
          reject(new Error('Task delegation timeout'));
        }
      }, 30000);
    });

    await this.send(peer.id, {
      type: MessageType.TASK_DELEGATE,
      payload: { task },
      correlationId,
    });

    return resultPromise;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Knowledge Sharing
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Share knowledge with federation
   * @param {string} key - Knowledge key
   * @param {*} value - Knowledge value
   * @returns {Promise<void>}
   */
  async shareKnowledge(key, value) {
    this.#sharedKnowledge.set(key, {
      value,
      source: this.#localNode.id,
      timestamp: new Date().toISOString(),
    });

    await this.broadcast({
      type: MessageType.KNOWLEDGE_SHARE,
      payload: { key, value },
    });
  }

  /**
   * Query knowledge from federation
   * @param {string} key - Knowledge key
   * @returns {Promise<*>}
   */
  async queryKnowledge(key) {
    // Check local first
    if (this.#sharedKnowledge.has(key)) {
      return this.#sharedKnowledge.get(key).value;
    }

    // Query peers
    const correlationId = `query_${crypto.randomUUID()}`;

    const resultPromise = new Promise((resolve, reject) => {
      this.#pendingRequests.set(correlationId, { resolve, reject });

      setTimeout(() => {
        if (this.#pendingRequests.has(correlationId)) {
          this.#pendingRequests.delete(correlationId);
          resolve(null); // Not found
        }
      }, 5000);
    });

    await this.broadcast({
      type: MessageType.KNOWLEDGE_QUERY,
      payload: { key },
      correlationId,
    });

    return resultPromise;
  }

  /**
   * Get all shared knowledge
   * @returns {Object}
   */
  getSharedKnowledge() {
    const result = {};
    for (const [key, entry] of this.#sharedKnowledge) {
      result[key] = entry;
    }
    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Statistics
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get federation statistics
   * @returns {Object}
   */
  getStats() {
    const peers = this.getPeers();
    const online = peers.filter(p => p.isOnline());

    return {
      state: this.#state,
      isLeader: this.isLeader(),
      leader: this.#leader,
      totalPeers: peers.length,
      onlinePeers: online.length,
      averageLatency: online.length > 0
        ? online.reduce((sum, p) => sum + p.latencyMs, 0) / online.length
        : 0,
      sharedKnowledgeCount: this.#sharedKnowledge.size,
      pendingRequests: this.#pendingRequests.size,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Serialization
  // ─────────────────────────────────────────────────────────────────────────────

  toJSON() {
    return {
      localNode: this.#localNode.toJSON(),
      state: this.#state,
      leader: this.#leader,
      peers: this.getPeers().map(p => p.toJSON()),
      sharedKnowledge: Object.fromEntries(this.#sharedKnowledge),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  async #connectToPeer(endpoint) {
    // Simulate connection (in production, actual network)
    const peerIdentity = new NodeIdentity({
      id: `peer_${crypto.randomUUID().substring(0, 8)}`,
      name: `Peer at ${endpoint}`,
      endpoint,
    });

    const peer = new FederationPeer(peerIdentity);
    peer.markOnline();

    this.#peers.set(peer.id, peer);
  }

  async #syncWithPeers() {
    // Simulate sync
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  #startHeartbeat() {
    this.#heartbeatInterval = setInterval(async () => {
      const startTime = Date.now();

      for (const peer of this.#peers.values()) {
        try {
          await this.send(peer.id, {
            type: MessageType.HEARTBEAT,
            payload: { timestamp: new Date().toISOString() },
          });
          peer.recordHeartbeat(Date.now() - startTime);
        } catch {
          peer.recordHeartbeatFailure();
        }
      }
    }, 5000);
  }

  #stopHeartbeat() {
    if (this.#heartbeatInterval) {
      clearInterval(this.#heartbeatInterval);
      this.#heartbeatInterval = null;
    }
  }

  async #simulateSend(message) {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  #setupDefaultHandlers() {
    // Handle heartbeat
    this.onMessage(MessageType.HEARTBEAT, async (msg) => {
      const peer = this.#peers.get(msg.senderId);
      if (peer) {
        peer.markOnline();
      }
    });

    // Handle leave announcement
    this.onMessage(MessageType.LEAVE_ANNOUNCE, async (msg) => {
      const peer = this.#peers.get(msg.payload.nodeId);
      if (peer) {
        peer.markOffline();
      }
    });

    // Handle knowledge share
    this.onMessage(MessageType.KNOWLEDGE_SHARE, async (msg) => {
      const { key, value } = msg.payload;
      this.#sharedKnowledge.set(key, {
        value,
        source: msg.senderId,
        timestamp: msg.timestamp,
      });
    });

    // Handle knowledge query
    this.onMessage(MessageType.KNOWLEDGE_QUERY, async (msg) => {
      const { key } = msg.payload;
      if (this.#sharedKnowledge.has(key)) {
        await this.send(msg.senderId, msg.createReply(
          MessageType.KNOWLEDGE_RESPONSE,
          { key, value: this.#sharedKnowledge.get(key).value }
        ));
      }
    });

    // Handle knowledge response
    this.onMessage(MessageType.KNOWLEDGE_RESPONSE, async (msg) => {
      const pending = this.#pendingRequests.get(msg.correlationId);
      if (pending) {
        this.#pendingRequests.delete(msg.correlationId);
        pending.resolve(msg.payload.value);
      }
    });

    // Handle task result
    this.onMessage(MessageType.TASK_RESULT, async (msg) => {
      const pending = this.#pendingRequests.get(msg.correlationId);
      if (pending) {
        this.#pendingRequests.delete(msg.correlationId);
        if (msg.payload.error) {
          pending.reject(new Error(msg.payload.error));
        } else {
          pending.resolve(msg.payload.result);
        }
      }
    });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Factory Functions
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Create a federation manager
 * @param {Object} localNodeConfig
 * @returns {FederationManager}
 */
export function createFederationManager(localNodeConfig) {
  return new FederationManager(localNodeConfig);
}

/**
 * Create a node identity
 * @param {Object} config
 * @returns {NodeIdentity}
 */
export function createNodeIdentity(config) {
  return new NodeIdentity(config);
}

/**
 * Create a federation message
 * @param {Object} config
 * @returns {FederationMessage}
 */
export function createFederationMessage(config) {
  return new FederationMessage(config);
}

export default FederationManager;
