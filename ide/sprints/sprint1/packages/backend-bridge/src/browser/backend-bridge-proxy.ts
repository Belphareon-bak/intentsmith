/**
 * @c3/backend-bridge — Frontend proxy
 *
 * Connects to the backend C3BackendBridgeService via JSON-RPC.
 * Re-emits backend events as Theia Emitter events for widgets to subscribe to.
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core';
import {
  C3BackendBridge,
  C3BackendBridgeClient,
  ConnectionResult,
  ConnectionStatus,
} from '../common/backend-bridge-protocol';
import {
  C3Message,
  C3AgentEvent,
  C3StatusUpdate,
} from '@c3/protocol';

@injectable()
export class C3BackendBridgeProxy implements C3BackendBridgeClient {

  @inject(C3BackendBridge)
  protected readonly service!: C3BackendBridge;

  // ─── Event emitters (widgets subscribe to these) ─────────

  private readonly chatMessageEmitter = new Emitter<C3Message>();
  readonly onChatMessage: Event<C3Message> = this.chatMessageEmitter.event;

  private readonly agentEventEmitter = new Emitter<C3AgentEvent>();
  readonly onAgentEvent: Event<C3AgentEvent> = this.agentEventEmitter.event;

  private readonly statusUpdateEmitter = new Emitter<C3StatusUpdate>();
  readonly onStatusUpdate: Event<C3StatusUpdate> = this.statusUpdateEmitter.event;

  private readonly connectionChangeEmitter = new Emitter<ConnectionStatus>();
  readonly onConnectionChange: Event<ConnectionStatus> = this.connectionChangeEmitter.event;

  // ─── C3BackendBridgeClient implementation ────────────────
  // (called by backend via JSON-RPC notifications)

  onChatMessage_callback(message: C3Message): void {
    this.chatMessageEmitter.fire(message);
  }

  onAgentEvent_callback(event: C3AgentEvent): void {
    this.agentEventEmitter.fire(event);
  }

  onStatusUpdate_callback(status: C3StatusUpdate): void {
    this.statusUpdateEmitter.fire(status);
  }

  onConnectionChange_callback(status: ConnectionStatus): void {
    this.connectionChangeEmitter.fire(status);
  }

  // ─── Proxy methods (delegate to backend service) ─────────

  async connect(url: string): Promise<ConnectionResult> {
    return this.service.connect(url);
  }

  async disconnect(): Promise<void> {
    return this.service.disconnect();
  }

  async sendChatMessage(content: string): Promise<void> {
    return this.service.sendChatMessage(content);
  }

  async cancelExecution(): Promise<void> {
    return this.service.cancelExecution();
  }

  async getChatHistory(): Promise<C3Message[]> {
    return this.service.getChatHistory();
  }

  async getStatus(): Promise<ConnectionStatus> {
    return this.service.getStatus();
  }

  // ─── Lifecycle ───────────────────────────────────────────

  dispose(): void {
    this.chatMessageEmitter.dispose();
    this.agentEventEmitter.dispose();
    this.statusUpdateEmitter.dispose();
    this.connectionChangeEmitter.dispose();
  }
}
