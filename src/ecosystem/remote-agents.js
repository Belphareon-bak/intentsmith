// CRE v43.x Ecosystem — Remote Agents
// ══════════════════════════════════════════════════════════════════════════════
//
// Agenti běží jinde, řízeny CRE
//
// Remote agents are agents that execute on remote machines/containers
// while being orchestrated by the local CRE instance.
//
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Remote agent connection states
 */
export const ConnectionState = Object.freeze({
  DISCONNECTED: 'DISCONNECTED',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  AUTHENTICATED: 'AUTHENTICATED',
  READY: 'READY',
  BUSY: 'BUSY',
  ERROR: 'ERROR',
  RECONNECTING: 'RECONNECTING',
});

/**
 * Remote agent capability levels
 */
export const AgentCapabilityLevel = Object.freeze({
  SANDBOX: 'SANDBOX',     // Isolated, no external access
  STANDARD: 'STANDARD',   // Standard permissions
  ELEVATED: 'ELEVATED',   // Elevated permissions
  FULL: 'FULL',           // Full permissions (rare)
});

/**
 * Task execution states
 */
export const TaskState = Object.freeze({
  QUEUED: 'QUEUED',
  DISPATCHED: 'DISPATCHED',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  TIMEOUT: 'TIMEOUT',
});

/**
 * Trust levels for remote agents
 *
 * Determines what actions a remote agent can perform and
 * what data can be shared with it.
 */
export const TrustLevel = Object.freeze({
  TRUSTED: 'TRUSTED',       // Fully trusted, minimal restrictions
  SANDBOXED: 'SANDBOXED',   // Can execute but in isolated environment
  UNTRUSTED: 'UNTRUSTED',   // Severely restricted, read-only operations
});

/**
 * Trust level restrictions configuration
 */
export const TRUST_LEVEL_RESTRICTIONS = Object.freeze({
  [TrustLevel.TRUSTED]: {
    canExecuteCommands: true,
    canWriteFiles: true,
    canAccessNetwork: true,
    canAccessSecrets: true,
    maxConcurrentTasks: 20,
    requiresHumanApproval: false,
  },
  [TrustLevel.SANDBOXED]: {
    canExecuteCommands: true,
    canWriteFiles: true,
    canAccessNetwork: false,
    canAccessSecrets: false,
    maxConcurrentTasks: 5,
    requiresHumanApproval: false,
  },
  [TrustLevel.UNTRUSTED]: {
    canExecuteCommands: false,
    canWriteFiles: false,
    canAccessNetwork: false,
    canAccessSecrets: false,
    maxConcurrentTasks: 1,
    requiresHumanApproval: true,
  },
});

/**
 * Remote Agent Configuration
 */
export class RemoteAgentConfig {
  #data;

  /**
   * @param {Object} config
   * @param {string} config.id - Unique agent identifier
   * @param {string} config.name - Human-readable name
   * @param {string} config.endpoint - Connection endpoint (URL or address)
   * @param {string} [config.protocol='http'] - Connection protocol
   * @param {string} [config.capabilityLevel='STANDARD'] - Capability level
   * @param {string} [config.trustLevel='SANDBOXED'] - Trust level
   * @param {Object} [config.auth] - Authentication configuration
   * @param {number} [config.timeoutMs=30000] - Default timeout
   * @param {number} [config.maxConcurrent=5] - Max concurrent tasks
   * @param {Object} [config.metadata] - Additional metadata
   */
  constructor(config) {
    const {
      id,
      name,
      endpoint,
      protocol = 'http',
      capabilityLevel = AgentCapabilityLevel.STANDARD,
      trustLevel = TrustLevel.SANDBOXED,
      auth = {},
      timeoutMs = 30000,
      maxConcurrent = 5,
      metadata = {},
    } = config;

    if (!id || typeof id !== 'string') {
      throw new Error('RemoteAgentConfig requires id string');
    }

    if (!name || typeof name !== 'string') {
      throw new Error('RemoteAgentConfig requires name string');
    }

    if (!endpoint || typeof endpoint !== 'string') {
      throw new Error('RemoteAgentConfig requires endpoint string');
    }

    if (!Object.values(AgentCapabilityLevel).includes(capabilityLevel)) {
      throw new Error(`Invalid capability level: ${capabilityLevel}`);
    }

    if (!Object.values(TrustLevel).includes(trustLevel)) {
      throw new Error(`Invalid trust level: ${trustLevel}`);
    }

    this.#data = Object.freeze({
      id,
      name,
      endpoint,
      protocol,
      capabilityLevel,
      trustLevel,
      auth: Object.freeze({ ...auth }),
      timeoutMs,
      maxConcurrent,
      metadata: Object.freeze({ ...metadata }),
    });
  }

  get id() { return this.#data.id; }
  get name() { return this.#data.name; }
  get endpoint() { return this.#data.endpoint; }
  get protocol() { return this.#data.protocol; }
  get capabilityLevel() { return this.#data.capabilityLevel; }
  get trustLevel() { return this.#data.trustLevel; }
  get auth() { return this.#data.auth; }
  get timeoutMs() { return this.#data.timeoutMs; }
  get maxConcurrent() { return this.#data.maxConcurrent; }
  get metadata() { return this.#data.metadata; }

  /**
   * Get restrictions based on trust level
   * @returns {Object}
   */
  getRestrictions() {
    return TRUST_LEVEL_RESTRICTIONS[this.#data.trustLevel];
  }

  /**
   * Check if agent can perform an action based on trust level
   * @param {string} action - Action to check
   * @returns {boolean}
   */
  canPerform(action) {
    const restrictions = this.getRestrictions();
    switch (action) {
      case 'executeCommands': return restrictions.canExecuteCommands;
      case 'writeFiles': return restrictions.canWriteFiles;
      case 'accessNetwork': return restrictions.canAccessNetwork;
      case 'accessSecrets': return restrictions.canAccessSecrets;
      default: return false;
    }
  }

  toJSON() {
    return { ...this.#data };
  }
}

/**
 * Remote Task - A task dispatched to a remote agent
 */
export class RemoteTask {
  #id;
  #agentId;
  #type;
  #payload;
  #state;
  #priority;
  #createdAt;
  #dispatchedAt;
  #startedAt;
  #completedAt;
  #result;
  #error;
  #attempts;
  #maxAttempts;
  #timeoutMs;

  /**
   * @param {Object} config
   * @param {string} config.agentId - Target agent ID
   * @param {string} config.type - Task type
   * @param {Object} config.payload - Task payload
   * @param {number} [config.priority=5] - Priority (1-10, lower = higher)
   * @param {number} [config.maxAttempts=3] - Max retry attempts
   * @param {number} [config.timeoutMs=30000] - Task timeout
   */
  constructor(config) {
    const {
      agentId,
      type,
      payload,
      priority = 5,
      maxAttempts = 3,
      timeoutMs = 30000,
    } = config;

    if (!agentId || typeof agentId !== 'string') {
      throw new Error('RemoteTask requires agentId string');
    }

    if (!type || typeof type !== 'string') {
      throw new Error('RemoteTask requires type string');
    }

    this.#id = `task_${crypto.randomUUID()}`;
    this.#agentId = agentId;
    this.#type = type;
    this.#payload = Object.freeze({ ...payload });
    this.#state = TaskState.QUEUED;
    this.#priority = Math.max(1, Math.min(10, priority));
    this.#createdAt = new Date().toISOString();
    this.#dispatchedAt = null;
    this.#startedAt = null;
    this.#completedAt = null;
    this.#result = null;
    this.#error = null;
    this.#attempts = 0;
    this.#maxAttempts = maxAttempts;
    this.#timeoutMs = timeoutMs;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Getters
  // ─────────────────────────────────────────────────────────────────────────────

  get id() { return this.#id; }
  get agentId() { return this.#agentId; }
  get type() { return this.#type; }
  get payload() { return this.#payload; }
  get state() { return this.#state; }
  get priority() { return this.#priority; }
  get createdAt() { return this.#createdAt; }
  get dispatchedAt() { return this.#dispatchedAt; }
  get startedAt() { return this.#startedAt; }
  get completedAt() { return this.#completedAt; }
  get result() { return this.#result; }
  get error() { return this.#error; }
  get attempts() { return this.#attempts; }
  get maxAttempts() { return this.#maxAttempts; }
  get timeoutMs() { return this.#timeoutMs; }

  /**
   * Check if task is terminal (completed, failed, cancelled, timeout)
   * @returns {boolean}
   */
  isTerminal() {
    return [TaskState.COMPLETED, TaskState.FAILED, TaskState.CANCELLED, TaskState.TIMEOUT]
      .includes(this.#state);
  }

  /**
   * Check if task can be retried
   * @returns {boolean}
   */
  canRetry() {
    return this.#attempts < this.#maxAttempts &&
           (this.#state === TaskState.FAILED || this.#state === TaskState.TIMEOUT);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // State Transitions
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Mark task as dispatched
   */
  markDispatched() {
    if (this.#state !== TaskState.QUEUED) {
      throw new Error(`Cannot dispatch task in state: ${this.#state}`);
    }
    this.#state = TaskState.DISPATCHED;
    this.#dispatchedAt = new Date().toISOString();
    this.#attempts++;
  }

  /**
   * Mark task as running
   */
  markRunning() {
    if (this.#state !== TaskState.DISPATCHED) {
      throw new Error(`Cannot start task in state: ${this.#state}`);
    }
    this.#state = TaskState.RUNNING;
    this.#startedAt = new Date().toISOString();
  }

  /**
   * Mark task as completed with result
   * @param {*} result - Task result
   */
  markCompleted(result) {
    if (this.#state !== TaskState.RUNNING) {
      throw new Error(`Cannot complete task in state: ${this.#state}`);
    }
    this.#state = TaskState.COMPLETED;
    this.#completedAt = new Date().toISOString();
    this.#result = result;
  }

  /**
   * Mark task as failed
   * @param {string} error - Error message
   */
  markFailed(error) {
    if (this.isTerminal()) {
      throw new Error(`Cannot fail task in state: ${this.#state}`);
    }
    this.#state = TaskState.FAILED;
    this.#completedAt = new Date().toISOString();
    this.#error = error;
  }

  /**
   * Mark task as cancelled
   */
  markCancelled() {
    if (this.isTerminal()) {
      throw new Error(`Cannot cancel task in state: ${this.#state}`);
    }
    this.#state = TaskState.CANCELLED;
    this.#completedAt = new Date().toISOString();
  }

  /**
   * Mark task as timed out
   */
  markTimeout() {
    if (this.isTerminal()) {
      throw new Error(`Cannot timeout task in state: ${this.#state}`);
    }
    this.#state = TaskState.TIMEOUT;
    this.#completedAt = new Date().toISOString();
    this.#error = 'Task timed out';
  }

  /**
   * Reset task for retry
   */
  resetForRetry() {
    if (!this.canRetry()) {
      throw new Error('Task cannot be retried');
    }
    this.#state = TaskState.QUEUED;
    this.#dispatchedAt = null;
    this.#startedAt = null;
    this.#completedAt = null;
    this.#error = null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Serialization
  // ─────────────────────────────────────────────────────────────────────────────

  toJSON() {
    return {
      id: this.#id,
      agentId: this.#agentId,
      type: this.#type,
      payload: this.#payload,
      state: this.#state,
      priority: this.#priority,
      createdAt: this.#createdAt,
      dispatchedAt: this.#dispatchedAt,
      startedAt: this.#startedAt,
      completedAt: this.#completedAt,
      result: this.#result,
      error: this.#error,
      attempts: this.#attempts,
      maxAttempts: this.#maxAttempts,
      timeoutMs: this.#timeoutMs,
    };
  }
}

/**
 * RemoteAgentClient - Client for communicating with a single remote agent
 */
export class RemoteAgentClient {
  #config;
  #state;
  #activeTasks;
  #lastHeartbeat;
  #reconnectAttempts;
  #maxReconnectAttempts;
  #eventHandlers;

  /**
   * @param {RemoteAgentConfig} config
   */
  constructor(config) {
    if (!(config instanceof RemoteAgentConfig)) {
      config = new RemoteAgentConfig(config);
    }

    this.#config = config;
    this.#state = ConnectionState.DISCONNECTED;
    this.#activeTasks = new Map();
    this.#lastHeartbeat = null;
    this.#reconnectAttempts = 0;
    this.#maxReconnectAttempts = 5;
    this.#eventHandlers = new Map();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Getters
  // ─────────────────────────────────────────────────────────────────────────────

  get id() { return this.#config.id; }
  get name() { return this.#config.name; }
  get state() { return this.#state; }
  get config() { return this.#config; }
  get trustLevel() { return this.#config.trustLevel; }
  get lastHeartbeat() { return this.#lastHeartbeat; }

  /**
   * Check if agent is ready for tasks
   * @returns {boolean}
   */
  isReady() {
    return this.#state === ConnectionState.READY;
  }

  /**
   * Check if agent is busy (at max capacity)
   * @returns {boolean}
   */
  isBusy() {
    return this.#activeTasks.size >= this.#config.maxConcurrent;
  }

  /**
   * Get active task count
   * @returns {number}
   */
  getActiveTaskCount() {
    return this.#activeTasks.size;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Connection Management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Connect to the remote agent
   * @returns {Promise<void>}
   */
  async connect() {
    if (this.#state !== ConnectionState.DISCONNECTED &&
        this.#state !== ConnectionState.ERROR) {
      throw new Error(`Cannot connect in state: ${this.#state}`);
    }

    this.#state = ConnectionState.CONNECTING;
    this.#emit('connecting');

    try {
      // Simulate connection (in real implementation, this would be actual network call)
      await this.#simulateConnection();

      this.#state = ConnectionState.CONNECTED;
      this.#emit('connected');

      // Authenticate
      await this.#authenticate();

      this.#state = ConnectionState.READY;
      this.#reconnectAttempts = 0;
      this.#lastHeartbeat = new Date().toISOString();
      this.#emit('ready');

    } catch (error) {
      this.#state = ConnectionState.ERROR;
      this.#emit('error', error);
      throw error;
    }
  }

  /**
   * Disconnect from the remote agent
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (this.#state === ConnectionState.DISCONNECTED) {
      return;
    }

    // Cancel all active tasks
    for (const task of this.#activeTasks.values()) {
      task.markCancelled();
    }
    this.#activeTasks.clear();

    this.#state = ConnectionState.DISCONNECTED;
    this.#emit('disconnected');
  }

  /**
   * Attempt reconnection
   * @returns {Promise<boolean>}
   */
  async reconnect() {
    if (this.#reconnectAttempts >= this.#maxReconnectAttempts) {
      return false;
    }

    this.#state = ConnectionState.RECONNECTING;
    this.#reconnectAttempts++;
    this.#emit('reconnecting', this.#reconnectAttempts);

    try {
      await this.connect();
      return true;
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Task Management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Dispatch a task to this agent
   * @param {RemoteTask} task
   * @returns {Promise<RemoteTask>}
   */
  async dispatch(task) {
    if (!this.isReady()) {
      throw new Error(`Agent not ready (state: ${this.#state})`);
    }

    if (this.isBusy()) {
      throw new Error('Agent at max capacity');
    }

    if (task.agentId !== this.id) {
      throw new Error(`Task not targeted at this agent: ${task.agentId} !== ${this.id}`);
    }

    // Trust level validation
    const trustViolation = this.#validateTaskAgainstTrustLevel(task);
    if (trustViolation) {
      throw new Error(`Trust level violation: ${trustViolation}`);
    }

    task.markDispatched();
    this.#activeTasks.set(task.id, task);
    this.#emit('task:dispatched', task);

    if (this.isBusy()) {
      this.#state = ConnectionState.BUSY;
    }

    return task;
  }

  /**
   * Validate task against trust level restrictions
   * @param {RemoteTask} task
   * @returns {string|null} Error message if validation fails, null if passes
   * @private
   */
  #validateTaskAgainstTrustLevel(task) {
    const restrictions = this.#config.getRestrictions();

    // Check task type against trust level restrictions
    if (task.type === 'execute' && !restrictions.canExecuteCommands) {
      return `Trust level ${this.trustLevel} does not allow command execution`;
    }

    if (task.type === 'write' && !restrictions.canWriteFiles) {
      return `Trust level ${this.trustLevel} does not allow file writes`;
    }

    if (task.type === 'network' && !restrictions.canAccessNetwork) {
      return `Trust level ${this.trustLevel} does not allow network access`;
    }

    if (task.payload?.requiresSecrets && !restrictions.canAccessSecrets) {
      return `Trust level ${this.trustLevel} does not allow secret access`;
    }

    return null; // Validation passed
  }

  /**
   * Execute a dispatched task
   * @param {string} taskId
   * @returns {Promise<*>}
   */
  async execute(taskId) {
    const task = this.#activeTasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    task.markRunning();
    this.#emit('task:running', task);

    try {
      // Simulate task execution
      const result = await this.#simulateTaskExecution(task);

      task.markCompleted(result);
      this.#activeTasks.delete(taskId);
      this.#emit('task:completed', task);

      if (!this.isBusy() && this.#state === ConnectionState.BUSY) {
        this.#state = ConnectionState.READY;
      }

      return result;

    } catch (error) {
      task.markFailed(error.message);
      this.#activeTasks.delete(taskId);
      this.#emit('task:failed', task, error);

      if (!this.isBusy() && this.#state === ConnectionState.BUSY) {
        this.#state = ConnectionState.READY;
      }

      throw error;
    }
  }

  /**
   * Cancel a task
   * @param {string} taskId
   * @returns {RemoteTask}
   */
  cancel(taskId) {
    const task = this.#activeTasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    task.markCancelled();
    this.#activeTasks.delete(taskId);
    this.#emit('task:cancelled', task);

    if (!this.isBusy() && this.#state === ConnectionState.BUSY) {
      this.#state = ConnectionState.READY;
    }

    return task;
  }

  /**
   * Get task by ID
   * @param {string} taskId
   * @returns {RemoteTask|null}
   */
  getTask(taskId) {
    return this.#activeTasks.get(taskId) || null;
  }

  /**
   * Get all active tasks
   * @returns {RemoteTask[]}
   */
  getActiveTasks() {
    return Array.from(this.#activeTasks.values());
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Event Handling
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Register event handler
   * @param {string} event
   * @param {Function} handler
   */
  on(event, handler) {
    if (!this.#eventHandlers.has(event)) {
      this.#eventHandlers.set(event, []);
    }
    this.#eventHandlers.get(event).push(handler);
  }

  /**
   * Remove event handler
   * @param {string} event
   * @param {Function} handler
   */
  off(event, handler) {
    const handlers = this.#eventHandlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    }
  }

  #emit(event, ...args) {
    const handlers = this.#eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(...args);
        } catch {
          // Ignore handler errors
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Helpers (Simulation)
  // ─────────────────────────────────────────────────────────────────────────────

  async #simulateConnection() {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  async #authenticate() {
    // Simulate auth
    this.#state = ConnectionState.AUTHENTICATED;
    await new Promise(resolve => setTimeout(resolve, 20));
  }

  async #simulateTaskExecution(task) {
    // Simulate task execution time
    await new Promise(resolve => setTimeout(resolve, 100));
    return { success: true, taskId: task.id, type: task.type };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Serialization
  // ─────────────────────────────────────────────────────────────────────────────

  toJSON() {
    return {
      config: this.#config.toJSON(),
      state: this.#state,
      activeTaskCount: this.#activeTasks.size,
      lastHeartbeat: this.#lastHeartbeat,
      reconnectAttempts: this.#reconnectAttempts,
    };
  }
}

/**
 * RemoteAgentRegistry - Central registry for remote agents
 */
export class RemoteAgentRegistry {
  #agents;
  #taskQueue;

  constructor() {
    this.#agents = new Map();
    this.#taskQueue = [];
  }

  /**
   * Register a remote agent
   * @param {Object|RemoteAgentConfig} config
   * @returns {RemoteAgentClient}
   */
  register(config) {
    if (!(config instanceof RemoteAgentConfig)) {
      config = new RemoteAgentConfig(config);
    }

    if (this.#agents.has(config.id)) {
      throw new Error(`Agent already registered: ${config.id}`);
    }

    const client = new RemoteAgentClient(config);
    this.#agents.set(config.id, client);

    return client;
  }

  /**
   * Unregister an agent
   * @param {string} agentId
   * @returns {boolean}
   */
  async unregister(agentId) {
    const client = this.#agents.get(agentId);
    if (!client) return false;

    await client.disconnect();
    return this.#agents.delete(agentId);
  }

  /**
   * Get agent by ID
   * @param {string} agentId
   * @returns {RemoteAgentClient|null}
   */
  get(agentId) {
    return this.#agents.get(agentId) || null;
  }

  /**
   * Get all agents
   * @returns {RemoteAgentClient[]}
   */
  getAll() {
    return Array.from(this.#agents.values());
  }

  /**
   * Get available agents (ready and not busy)
   * @returns {RemoteAgentClient[]}
   */
  getAvailable() {
    return this.getAll().filter(a => a.isReady() && !a.isBusy());
  }

  /**
   * Connect all agents
   * @returns {Promise<void>}
   */
  async connectAll() {
    await Promise.all(
      this.getAll().map(a => a.connect().catch(() => {}))
    );
  }

  /**
   * Disconnect all agents
   * @returns {Promise<void>}
   */
  async disconnectAll() {
    await Promise.all(
      this.getAll().map(a => a.disconnect())
    );
  }

  /**
   * Create and dispatch a task to best available agent
   * @param {Object} taskConfig
   * @returns {Promise<{ task: RemoteTask, agent: RemoteAgentClient }>}
   */
  async dispatchTask(taskConfig) {
    const { agentId, ...rest } = taskConfig;

    // If specific agent requested
    if (agentId) {
      const agent = this.get(agentId);
      if (!agent) {
        throw new Error(`Agent not found: ${agentId}`);
      }
      if (!agent.isReady()) {
        throw new Error(`Agent not ready: ${agentId}`);
      }
      const task = new RemoteTask({ agentId, ...rest });
      await agent.dispatch(task);
      return { task, agent };
    }

    // Find best available agent
    const available = this.getAvailable();
    if (available.length === 0) {
      throw new Error('No available agents');
    }

    // Simple load balancing: pick agent with fewest active tasks
    const agent = available.reduce((best, current) =>
      current.getActiveTaskCount() < best.getActiveTaskCount() ? current : best
    );

    const task = new RemoteTask({ agentId: agent.id, ...rest });
    await agent.dispatch(task);

    return { task, agent };
  }

  /**
   * Get statistics
   * @returns {Object}
   */
  getStats() {
    const all = this.getAll();

    return {
      total: all.length,
      ready: all.filter(a => a.isReady()).length,
      busy: all.filter(a => a.isBusy()).length,
      disconnected: all.filter(a => a.state === ConnectionState.DISCONNECTED).length,
      error: all.filter(a => a.state === ConnectionState.ERROR).length,
      totalActiveTasks: all.reduce((sum, a) => sum + a.getActiveTaskCount(), 0),
    };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Singleton instance
// ══════════════════════════════════════════════════════════════════════════════

export const remoteAgentRegistry = new RemoteAgentRegistry();

// ══════════════════════════════════════════════════════════════════════════════
// Factory Functions
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Create and register a remote agent
 * @param {Object} config
 * @returns {RemoteAgentClient}
 */
export function createRemoteAgent(config) {
  return remoteAgentRegistry.register(config);
}

/**
 * Create a remote task
 * @param {Object} config
 * @returns {RemoteTask}
 */
export function createRemoteTask(config) {
  return new RemoteTask(config);
}

export default RemoteAgentRegistry;
