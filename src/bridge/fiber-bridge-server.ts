import { WebSocketServer, WebSocket } from 'ws';
import {
  AetherHmrAckPayload,
  AetherPendingWrite,
  HmrHandshakeResult,
} from './handshake.model';

export interface FiberBridgeServerConfig {
  port: number;
  host?: string;
}

export class FiberBridgeServer {
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private pendingWrites = new Map<string, AetherPendingWrite>();
  private ackResolvers = new Map<string, (result: HmrHandshakeResult) => void>();
  private isRunning = false;
  private port: number;
  private host: string;

  constructor(config: FiberBridgeServerConfig) {
    this.port = config.port;
    this.host = config.host || '127.0.0.1';
  }

  public getPort(): number {
    return this.port;
  }

  public getWsUrl(): string {
    return `ws://${this.host}:${this.port}`;
  }

  public getConnectedClientsCount(): number {
    return this.clients.size;
  }

  public async start(): Promise<string> {
    if (this.isRunning) {
      return this.getWsUrl();
    }

    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port: this.port, host: this.host }, () => {
        this.isRunning = true;
        resolve(this.getWsUrl());
      });

      this.wss.on('connection', (ws) => {
        this.clients.add(ws);

        ws.on('message', (data: string) => {
          this.handleIncomingMessage(data.toString());
        });

        ws.on('close', () => {
          this.clients.delete(ws);
        });

        ws.on('error', () => {
          this.clients.delete(ws);
        });
      });

      this.wss.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Registers an upcoming candidate AST write with the bridge and notifies connected sandbox clients.
   */
  public registerPendingWrite(pending: AetherPendingWrite): void {
    this.pendingWrites.set(pending.txId, pending);

    const payload = JSON.stringify({
      type: 'AETHER_PENDING_WRITE',
      ...pending,
    });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  /**
   * Waits for the browser's `AETHER_HMR_ACK` response confirming the live DOM update.
   */
  public async waitForHmrAck(txId: string, timeoutMs = 3000): Promise<HmrHandshakeResult> {
    const pending = this.pendingWrites.get(txId);
    if (!pending) {
      return {
        txId,
        targetUid: '',
        success: false,
        verified: false,
        latencyMs: 0,
        error: `No pending write registered for txId: "${txId}"`,
      };
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.ackResolvers.delete(txId);
        this.pendingWrites.delete(txId);
        resolve({
          txId,
          targetUid: pending.targetUid,
          success: false,
          verified: false,
          latencyMs: timeoutMs,
          error: `HMR handshake timeout after ${timeoutMs}ms waiting for AETHER_HMR_ACK`,
        });
      }, timeoutMs);

      this.ackResolvers.set(txId, (result) => {
        clearTimeout(timer);
        this.ackResolvers.delete(txId);
        this.pendingWrites.delete(txId);
        resolve(result);
      });
    });
  }

  private handleIncomingMessage(rawMessage: string): void {
    try {
      const msg: AetherHmrAckPayload = JSON.parse(rawMessage);
      if (msg.type !== 'AETHER_HMR_ACK') return;

      const resolver = this.ackResolvers.get(msg.txId);
      const pending = this.pendingWrites.get(msg.txId);

      if (resolver && pending) {
        // Perform verification checks
        const verificationDetails = this.validateSignature(pending, msg);
        const verified = msg.verified && verificationDetails.mismatches.length === 0;

        msg.verificationDetails = verificationDetails;
        msg.verified = verified;

        resolver({
          txId: msg.txId,
          targetUid: msg.targetUid,
          success: true,
          verified,
          latencyMs: msg.latencyMs,
          ackPayload: msg,
          error: verified ? undefined : `DOM mismatches: ${verificationDetails.mismatches.join('; ')}`,
        });
      }
    } catch (e: any) {
      console.error('[Fiber Bridge] Failed to process message', e);
    }
  }

  private validateSignature(
    pending: AetherPendingWrite,
    ack: AetherHmrAckPayload
  ): { tagMatches: boolean; propsMatch: boolean; stylesMatch: boolean; textMatches: boolean; mismatches: string[] } {
    const mismatches: string[] = [];
    const sig = ack.domSignature;

    if (!sig) {
      return {
        tagMatches: false,
        propsMatch: false,
        stylesMatch: false,
        textMatches: false,
        mismatches: ['DOM signature not provided by browser'],
      };
    }

    // 1. Tag match
    let tagMatches = true;
    if (pending.expectedTag && sig.tagName.toLowerCase() !== pending.expectedTag.toLowerCase()) {
      tagMatches = false;
      mismatches.push(`Expected tag <${pending.expectedTag}> but found <${sig.tagName}>`);
    }

    // 2. Props/attributes match
    let propsMatch = true;
    if (pending.expectedProps) {
      for (const [key, expectedVal] of Object.entries(pending.expectedProps)) {
        const actualVal = sig.attributes[key];
        if (actualVal !== expectedVal) {
          propsMatch = false;
          mismatches.push(`Attribute "${key}" expected "${expectedVal}" but was "${actualVal}"`);
        }
      }
    }

    // 3. Styles match
    let stylesMatch = true;
    if (pending.expectedStyles && sig.computedStyles) {
      for (const [key, expectedVal] of Object.entries(pending.expectedStyles)) {
        const actualVal = sig.computedStyles[key];
        if (actualVal && actualVal !== expectedVal) {
          stylesMatch = false;
          mismatches.push(`Style "${key}" expected "${expectedVal}" but was "${actualVal}"`);
        }
      }
    }

    // 4. Text match
    let textMatches = true;
    if (pending.expectedText !== undefined && sig.textContent !== undefined) {
      if (sig.textContent !== pending.expectedText) {
        textMatches = false;
        mismatches.push(`Text content expected "${pending.expectedText}" but was "${sig.textContent}"`);
      }
    }

    return {
      tagMatches,
      propsMatch,
      stylesMatch,
      textMatches,
      mismatches,
    };
  }

  public async stop(): Promise<void> {
    if (!this.wss) return;

    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();

    return new Promise((resolve) => {
      this.wss!.close(() => {
        this.wss = null;
        this.isRunning = false;
        resolve();
      });
    });
  }
}
