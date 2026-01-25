// CRE v44.x Unification Index
// ══════════════════════════════════════════════════════════════════════════════
//
// LAYER 9 — SYSTEM UNIFICATION
//
// v44.0: Chat Controller (FÁZE A)
//   - ChatController: Single entry point for all user interactions
//   - ChatMode: Mode types (conversation, project, expert, agent)
//   - ResponseTag, TaggedResponse: Response metadata tagging
//   - ModeDetector: Auto-detect appropriate mode
//
// v44.1: Project Focus (FÁZE B)
//   - ProjectFocusManager: Focus locking and mode transitions
//   - ProjectFocus: Focus target specification
//   - FocusLock: Prevent unintended focus changes
//   - ModeTransition: Explicit CHAT ↔ PROJECT ↔ AGENT transitions
//
// v44.2: Expert Profile (FÁZE C)
//   - ExpertProfile: Expert identity with reputation tracking
//   - ExpertArbitrator: Multi-expert conflict resolution
//   - ConfidenceRecord: Confidence history tracking
//   - ArbitrationResult: Arbitration outcome
//
// v44.3: Agent Contract (FÁZE D)
//   - AgentOutputContract: Structured output (no chatty responses)
//   - VisibilityFormatter: hidden | summarized | verbose
//   - AgentProgress, NextAction, LogsReference
//   - AgentOutputBuilder: Fluent API for building output
//
// ══════════════════════════════════════════════════════════════════════════════

// v44.0: Chat Controller (FÁZE A)
export {
  // Enums
  ChatMode,
  ResponseSpeaker,
  // Constants
  MODES_REQUIRING_CONFIRMATION, // Modes that need explicit user confirmation
  // Classes
  ResponseTag,
  TaggedResponse,
  ModeDetection,
  ModeDetector,
  ChatController,
  // Factory functions
  createChatController,
  createResponseTag,
  createTaggedResponse,
} from './chat-controller.js';

// v44.1: Project Focus (FÁZE B)
export {
  // Enums
  FocusScope,
  LockState,
  TransitionType,
  // Constants
  TRANSITION_RULES,
  // Classes
  ProjectFocus,
  FocusLock,
  ModeTransition,
  ProjectFocusManager,
  // Factory functions
  createProjectFocusManager,
  createProjectFocus,
  createFileFocus,
  createModuleFocus,
  createProjectLevelFocus,
} from './project-focus.js';

// v44.2: Expert Profile (FÁZE C)
export {
  // Enums
  ExpertDomain,
  ConfidenceLevel,
  ArbitrationStrategy,
  // Classes
  ConfidenceRecord,
  ExpertProfile,
  ExpertResponse,
  ArbitrationResult,
  ExpertArbitrator,
  // Factory functions
  createExpertProfile,
  createExpertResponse,
  createExpertArbitrator,
} from './expert-profile.js';

// v44.3: Agent Contract (FÁZE D)
export {
  // Enums
  AgentStatus,
  VisibilityLevel,
  ActionType,
  // Classes
  AgentProgress,
  NextAction,
  LogsReference,
  AgentOutputContract,
  VisibilityFormatter,
  AgentOutputBuilder,
  // Factory functions
  createAgentOutputBuilder,
  createVisibilityFormatter,
  createAgentProgress,
  createNextAction,
  createLogsReference,
} from './agent-contract.js';
