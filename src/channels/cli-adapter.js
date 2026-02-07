// C.3 CLI Adapter — Contract v1.0 Reference Implementation
// ══════════════════════════════════════════════════════════════════════════════
//
// Reference implementation of the Channel Adapter contract.
// This adapter is used for:
//   - Local development and debugging
//   - Contract validation
//   - Integration testing
//
// See: docs/channels/CHANNEL_ADAPTER_CONTRACT.md
//
// ══════════════════════════════════════════════════════════════════════════════

import { createInterface } from 'readline';
import { randomUUID } from 'crypto';
import {
  C3InputEvent,
  C3OutputEvent,
  C3ErrorEvent,
  ChannelType,
  ContentType,
  ChannelCapabilities,
} from './types.js';
import { logger } from '../core/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// CLI Adapter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CLI Adapter — Reference implementation for Channel Adapter contract.
 *
 * Features:
 * - stdin → C3InputEvent
 * - C3OutputEvent → stdout
 * - No rate limiting (local development)
 * - No authentication (trusted environment)
 *
 * @example
 *   const adapter = new CLIAdapter({ userId: 'dev-user' });
 *   adapter.onMessage(async (event) => {
 *     const response = await controller.processEvent(event);
 *     adapter.sendResponse(response);
 *   });
 *   await adapter.start();
 */
export class CLIAdapter {
  #status = 'stopped';
  #readline = null;
  #messageCallback = null;
  #userId;
  #sessionId;
  #messageCount = 0;
  #startTime = null;

  /**
   * CLI capabilities (minimal)
   */
  static capabilities = new ChannelCapabilities({
    markdown: false,
    codeBlocks: false,
    maxMessageLength: Infinity,
    threading: false,
    maxThreadDepth: 0,
    embeds: false,
    reactions: false,
    attachments: false,
    maxAttachmentSize: 0,
    ephemeral: false,
    editing: false,
    deletion: false,
    userMentions: false,
    channelMentions: false,
  });

  /**
   * @param {Object} options
   * @param {string} [options.userId] - User ID for input events
   * @param {string} [options.sessionId] - Session ID
   * @param {string} [options.prompt] - Input prompt
   */
  constructor({
    userId = 'cli-user',
    sessionId,
    prompt = 'You> ',
  } = {}) {
    this.#userId = userId;
    this.#sessionId = sessionId || randomUUID();
    this.prompt = prompt;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Start the adapter (begin reading from stdin)
   */
  async start() {
    if (this.#status !== 'stopped') {
      throw new Error('CLIAdapter is already running');
    }

    this.#status = 'starting';
    this.#startTime = Date.now();

    this.#readline = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    // Handle input
    this.#readline.on('line', async (line) => {
      await this.#handleInput(line);
    });

    // Handle close
    this.#readline.on('close', () => {
      this.#status = 'stopped';
      logger.info('CLIAdapter', 'Session ended');
    });

    this.#status = 'connected';
    logger.info('CLIAdapter', 'Started', { sessionId: this.#sessionId });

    // Show initial prompt
    this.#showPrompt();
  }

  /**
   * Stop the adapter
   */
  async stop() {
    if (this.#readline) {
      this.#readline.close();
      this.#readline = null;
    }
    this.#status = 'stopped';
    logger.info('CLIAdapter', 'Stopped');
  }

  /**
   * Restart the adapter
   */
  async restart() {
    await this.stop();
    await this.start();
  }

  /**
   * Get adapter status
   */
  status() {
    return this.#status;
  }

  /**
   * Health check
   */
  async healthCheck() {
    return {
      healthy: this.#status === 'connected',
      latencyMs: 0, // Local, no latency
      checkedAt: Date.now(),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Event Handling
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Register message callback
   * @param {Function} callback - (C3InputEvent) => Promise<void>
   */
  onMessage(callback) {
    if (typeof callback !== 'function') {
      throw new Error('Callback must be a function');
    }
    this.#messageCallback = callback;
  }

  /**
   * Send response to stdout
   * @param {C3OutputEvent} event
   */
  sendResponse(event) {
    if (!(event instanceof C3OutputEvent)) {
      logger.error('CLIAdapter', 'sendResponse: Invalid event type');
      return;
    }

    // Render for CLI (plain text, no markdown)
    const text = event.content.text || event.content.markdown || '';

    // Add speaker prefix if not system
    const prefix = event.metadata.speaker !== 'system'
      ? `[${event.metadata.speaker}] `
      : '';

    console.log(`\nC.3> ${prefix}${text}\n`);

    // Show prompt again
    this.#showPrompt();
  }

  /**
   * Send error to stdout
   * @param {C3ErrorEvent} event
   */
  sendError(event) {
    if (!(event instanceof C3ErrorEvent)) {
      logger.error('CLIAdapter', 'sendError: Invalid event type');
      return;
    }

    console.error(`\n[ERROR] ${event.userMessage}\n`);

    // Log debug info if available
    if (event.debugInfo) {
      logger.debug('CLIAdapter', 'Error details', event.debugInfo);
    }

    // Show prompt again
    this.#showPrompt();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Metrics
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get adapter metrics
   */
  getMetrics() {
    return {
      messagesReceived: this.#messageCount,
      messagesSent: this.#messageCount, // 1:1 in CLI
      errorsCount: 0, // Not tracked
      avgLatencyMs: 0, // Local
      uptime: this.#startTime ? Math.floor((Date.now() - this.#startTime) / 1000) : 0,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private
  // ─────────────────────────────────────────────────────────────────────────

  #showPrompt() {
    if (this.#readline && this.#status === 'connected') {
      this.#readline.prompt();
    }
  }

  async #handleInput(line) {
    const text = line.trim();

    // Skip empty input
    if (!text) {
      this.#showPrompt();
      return;
    }

    // Handle exit commands
    if (['exit', 'quit', 'q', ':q'].includes(text.toLowerCase())) {
      console.log('\nGoodbye!\n');
      await this.stop();
      process.exit(0);
    }

    // Create C3InputEvent
    const event = new C3InputEvent({
      correlationId: randomUUID(),
      timestamp: Date.now(),
      source: {
        channel: ChannelType.CLI,
        messageId: `cli-${++this.#messageCount}`,
      },
      user: {
        externalId: this.#userId,
        displayName: this.#userId,
      },
      content: {
        type: ContentType.TEXT,
        text,
      },
      hints: {
        mentionedBot: true, // Always addressed to bot in CLI
        isDM: true,
        isEdit: false,
        isReply: false,
      },
      capabilities: CLIAdapter.capabilities,
    });

    // Forward to callback
    if (this.#messageCallback) {
      try {
        await this.#messageCallback(event);
      } catch (error) {
        logger.error('CLIAdapter', `Callback error: ${error.message}`);
        this.sendError(C3ErrorEvent.internal(event.correlationId, {
          error: error.message,
        }));
      }
    } else {
      console.log('\n[No handler registered]\n');
      this.#showPrompt();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default CLIAdapter;
