/**
 * @intentsmith/backend-bridge — Frontend proxy
 *
 * Connects to the backend IntentSmithBackendBridgeService via JSON-RPC.
 * Re-emits backend events as Theia Emitter events for widgets to subscribe to.
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core';
import {
  IntentSmithBackendBridge,
  IntentSmithBackendBridgeClient,
  ConnectionResult,
  ConnectionStatus,
} from '../common/backend-bridge-protocol';
import {
  IntentSmithMessage,
  IntentSmithAgentEvent,
  IntentSmithStatusUpdate,
} from '@intentsmith/protocol';

@injectable()
export class IntentSmithBackendBridgeProxy {

  @inject(IntentSmithBackendBridge)
  protected readonly service!: IntentSmithBackendBridge;

  // ─── Event emitters (widgets subscribe to these) ─────────

  private readonly chatMessageEmitter = new Emitter<IntentSmithMessage>();
  readonly onChatMessage: Event<IntentSmithMessage> = this.chatMessageEmitter.event;

  private readonly agentEventEmitter = new Emitter<IntentSmithAgentEvent>();
  readonly onAgentEvent: Event<IntentSmithAgentEvent> = this.agentEventEmitter.event;

  private readonly statusUpdateEmitter = new Emitter<IntentSmithStatusUpdate>();
  readonly onStatusUpdate: Event<IntentSmithStatusUpdate> = this.statusUpdateEmitter.event;

  private readonly connectionChangeEmitter = new Emitter<ConnectionStatus>();
  readonly onConnectionChange: Event<ConnectionStatus> = this.connectionChangeEmitter.event;

  // ─── IntentSmithBackendBridgeClient implementation ────────────────
  // (called by backend via JSON-RPC notifications)

  onChatMessage_callback(message: IntentSmithMessage): void {
    this.chatMessageEmitter.fire(message);
  }

  onAgentEvent_callback(event: IntentSmithAgentEvent): void {
    this.agentEventEmitter.fire(event);
  }

  onStatusUpdate_callback(status: IntentSmithStatusUpdate): void {
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

  async getChatHistory(): Promise<IntentSmithMessage[]> {
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
