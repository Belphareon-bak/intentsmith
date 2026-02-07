// C3-Agent Chat Controller Type Definitions
// Generated for v55.1

/**
 * Chat modes available in the system
 */
export declare const ChatMode: Readonly<{
  CONVERSATION: 'CONVERSATION';
  ARCHITECT: 'ARCHITECT';
  PROJECT: 'PROJECT';
  EXPERT: 'EXPERT';
  AGENT: 'AGENT';
}>;

export type ChatModeType = typeof ChatMode[keyof typeof ChatMode];

/**
 * Response speaker types
 */
export declare const ResponseSpeaker: Readonly<{
  SYSTEM: 'system';
  ASSISTANT: 'assistant';
  USER: 'user';
  TOOL: 'tool';
  ERROR: 'error';
}>;

export type ResponseSpeakerType = typeof ResponseSpeaker[keyof typeof ResponseSpeaker];

/**
 * Modes requiring user confirmation
 */
export declare const MODES_REQUIRING_CONFIRMATION: readonly ChatModeType[];

/**
 * Response tag for categorizing responses
 */
export declare class ResponseTag {
  readonly mode: ChatModeType;
  readonly speaker: ResponseSpeakerType;
  readonly confidence: number;
  readonly metadata: Record<string, unknown>;

  constructor(options?: {
    mode?: ChatModeType;
    speaker?: ResponseSpeakerType;
    confidence?: number;
    metadata?: Record<string, unknown>;
  });

  toJSON(): {
    mode: ChatModeType;
    speaker: ResponseSpeakerType;
    confidence: number;
    metadata: Record<string, unknown>;
  };

  toString(): string;
}

/**
 * Suggested action for user
 */
export interface SuggestedAction {
  label: string;
  action: string;
  params?: Record<string, unknown>;
}

/**
 * Tagged response with content and metadata
 */
export declare class TaggedResponse {
  readonly content: string;
  readonly tag: ResponseTag;
  readonly actions: SuggestedAction[];
  readonly timestamp: number;

  constructor(options: {
    content: string;
    tag: ResponseTag;
    actions?: SuggestedAction[];
  });

  toJSON(): {
    content: string;
    tag: ReturnType<ResponseTag['toJSON']>;
    actions: SuggestedAction[];
    timestamp: number;
  };

  toString(): string;
}

/**
 * Mode detection result
 */
export declare class ModeDetection {
  readonly mode: ChatModeType;
  readonly confidence: number;
  readonly triggers: string[];
  readonly metadata: Record<string, unknown>;

  constructor(
    mode: ChatModeType,
    confidence: number,
    triggers?: string[],
    metadata?: Record<string, unknown>
  );

  toJSON(): {
    mode: ChatModeType;
    confidence: number;
    triggers: string[];
    metadata: Record<string, unknown>;
  };
}

/**
 * Mode detector for classifying user input
 */
export declare class ModeDetector {
  detect(input: string, context?: Record<string, unknown>): ModeDetection;
}

/**
 * Handler function type
 */
export type HandlerFunction = (
  input: string,
  context: HandlerContext
) => Promise<TaggedResponse | string>;

/**
 * Handler context passed to mode handlers
 */
export interface HandlerContext {
  sessionId: string;
  userId?: string;
  mode: ChatModeType;
  project?: ProjectInfo;
  expert?: ExpertInfo;
  agent?: AgentInfo;
  sessionState?: SessionState;
  config?: Record<string, unknown>;
}

/**
 * Project information
 */
export interface ProjectInfo {
  id: string;
  name: string;
  path?: string;
  [key: string]: unknown;
}

/**
 * Expert information
 */
export interface ExpertInfo {
  id: string;
  name: string;
  intensity?: number;
  [key: string]: unknown;
}

/**
 * Agent information
 */
export interface AgentInfo {
  id: string;
  name: string;
  [key: string]: unknown;
}

/**
 * Session configuration
 */
export interface SessionConfig {
  maxAge: number;
  idleTimeout: number;
  maxSessions: number;
  maxTurnsPerSession: number;
  cleanupInterval: number;
}

/**
 * Project working memory
 */
export interface ProjectWorkingMemory {
  goal?: string;
  activeFile?: string;
  lastArtifactId?: string;
}

/**
 * Session state for maintaining context across turns
 */
export declare class SessionState {
  readonly sessionId: string;
  project: ProjectInfo | null;
  expert: ExpertInfo | null;
  expertIntensity: number;
  projectWorkingMemory: ProjectWorkingMemory;
  lastUserInput: string | null;
  lastDecision: unknown | null;
  lastIntent: string | null;
  pendingDecision: unknown | null;
  awaitingSlots: string[];
  awaitingClarification: boolean;
  lastToolResults: unknown[] | null;
  lastToolResultsTimestamp: number | null;

  constructor(sessionId: string);

  setProject(project: ProjectInfo | null): void;
  setExpert(expert: ExpertInfo | null, options?: { intensity?: number }): void;
  setProjectGoal(goal: string): void;
  setActiveFile(filePath: string): void;
  setLastArtifact(artifactId: string): void;
  recordDecision(decision: unknown, userInput: string): void;
  recordToolResults(results: unknown[]): void;
  setPendingDecision(decision: unknown, awaitingSlots?: string[]): void;
  clearPendingDecision(): void;
  getPendingIntent(): string | null;
  
  saveToStorage(): void;
  clearFromStorage(): void;
  static loadFromStorage(sessionId: string): SessionState | null;
  
  toJSON(): Record<string, unknown>;
  static fromJSON(json: Record<string, unknown>): SessionState;
}

/**
 * Session lifecycle info
 */
export interface SessionLifecycleInfo {
  createdAt: string | null;
  lastActivity: string | null;
  idleMs: number | null;
  ageMs: number | null;
  expiresIn: number | null;
}

/**
 * Session info for API
 */
export interface SessionInfo {
  exists: boolean;
  mode: ChatModeType | null;
  state: ReturnType<SessionState['toJSON']> | null;
  lifecycle: SessionLifecycleInfo | null;
}

/**
 * Session manager statistics
 */
export interface SessionStats {
  totalSessions: number;
  maxSessions: number;
  idleTimeoutMs: number;
  maxAgeMs: number;
  oldestActivityAge: number | null;
  newestActivityAge: number | null;
}

/**
 * Chat request
 */
export interface ChatRequest {
  message: string;
  sessionId: string;
  userId?: string;
  project?: ProjectInfo;
  expert?: ExpertInfo;
  context?: Record<string, unknown>;
}

/**
 * Chat response
 */
export interface ChatResponse {
  response: string;
  mode: ChatModeType;
  confidence: number;
  metadata: Record<string, unknown>;
}

/**
 * Main chat controller class
 */
export declare class ChatController {
  readonly sessionId: string;
  readonly currentMode: ChatModeType;

  constructor(options: {
    sessionId: string;
    handlers?: Record<ChatModeType, HandlerFunction>;
    config?: Partial<SessionConfig>;
  });

  /**
   * Handle a chat message
   */
  handleMessage(input: string, context?: Partial<HandlerContext>): Promise<TaggedResponse>;

  /**
   * Static entry point for HTTP requests
   */
  static handle(request: ChatRequest): Promise<ChatResponse>;

  /**
   * Configure global handlers
   */
  static configure(options: {
    handlers?: Record<ChatModeType, HandlerFunction>;
    config?: Partial<SessionConfig>;
  }): void;

  /**
   * Get session manager instance
   */
  static getSessionManager(): unknown;

  /**
   * Set project for session
   */
  static setProject(sessionId: string, project: ProjectInfo | null): SessionState;

  /**
   * Set expert for session
   */
  static setExpert(
    sessionId: string,
    expert: ExpertInfo | null,
    options?: { intensity?: number }
  ): SessionState;

  /**
   * Get session state
   */
  static getState(sessionId: string): SessionState;

  /**
   * Get session info
   */
  static getSessionInfo(sessionId: string): SessionInfo;

  /**
   * Get all active session IDs
   */
  static getActiveSessions(): string[];

  /**
   * Get session manager statistics
   */
  static getStats(): SessionStats;

  /**
   * Remove a session
   */
  static removeSession(sessionId: string): void;

  /**
   * Stop cleanup timer
   */
  static stopCleanup(): void;
}

/**
 * Create a ChatController instance
 */
export declare function createChatController(
  sessionId: string,
  options?: {
    handlers?: Record<ChatModeType, HandlerFunction>;
    config?: Partial<SessionConfig>;
  }
): ChatController;

/**
 * Create a ResponseTag
 */
export declare function createResponseTag(options?: {
  mode?: ChatModeType;
  speaker?: ResponseSpeakerType;
  confidence?: number;
  metadata?: Record<string, unknown>;
}): ResponseTag;

/**
 * Create a TaggedResponse
 */
export declare function createTaggedResponse(
  content: string,
  tagOptions?: Parameters<typeof createResponseTag>[0],
  actions?: SuggestedAction[]
): TaggedResponse;
