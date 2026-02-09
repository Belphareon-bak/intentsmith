/**
 * C3 Chat Panel Widget — Theia ReactWidget
 *
 * PRINCIPLE: Chat panel shows ONLY conversation.
 * No logs, no tool calls, no CRE decisions. Just dialog.
 *
 * Agent events go to Agent Log panel (separate widget).
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget, Message } from '@theia/core/lib/browser';
import { C3BackendBridgeProxy } from '../../backend-bridge/src/browser/backend-bridge-proxy';
import { C3Message, AgentStatus } from '@c3/protocol';
import { ConnectionStatus, ConnectionState } from '../../backend-bridge/src/common/backend-bridge-protocol';
import { DEFAULT_WS_URL } from '@c3/protocol';
import { ChatMessage } from './components/ChatMessage';
import { ChatInput } from './components/ChatInput';
import { StreamingIndicator } from './components/StreamingIndicator';

import './styles/chat-panel.css';

@injectable()
export class C3ChatPanelWidget extends ReactWidget {

  static readonly ID = 'c3:chat-panel';
  static readonly LABEL = 'C3 Chat';

  @inject(C3BackendBridgeProxy)
  protected readonly bridge!: C3BackendBridgeProxy;

  // ─── State ─────────────────────────────────────────────

  private messages: C3Message[] = [];
  private streamingMessage: C3Message | null = null;
  private connectionState: ConnectionState = 'disconnected';
  private agentStatus: AgentStatus = 'idle';
  private showIntentBadges: boolean = false; // toggle via settings
  private messagesEndRef: HTMLDivElement | null = null;

  constructor() {
    super();
    this.id = C3ChatPanelWidget.ID;
    this.title.label = C3ChatPanelWidget.LABEL;
    this.title.closable = true;
    this.title.iconClass = 'codicon codicon-comment-discussion';
    this.addClass('c3-chat-panel');
  }

  @postConstruct()
  protected init(): void {
    this.subscribeToEvents();
    this.autoConnect();
    this.update();
  }

  // ─── Event Subscriptions ───────────────────────────────

  private subscribeToEvents(): void {
    // Chat messages
    this.bridge.onChatMessage(msg => {
      if (msg.type === 'assistant') {
        // If we were streaming, finalize the streaming message
        if (this.streamingMessage) {
          this.streamingMessage = null;
        }
        this.messages.push(msg);
      } else if (msg.type === 'user') {
        // User messages already added locally in sendMessage
        // but may come from backend on reconnect/history sync
        const exists = this.messages.some(m => m.id === msg.id);
        if (!exists) {
          this.messages.push(msg);
        }
      } else {
        this.messages.push(msg);
      }
      this.update();
      this.scrollToBottom();
    });

    // Agent events — only care about streaming tokens + status
    this.bridge.onAgentEvent(event => {
      switch (event.type) {
        case 'llm_start':
          this.agentStatus = 'streaming';
          // Create streaming placeholder
          this.streamingMessage = {
            id: `streaming-${event.turnId}`,
            type: 'assistant',
            content: '',
            timestamp: event.timestamp,
          };
          this.update();
          this.scrollToBottom();
          break;

        case 'llm_token':
          if (this.streamingMessage && 'token' in event.payload) {
            this.streamingMessage.content += (event.payload as any).token;
            this.update();
            this.scrollToBottom();
          }
          break;

        case 'llm_done':
          // Final message will arrive via chat channel
          this.agentStatus = 'idle';
          this.update();
          break;

        case 'turn_start':
          this.agentStatus = 'thinking';
          this.update();
          break;

        case 'turn_end':
        case 'error':
          this.agentStatus = 'idle';
          this.streamingMessage = null;
          this.update();
          break;
      }
    });

    // Connection status
    this.bridge.onConnectionChange(status => {
      this.connectionState = status.state;
      if (status.agentStatus) {
        this.agentStatus = status.agentStatus;
      }
      this.update();
    });
  }

  // ─── Auto-connect on startup ───────────────────────────

  private async autoConnect(): Promise<void> {
    // TODO: read URL from preferences (c3.backend.url)
    const result = await this.bridge.connect(DEFAULT_WS_URL);
    if (result.success) {
      // Load chat history
      const history = await this.bridge.getChatHistory();
      this.messages = history;
      this.update();
      this.scrollToBottom();
    }
  }

  // ─── Actions ───────────────────────────────────────────

  private handleSend = async (content: string): Promise<void> => {
    try {
      await this.bridge.sendChatMessage(content);
    } catch (err) {
      // Add error as system message
      this.messages.push({
        id: `error-${Date.now()}`,
        type: 'system',
        content: `Chyba při odesílání: ${err}`,
        timestamp: new Date().toISOString(),
      });
      this.update();
    }
  };

  private handleCancel = async (): Promise<void> => {
    await this.bridge.cancelExecution();
    this.agentStatus = 'idle';
    this.streamingMessage = null;
    this.update();
  };

  private scrollToBottom(): void {
    // Use requestAnimationFrame to ensure DOM is updated
    requestAnimationFrame(() => {
      this.messagesEndRef?.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // ─── Render ────────────────────────────────────────────

  protected render(): React.ReactNode {
    const isProcessing = this.agentStatus !== 'idle' && this.agentStatus !== 'disconnected';
    const isStreaming = this.agentStatus === 'streaming' && this.streamingMessage != null;
    const isDisconnected = this.connectionState === 'disconnected';

    return (
      <div className="c3-chat-container">

        {/* Connection banner */}
        {this.renderConnectionBanner()}

        {/* Message list */}
        <div className="c3-chat-messages">
          {this.messages.length === 0 && !isProcessing ? (
            <div className="c3-chat-empty">
              Začni konverzaci — napiš něco do pole níže.
            </div>
          ) : (
            <>
              {this.messages.map(msg => (
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  showIntentBadge={this.showIntentBadges}
                />
              ))}

              {/* Streaming in progress */}
              {isStreaming && this.streamingMessage && (
                <ChatMessage
                  key="streaming"
                  message={this.streamingMessage}
                  isStreaming={true}
                />
              )}

              {/* Thinking (before first token) */}
              {this.agentStatus === 'thinking' && !this.streamingMessage && (
                <StreamingIndicator />
              )}
            </>
          )}

          <div ref={el => { this.messagesEndRef = el; }} />
        </div>

        {/* Input */}
        <ChatInput
          onSend={this.handleSend}
          onCancel={this.handleCancel}
          isProcessing={isProcessing}
          isStreaming={isStreaming}
          disabled={isDisconnected}
        />
      </div>
    );
  }

  private renderConnectionBanner(): React.ReactNode {
    switch (this.connectionState) {
      case 'disconnected':
        return (
          <div className="c3-chat-banner disconnected">
            🔴 Odpojeno od C3 backendu
          </div>
        );
      case 'reconnecting':
        return (
          <div className="c3-chat-banner reconnecting">
            🔄 Znovu se připojuji...
          </div>
        );
      default:
        return null;
    }
  }

  // ─── Theia Widget lifecycle ────────────────────────────

  protected onActivateRequest(msg: Message): void {
    super.onActivateRequest(msg);
    // Focus the textarea when panel is activated
    const textarea = this.node.querySelector('.c3-chat-textarea') as HTMLTextAreaElement;
    textarea?.focus();
  }
}
