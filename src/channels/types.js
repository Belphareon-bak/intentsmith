// C.3 Channel Types — Contract v1.0
// ══════════════════════════════════════════════════════════════════════════════
//
// Normative types for Channel Adapter layer.
// See: docs/channels/CHANNEL_ADAPTER_CONTRACT.md
//
// ══════════════════════════════════════════════════════════════════════════════

import { randomUUID } from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Channel Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Supported channel types
 * @readonly
 * @enum {string}
 */
export const ChannelType = Object.freeze({
  SLACK: 'slack',
  DISCORD: 'discord',
  CLI: 'cli',
  WEB: 'web',
  API: 'api',
});

/**
 * Input content types
 * @readonly
 * @enum {string}
 */
export const ContentType = Object.freeze({
  TEXT: 'text',
  FILE: 'file',
  REACTION: 'reaction',
  COMMAND: 'command',
});

/**
 * Error sources
 * @readonly
 * @enum {string}
 */
export const ErrorSource = Object.freeze({
  VALIDATION: 'validation',
  TIMEOUT: 'timeout',
  RATE_LIMIT: 'rate_limit',
  AUTH: 'auth',
  INTERNAL: 'internal',
});

// ─────────────────────────────────────────────────────────────────────────────
// ChannelCapabilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Channel capabilities declaration.
 * Every adapter MUST declare what its channel supports.
 */
export class ChannelCapabilities {
  constructor({
    // Text formatting
    markdown = false,
    codeBlocks = false,
    maxMessageLength = Infinity,

    // Threading
    threading = false,
    maxThreadDepth = 0,

    // Rich content
    embeds = false,
    reactions = false,
    attachments = false,
    maxAttachmentSize = 0,

    // Visibility
    ephemeral = false,
    editing = false,
    deletion = false,

    // Identity
    userMentions = false,
    channelMentions = false,
  } = {}) {
    this.markdown = markdown;
    this.codeBlocks = codeBlocks;
    this.maxMessageLength = maxMessageLength;
    this.threading = threading;
    this.maxThreadDepth = maxThreadDepth;
    this.embeds = embeds;
    this.reactions = reactions;
    this.attachments = attachments;
    this.maxAttachmentSize = maxAttachmentSize;
    this.ephemeral = ephemeral;
    this.editing = editing;
    this.deletion = deletion;
    this.userMentions = userMentions;
    this.channelMentions = channelMentions;
    Object.freeze(this);
  }

  /**
   * Preset for CLI (minimal capabilities)
   */
  static CLI = new ChannelCapabilities({
    markdown: false,
    codeBlocks: false,
    maxMessageLength: Infinity,
    threading: false,
    ephemeral: false,
  });

  /**
   * Preset for Web UI
   */
  static WEB = new ChannelCapabilities({
    markdown: true,
    codeBlocks: true,
    maxMessageLength: Infinity,
    threading: true,
    maxThreadDepth: 1,
    embeds: true,
    reactions: true,
    ephemeral: true,
  });

  /**
   * Preset for Slack
   */
  static SLACK = new ChannelCapabilities({
    markdown: true,
    codeBlocks: true,
    maxMessageLength: 40000,
    threading: true,
    maxThreadDepth: 1,
    embeds: true,
    reactions: true,
    attachments: true,
    maxAttachmentSize: 1_000_000_000,
    ephemeral: true,
    editing: true,
    deletion: true,
    userMentions: true,
    channelMentions: true,
  });

  /**
   * Preset for Discord
   */
  static DISCORD = new ChannelCapabilities({
    markdown: true,
    codeBlocks: true,
    maxMessageLength: 2000,
    threading: true,
    maxThreadDepth: 1,
    embeds: true,
    reactions: true,
    attachments: true,
    maxAttachmentSize: 25_000_000,
    ephemeral: false,
    editing: true,
    deletion: true,
    userMentions: true,
    channelMentions: true,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// C3InputEvent
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalized input event from any channel.
 * This is the ONLY input format ChatController accepts.
 */
export class C3InputEvent {
  /**
   * @param {Object} options
   * @param {string} [options.correlationId] - UUID, auto-generated if not provided
   * @param {number} [options.timestamp] - Unix ms, defaults to now
   * @param {Object} options.source - Source information
   * @param {string} options.source.channel - Channel type
   * @param {string} [options.source.channelId] - Channel ID
   * @param {string} [options.source.threadId] - Thread ID
   * @param {string} options.source.messageId - Original message ID
   * @param {Object} options.user - User information
   * @param {string} options.user.externalId - External user ID
   * @param {string} [options.user.displayName] - Display name
   * @param {Object} options.content - Content
   * @param {string} options.content.type - Content type
   * @param {string} [options.content.text] - Text content
   * @param {Array} [options.content.attachments] - Attachments
   * @param {Object} [options.hints] - Routing hints
   * @param {ChannelCapabilities} options.capabilities - Channel capabilities
   */
  constructor({
    correlationId,
    timestamp,
    source,
    user,
    content,
    hints = {},
    capabilities,
  }) {
    // Validation
    if (!source?.channel) {
      throw new Error('C3InputEvent: source.channel is required');
    }
    if (!source?.messageId) {
      throw new Error('C3InputEvent: source.messageId is required');
    }
    if (!user?.externalId) {
      throw new Error('C3InputEvent: user.externalId is required');
    }
    if (!content?.type) {
      throw new Error('C3InputEvent: content.type is required');
    }
    if (content.type === ContentType.TEXT && !content.text) {
      throw new Error('C3InputEvent: content.text is required for type TEXT');
    }
    if (!capabilities) {
      throw new Error('C3InputEvent: capabilities is required');
    }

    this.correlationId = correlationId || randomUUID();
    this.timestamp = timestamp || Date.now();

    this.source = Object.freeze({
      channel: source.channel,
      channelId: source.channelId || null,
      threadId: source.threadId || null,
      messageId: source.messageId,
    });

    this.user = Object.freeze({
      externalId: user.externalId,
      displayName: user.displayName || null,
    });

    this.content = Object.freeze({
      type: content.type,
      text: content.text || null,
      attachments: Object.freeze(content.attachments || []),
    });

    this.hints = Object.freeze({
      mentionedBot: hints.mentionedBot || false,
      isDM: hints.isDM || false,
      isEdit: hints.isEdit || false,
      isReply: hints.isReply || false,
      replyToMessageId: hints.replyToMessageId || null,
    });

    this.capabilities = capabilities;

    Object.freeze(this);
  }

  /**
   * Create a simple text input event (convenience factory)
   */
  static text(text, {
    channel = ChannelType.CLI,
    userId = 'anonymous',
    messageId,
    capabilities,
  } = {}) {
    return new C3InputEvent({
      source: {
        channel,
        messageId: messageId || randomUUID(),
      },
      user: {
        externalId: userId,
      },
      content: {
        type: ContentType.TEXT,
        text,
      },
      capabilities: capabilities || ChannelCapabilities.CLI,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// C3OutputEvent
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Output event to be rendered by channel adapter.
 */
export class C3OutputEvent {
  /**
   * @param {Object} options
   * @param {string} options.correlationId - Echo of input correlationId
   * @param {number} [options.timestamp] - Unix ms
   * @param {Object} options.content - Content
   * @param {'text'|'structured'|'error'} options.content.type
   * @param {string} [options.content.text] - Plain text
   * @param {string} [options.content.markdown] - Markdown text
   * @param {unknown} [options.content.structured] - Structured data
   * @param {Object} options.metadata - Response metadata
   * @param {'system'|'expert'|'agent'} options.metadata.speaker
   * @param {'conversation'|'project'|'expert'|'agent'} options.metadata.mode
   * @param {number} options.metadata.confidence - 0.0-1.0
   * @param {boolean} [options.metadata.canExecute] - Has executable actions
   * @param {Object} [options.delivery] - Delivery hints
   */
  constructor({
    correlationId,
    timestamp,
    content,
    metadata,
    delivery = {},
  }) {
    if (!correlationId) {
      throw new Error('C3OutputEvent: correlationId is required');
    }
    if (!content?.type) {
      throw new Error('C3OutputEvent: content.type is required');
    }
    if (!metadata?.speaker) {
      throw new Error('C3OutputEvent: metadata.speaker is required');
    }
    if (!metadata?.mode) {
      throw new Error('C3OutputEvent: metadata.mode is required');
    }
    if (typeof metadata?.confidence !== 'number') {
      throw new Error('C3OutputEvent: metadata.confidence is required');
    }

    this.correlationId = correlationId;
    this.timestamp = timestamp || Date.now();

    this.content = Object.freeze({
      type: content.type,
      text: content.text || null,
      markdown: content.markdown || null,
      structured: content.structured || null,
    });

    this.metadata = Object.freeze({
      speaker: metadata.speaker,
      mode: metadata.mode,
      confidence: metadata.confidence,
      canExecute: metadata.canExecute || false,
    });

    this.delivery = Object.freeze({
      ephemeral: delivery.ephemeral || false,
      replyTo: delivery.replyTo || null,
      priority: delivery.priority || 'normal',
    });

    Object.freeze(this);
  }

  /**
   * Create from TaggedResponse (legacy compatibility)
   */
  static fromTaggedResponse(correlationId, response) {
    return new C3OutputEvent({
      correlationId,
      content: {
        type: 'text',
        text: response.content,
        markdown: response.content, // Assume markdown-compatible
      },
      metadata: {
        speaker: response.speaker,
        mode: response.mode,
        confidence: response.confidence,
        canExecute: response.canExecute,
      },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// C3ErrorEvent
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error event for channel adapters.
 */
export class C3ErrorEvent {
  /**
   * @param {Object} options
   * @param {string} options.correlationId
   * @param {number} [options.timestamp]
   * @param {string} options.source - ErrorSource
   * @param {string} options.code - Error code
   * @param {string} options.userMessage - Safe to display
   * @param {unknown} [options.debugInfo] - For logging only
   * @param {boolean} [options.retryable]
   * @param {number} [options.retryAfterMs]
   */
  constructor({
    correlationId,
    timestamp,
    source,
    code,
    userMessage,
    debugInfo,
    retryable = false,
    retryAfterMs,
  }) {
    if (!correlationId) {
      throw new Error('C3ErrorEvent: correlationId is required');
    }
    if (!source) {
      throw new Error('C3ErrorEvent: source is required');
    }
    if (!code) {
      throw new Error('C3ErrorEvent: code is required');
    }
    if (!userMessage) {
      throw new Error('C3ErrorEvent: userMessage is required');
    }

    this.correlationId = correlationId;
    this.timestamp = timestamp || Date.now();
    this.source = source;
    this.code = code;
    this.userMessage = userMessage;
    this.debugInfo = debugInfo;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;

    Object.freeze(this);
  }

  /**
   * Create a validation error
   */
  static validation(correlationId, message, debugInfo) {
    return new C3ErrorEvent({
      correlationId,
      source: ErrorSource.VALIDATION,
      code: 'INVALID_INPUT',
      userMessage: message,
      debugInfo,
      retryable: false,
    });
  }

  /**
   * Create a rate limit error
   */
  static rateLimited(correlationId, retryAfterMs) {
    return new C3ErrorEvent({
      correlationId,
      source: ErrorSource.RATE_LIMIT,
      code: 'RATE_LIMITED',
      userMessage: 'Too many requests. Please wait a moment.',
      retryable: true,
      retryAfterMs,
    });
  }

  /**
   * Create a timeout error
   */
  static timeout(correlationId) {
    return new C3ErrorEvent({
      correlationId,
      source: ErrorSource.TIMEOUT,
      code: 'TIMEOUT',
      userMessage: 'Request timed out. Please try again.',
      retryable: false,
    });
  }

  /**
   * Create an internal error
   */
  static internal(correlationId, debugInfo) {
    return new C3ErrorEvent({
      correlationId,
      source: ErrorSource.INTERNAL,
      code: 'INTERNAL_ERROR',
      userMessage: 'An internal error occurred. Please try again later.',
      debugInfo,
      retryable: false,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  ChannelType,
  ContentType,
  ErrorSource,
  ChannelCapabilities,
  C3InputEvent,
  C3OutputEvent,
  C3ErrorEvent,
};
