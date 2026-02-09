/**
 * @c3/backend-bridge — Node.js backend service
 *
 * Runs in Theia's backend process. Connects to C3 backend via WebSocket.
 * Handles: protocol handshake, reconnection, event routing, cancel.
 *
 * Architecture:
 *   Theia Frontend ──JSON-RPC──▸ This Service ──WebSocket──▸ C3 Backend
 */

import { injectable } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core';
import WebSocket from 'ws';
import {
  C3BackendBridge,
  C3BackendBridgeClient,
  ConnectionResult,
  ConnectionStatus,
  ConnectionState,
} from '../common/backend-bridge-protocol';
import {
  C3Message,
  C3AgentEvent,
  C3StatusUpdate,
  AgentStatus,
} from '@c3/protocol';
import {
  C3WSIncoming,
  HelloMessage,
  HelloAck,
  HelloReject,
} from '@c3/protocol';
import { PROTOCOL_VERSION, RECONNECT } from '@c3/protocol';

@injectable()
export class C3BackendBridgeService implements C3BackendBridge {

  private ws: WebSocket | null = null;
  private client: C3BackendBridgeClient | undefined;
  private url: string = '';
  private state: ConnectionState = 'disconnected';
  private backendVersion: string = '';
  private agentStatus: AgentStatus = 'idle';
  private reconnectAttempt: number = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private chatHistory: C3Message[] = [];

  // Theia injects this
  protected logger!: ILogger;

  /** Set the frontend client for event notifications */
  setClient(client: C3BackendBridgeClient): void {
    this.client = client;
  }

  // ─── Public API ──────────────────────────────────────────

  async connect(url: string): Promise<ConnectionResult> {
    this.url = url;
    this.reconnectAttempt = 0;
    return this.doConnect();
  }

  async disconnect(): Promise<void> {
    this.cancelReconnect();
    this.setState('disconnected');
    if (this.ws) {
      this.ws.close(1000, 'User disconnect');
      this.ws = null;
    }
  }

  async sendChatMessage(content: string): Promise<void> {
    if (!this.ws || this.state !== 'connected') {
      throw new Error('Not connected to C3 backend');
    }

    // Store user message in local history
    const userMsg: C3Message = {
      id: this.generateId(),
      type: 'user',
      content,
      timestamp: new Date().toISOString(),
    };
    this.chatHistory.push(userMsg);
    this.client?.onChatMessage(userMsg);

    // Send to backend
    this.ws.send(JSON.stringify({
      channel: 'chat',
      data: { content },
    }));
  }

  async cancelExecution(): Promise<void> {
    if (!this.ws || this.state !== 'connected') return;

    this.ws.send(JSON.stringify({
      channel: 'control',
      data: { action: 'cancel' },
    }));
  }

  async getChatHistory(): Promise<C3Message[]> {
    return [...this.chatHistory];
  }

  async getStatus(): Promise<ConnectionStatus> {
    return {
      state: this.state,
      url: this.url,
      backendVersion: this.backendVersion,
      agentStatus: this.agentStatus,
      reconnectAttempt: this.reconnectAttempt,
    };
  }

  // ─── Connection Logic ────────────────────────────────────

  private doConnect(): Promise<ConnectionResult> {
    return new Promise((resolve) => {
      this.setState('connecting');

      try {
        this.ws = new WebSocket(this.url);
      } catch (err) {
        this.setState('disconnected');
        resolve({ success: false, error: `Failed to create WebSocket: ${err}` });
        return;
      }

      const handshakeTimeout = setTimeout(() => {
        this.ws?.close();
        this.setState('disconnected');
        resolve({ success: false, error: 'Handshake timeout (10s)' });
      }, 10000);

      this.ws.on('open', () => {
        this.setState('handshake');

        // Send hello (protocol versioning contract)
        const hello: HelloMessage = {
          type: 'hello',
          protocolVersion: PROTOCOL_VERSION,
          ideVersion: '0.1.0', // TODO: read from package.json
        };
        this.ws!.send(JSON.stringify(hello));
      });

      this.ws.on('message', (raw: WebSocket.Data) => {
        const data = this.parseMessage(raw);
        if (!data) return;

        // Handle handshake
        if (this.state === 'handshake') {
          clearTimeout(handshakeTimeout);

          if (data.type === 'hello_ack') {
            const ack = data as HelloAck;
            this.backendVersion = ack.backendVersion;
            this.setState('connected');
            this.reconnectAttempt = 0;
            resolve({
              success: true,
              backendVersion: ack.backendVersion,
              protocolVersion: ack.protocolVersion,
            });
          } else if (data.type === 'hello_reject') {
            const reject = data as HelloReject;
            this.ws?.close();
            this.setState('disconnected');
            resolve({ success: false, error: reject.reason });
          }
          return;
        }

        // Handle normal messages (post-handshake)
        this.handleMessage(data as C3WSIncoming);
      });

      this.ws.on('close', (code, reason) => {
        const wasConnected = this.state === 'connected';
        this.ws = null;

        if (wasConnected && code !== 1000) {
          // Unexpected close — schedule reconnect
          this.scheduleReconnect();
        } else {
          this.setState('disconnected');
        }
      });

      this.ws.on('error', (err) => {
        this.logger?.error(`C3 WebSocket error: ${err.message}`);
        // 'close' event will follow, which handles reconnect
      });
    });
  }

  // ─── Message Handling ────────────────────────────────────

  private handleMessage(msg: C3WSIncoming): void {
    switch (msg.channel) {
      case 'chat':
        this.chatHistory.push(msg.data);
        this.client?.onChatMessage(msg.data);
        break;

      case 'agent':
        this.client?.onAgentEvent(msg.data);
        // Track agent status from events
        this.updateAgentStatusFromEvent(msg.data);
        break;

      case 'status':
        this.agentStatus = msg.data.agentStatus;
        this.client?.onStatusUpdate(msg.data);
        break;

      case 'control':
        // Control responses (cancel ack, etc.)
        break;
    }
  }

  private updateAgentStatusFromEvent(event: C3AgentEvent): void {
    switch (event.type) {
      case 'turn_start':
        this.agentStatus = 'thinking';
        break;
      case 'llm_start':
        this.agentStatus = 'streaming';
        break;
      case 'tool_call':
        this.agentStatus = 'executing';
        break;
      case 'turn_end':
      case 'error':
        this.agentStatus = 'idle';
        break;
    }
  }

  // ─── Reconnection (exponential backoff) ──────────────────

  private scheduleReconnect(): void {
    this.setState('reconnecting');
    this.reconnectAttempt++;

    const delay = Math.min(
      RECONNECT.INITIAL_DELAY_MS * Math.pow(RECONNECT.BACKOFF_MULTIPLIER, this.reconnectAttempt - 1),
      RECONNECT.MAX_DELAY_MS,
    );

    this.logger?.info(`C3 reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);

    this.reconnectTimer = setTimeout(async () => {
      const result = await this.doConnect();
      if (!result.success) {
        this.scheduleReconnect();
      }
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ─── Helpers ─────────────────────────────────────────────

  private setState(state: ConnectionState): void {
    this.state = state;
    this.client?.onConnectionChange({
      state,
      url: this.url,
      backendVersion: this.backendVersion,
      agentStatus: this.agentStatus,
      reconnectAttempt: this.reconnectAttempt,
    });
  }

  private parseMessage(raw: WebSocket.Data): any | null {
    try {
      return JSON.parse(raw.toString());
    } catch {
      this.logger?.warn('C3 received unparseable WS message');
      return null;
    }
  }

  private generateId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
