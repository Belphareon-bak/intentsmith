// CRE v43.x Ecosystem & Leverage Index
// ══════════════════════════════════════════════════════════════════════════════
//
// LAYER 8 — ECOSYSTEM & LEVERAGE
//
// v43.0: Plugin SDK
//   - Plugin: Base class for all plugins (Tools, Skills, Experts, Extensions)
//   - PluginManifest: Plugin metadata and capabilities
//   - PluginRegistry: Central plugin management
//   - PluginValidator: Validate plugins before loading
//   - PluginLoader: Load plugins from various sources
//
// v43.1: Remote Agents
//   - RemoteAgentClient: Communicate with remote agents
//   - RemoteAgentRegistry: Manage remote agent fleet
//   - RemoteTask: Task dispatched to remote agents
//
// v43.2: Federation
//   - FederationManager: Coordinate multiple CRE instances
//   - NodeIdentity: Node identification and capabilities
//   - FederationPeer: Remote federation node
//   - FederationMessage: Inter-node communication
//
// ══════════════════════════════════════════════════════════════════════════════

// v43.0: Plugin SDK
export {
  PluginType, PluginState, PluginCapability,
  PluginExecutionMode,  // Gate enforcement modes
  PLUGIN_MANIFEST_SCHEMA,
  PluginManifest,
  Plugin,
  PluginValidator,
  PluginRegistry,
  PluginLoader,
  PluginContext, createPluginContext,  // Gate-enforced context
  pluginRegistry, pluginLoader,
  createPluginManifest, createPlugin,
} from './plugin-sdk.js';

// v43.1: Remote Agents
export {
  ConnectionState, AgentCapabilityLevel, TaskState,
  TrustLevel, TRUST_LEVEL_RESTRICTIONS,  // Trust level enforcement
  RemoteAgentConfig,
  RemoteTask,
  RemoteAgentClient,
  RemoteAgentRegistry,
  remoteAgentRegistry,
  createRemoteAgent, createRemoteTask,
} from './remote-agents.js';

// v43.2: Federation
export {
  NodeState, NodeRole, MessageType,
  DisclosureLevel, DISCLOSURE_FILTERS,  // Message privacy control
  NodeIdentity,
  FederationMessage,
  FederationPeer,
  FederationManager,
  createFederationManager, createNodeIdentity, createFederationMessage,
} from './federation.js';
