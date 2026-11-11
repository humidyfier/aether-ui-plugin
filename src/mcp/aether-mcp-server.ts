import * as readline from 'node:readline';
import * as path from 'node:path';
import { AetherEngine } from '../engine/aether-engine';
import { StudioServer } from '../server/studio-server';
import { HandoffExporter } from '../server/handoff-exporter';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    required?: string[];
    properties?: Record<string, any>;
  };
}

export const AETHER_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'aether_status',
    description:
      'Inspect current Aether UI lifecycle state, active selection (data-aether-uid), revision pointers, slot statuses, and brief readiness.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'aether_submit_context',
    description:
      'STEP 1 of Aether UI workflow. PRIMARY ENTRYPOINT for any frontend, UI/UX design, prototyping, or web application request. Ingests user intent, project purpose, target audience, and primary tasks (FR-01). You MUST call this FIRST before calling aether_generate_ux. Never write raw HTML files to disk.',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string', description: 'Product purpose and core context' },
        name: { type: 'string', description: 'Project name' },
        targetAudience: { type: 'array', description: 'Audience profiles' },
        primaryTasks: { type: 'array', description: 'Primary task goals' },
      },
    },
  },
  {
    name: 'aether_generate_ux',
    description:
      'STEP 2 of Aether UI workflow. Synthesizes 2-3 distinct UX alternative directions into interactive visual cards attached above the composer in Hermes Desktop (FR-02). Prerequisite: Call aether_submit_context first. CRITICAL: After calling this tool, present a 2-3 sentence summary in chat and STOP AND WAIT for the user to choose their UX direction. DO NOT call aether_select_ux or aether_generate_ui on the same turn.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'aether_select_ux',
    description:
      'STEP 3 of Aether UI workflow. Lock and select a UX direction after the user has reviewed the cards and chosen a direction. DO NOT CALL THIS in the same automated turn as aether_generate_ux (< 2s) without user selection — it will be rejected with WAIT_FOR_USER.',
    inputSchema: {
      type: 'object',
      properties: {
        directionId: { type: 'string', description: 'ID, title, or index of chosen UXDirection' },
        uxDirectionId: { type: 'string', description: 'Alias for directionId' },
        title: { type: 'string', description: 'Title of the chosen UXDirection' },
        name: { type: 'string', description: 'Name/title of the chosen UXDirection' },
        index: { type: 'number', description: 'Zero-based index of direction' },
        rationale: { type: 'string', description: 'Rationale for selection' },
      },
    },
  },
  {
    name: 'aether_generate_ui',
    description:
      'STEP 4 of Aether UI workflow. Synthesizes 2-3 visual design concepts with palettes, typography, and density into interactive visual cards attached above the composer in Hermes Desktop (FR-04 to FR-08). STRICT PREREQUISITE: Can ONLY be called after aether_submit_context and aether_generate_ux have completed AND the user has selected a UX direction. Fails with PRECONDITION_FAILED if called prematurely. CRITICAL: After calling this tool, present a brief 2-sentence summary in chat and STOP AND WAIT for the user to select their UI concept from the cards. DO NOT call aether_select_ui on the same turn.',
    inputSchema: {
      type: 'object',
      properties: {
        refinement: { type: 'string', description: 'Optional refinement prompt (e.g. Darker neon tones, high contrast)' },
      },
    },
  },
  {
    name: 'aether_select_ui',
    description:
      'STEP 5 of Aether UI workflow. Selects a visual UI concept after the user has reviewed the cards and chosen a concept, transitioning to live dual-slot preview sandboxes (FR-09). STRICT PREREQUISITE: Requires an already-selected UX direction and generated UI concepts. DO NOT CALL THIS in the same automated turn as aether_generate_ui (< 2s) without user selection — it will be rejected with WAIT_FOR_USER.',
    inputSchema: {
      type: 'object',
      properties: {
        conceptId: { type: 'string', description: 'ID, name, title, or index of chosen UIConcept (e.g. "ui_gen1_concept1", "1.1", or "Modern Precision")' },
        uiConceptId: { type: 'string', description: 'Alias for conceptId' },
        title: { type: 'string', description: 'Name/title of the chosen UIConcept' },
        name: { type: 'string', description: 'Name/title of the chosen UIConcept' },
        index: { type: 'number', description: 'Zero-based index of concept' },
      },
    },
  },
  {
    name: 'aether_edit_component',
    description:
      'Apply a scoped edit to a component element by data-aether-uid in Slot B candidate sandbox with deterministic AST surgery and tiered validation.',
    inputSchema: {
      type: 'object',
      required: ['targetUid'],
      properties: {
        targetUid: { type: 'string', description: 'Target element data-aether-uid' },
        filePath: { type: 'string', description: 'Relative path to component file' },
        classes: { type: 'string', description: 'Tailwind classes to merge' },
        text: { type: 'string', description: 'New text content' },
        operations: { type: 'array', description: 'Raw EditTxMutation operations' },
      },
    },
  },
  {
    name: 'aether_approve_promote',
    description:
      'Review and approve candidate implementation, stripping dev UIDs and promoting verified changes from Slot B to host (FR-19).',
    inputSchema: {
      type: 'object',
      properties: {
        confirmSharedBlastRadius: {
          type: 'boolean',
          description: 'Elevated confirmation if shared component blast radius > 1 page',
        },
        forceIfStaleHost: { type: 'boolean', description: 'Override stale host check' },
      },
    },
  },
  {
    name: 'aether_restore_checkpoint',
    description: 'Rollback workspace to a previous checkpoint in either runnable or visual recovery mode.',
    inputSchema: {
      type: 'object',
      required: ['checkpointId'],
      properties: {
        checkpointId: { type: 'string', description: 'ID of checkpoint to restore' },
        mode: { type: 'string', enum: ['runnable', 'visual'], description: 'Recovery mode' },
      },
    },
  },
  {
    name: 'aether_export_handoff',
    description:
      'Export full production handoff package including ProjectBrief, UX, UI tokens, component symbol inventory, Merkle manifest, and audit score in Markdown or JSON (FR-20).',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['markdown', 'json', 'all'], description: 'Export format' },
      },
    },
  },
];

export interface McpServerConfig {
  serverUrl?: string;
  engine?: AetherEngine;
  hostRootDir?: string;
  port?: number;
}

export class AetherMcpServer {
  private serverUrl: string;
  private engine?: AetherEngine;
  private studioServer?: StudioServer;
  private port: number;
  private hostRootDir: string;

  constructor(config: McpServerConfig = {}) {
    this.port = config.port || 4173;
    this.serverUrl = config.serverUrl || `http://127.0.0.1:${this.port}`;
    this.engine = config.engine;
    this.hostRootDir = path.resolve(config.hostRootDir || process.cwd());
  }

  public getServerUrl(): string {
    return this.serverUrl;
  }

  public getEngine(): AetherEngine | undefined {
    return this.engine;
  }

  /**
   * Ensures an active StudioServer instance is available.
   * If an engine was provided, starts an internal StudioServer if not already running.
   */
  public async ensureServerRunning(): Promise<string> {
    try {
      const healthRes = await fetch(`${this.serverUrl}/api/health`, { signal: AbortSignal.timeout(600) });
      if (healthRes.ok) {
        const health = await healthRes.json();
        if (health.status === 'ok') {
          return this.serverUrl;
        }
      }
    } catch {
      // Server not reachable yet, will spawn
    }

    if (!this.engine) {
      this.engine = new AetherEngine({
        hostRootDir: this.hostRootDir,
        slotAPort: this.port + 1,
        slotBPort: this.port + 2,
        mode: 'mock_http',
      });
      await this.engine.initialize(true);
    }

    if (!this.studioServer) {
      this.studioServer = new StudioServer(this.engine, { port: this.port, host: '127.0.0.1' });
      await this.studioServer.start();
    }

    return this.serverUrl;
  }

  public async stop(): Promise<void> {
    if (this.studioServer) {
      await this.studioServer.stop();
      this.studioServer = undefined;
    }
    if (this.engine) {
      await this.engine.stop();
      this.engine = undefined;
    }
  }

  /**
   * Handles incoming MCP / JSON-RPC 2.0 messages.
   */
  public async handleJsonRpcMessage(req: any): Promise<any> {
    const { id, method, params } = req;

    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: {
            name: 'aether-mcp-server',
            version: '1.0.0',
          },
        },
      };
    }

    if (method === 'notifications/initialized') {
      return null;
    }

    if (method === 'ping') {
      return { jsonrpc: '2.0', id, result: {} };
    }

    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: AETHER_MCP_TOOLS,
        },
      };
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const args = params?.arguments || {};

      try {
        const toolResult = await this.executeTool(toolName, args);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2),
              },
            ],
            isError: false,
          },
        };
      } catch (err: any) {
        const errPayload: any = {
          isError: true,
          error: err.message,
        };
        if (err.validOptions) {
          errPayload.validOptions = err.validOptions;
        }
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(errPayload, null, 2),
              },
            ],
            isError: true,
          },
        };
      }
    }

    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  }

  /**
   * Helper to perform HTTP fetch and throw when HTTP status is an error or data.success is false.
   */
  private async fetchJson(url: string, init?: RequestInit): Promise<any> {
    const res = await fetch(url, init);
    let data: any;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      data = { text: await res.text() };
    }
    if (!res.ok) {
      const errMsg = data?.error || data?.errors?.join(', ') || `HTTP ${res.status}: ${res.statusText}`;
      const err: any = new Error(errMsg);
      if (data?.validOptions) {
        err.validOptions = data.validOptions;
      }
      throw err;
    }
    if (data && typeof data === 'object' && (data.success === false || data.isError === true)) {
      const errMsg = data.error || data.errors?.join(', ') || 'Operation failed';
      const err: any = new Error(errMsg);
      if (data.validOptions) {
        err.validOptions = data.validOptions;
      }
      throw err;
    }
    return data;
  }

  /**
   * Resolves the authoritative active session ID:
   * Uses rawSessionId if non-empty and non-placeholder; otherwise resolves to
   * the focused Hermes Desktop session via StudioServer. Throws if no active session is focused.
   */
  private async resolveSessionId(rawSessionId?: string): Promise<string> {
    const trimmed = rawSessionId ? String(rawSessionId).trim() : '';
    if (trimmed && trimmed !== 'default' && trimmed !== 'null' && trimmed !== 'undefined' && trimmed !== 'new') {
      return trimmed;
    }
    try {
      const focusRes = await this.fetchJson(`${this.serverUrl}/api/session/focus`);
      if (focusRes && focusRes.focusedDesktopSessionId) {
        return focusRes.focusedDesktopSessionId;
      }
    } catch {}
    if (process.env.NODE_ENV === 'test' || process.env.NODE_TEST_CONTEXT) {
      return 'test-session-hermes';
    }
    throw new Error('No active Hermes conversation is focused. Open or start a conversation in Hermes Desktop first.');
  }

  /**
   * Executes a specific tool by dispatching to the StudioServer REST API.
   */
  public async executeTool(name: string, args: Record<string, any>): Promise<any> {
    await this.ensureServerRunning();

    switch (name) {
      case 'aether_status': {
        const sessionId = await this.resolveSessionId(args.sessionId);
        const state = await this.fetchJson(`${this.serverUrl}/api/state?sessionId=${encodeURIComponent(sessionId)}`);
        try {
          const health = await this.fetchJson(`${this.serverUrl}/api/health`);
          state.health = health;
        } catch {
          // ignore
        }
        return state;
      }

      case 'aether_submit_context': {
        const sessionId = await this.resolveSessionId(args.sessionId);
        return await this.fetchJson(`${this.serverUrl}/api/session/context`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...args, sessionId }),
        });
      }

      case 'aether_generate_ux': {
        const sessionId = await this.resolveSessionId(args.sessionId);
        const payload = {
          sessionId,
          promptSummary: args.promptSummary || args.text,
          refinement: args.refinement || args.promptSummary || args.text,
        };
        const res = await this.fetchJson(`${this.serverUrl}/api/ux/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        return {
          success: true,
          sessionId,
          generationNumber: res.generation?.generationNumber || 1,
          directionsGenerated: (res.generation?.directions || []).length,
          directions: (res.generation?.directions || []).map((d: any) => ({
            id: d.id,
            title: d.title,
            archetype: d.archetype,
            keyFlow: d.keyFlow,
            strengths: d.strengths,
            tradeOff: d.tradeOff,
          })),
          summary: `Synthesized ${res.generation?.directions?.length || 3} UX directions (Generation ${res.generation?.generationNumber || 1}) in the conversation-attached horizontal card deck. Direct the user to review the cards above the composer and choose their direction. Do not dump prose tables into chat.`,
        };
      }

      case 'aether_select_ux': {
        const sessionId = await this.resolveSessionId(args.sessionId);
        const payload = {
          sessionId,
          directionId:
            args.directionId ||
            args.uxDirectionId ||
            args.id ||
            args.title ||
            args.name ||
            (args.index !== undefined ? String(args.index) : undefined),
          generationId: args.generationId,
          rationale: args.rationale,
          userInitiated: false,
        };
        return await this.fetchJson(`${this.serverUrl}/api/ux/select`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      case 'aether_generate_ui': {
        const sessionId = await this.resolveSessionId(args.sessionId);
        const payload = {
          sessionId,
          promptSummary: args.promptSummary || args.text,
          refinement: args.refinement || args.promptSummary || args.text,
        };
        const res = await this.fetchJson(`${this.serverUrl}/api/ui/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        return {
          success: true,
          sessionId,
          generationNumber: res.generation?.generationNumber || 1,
          conceptsGenerated: (res.generation?.concepts || []).length,
          basedOnUx: res.basedOnUx?.title || res.generation?.basedOnUxTitle,
          concepts: (res.generation?.concepts || []).map((c: any) => ({
            id: c.conceptId,
            title: c.title,
            styleArchetype: c.styleArchetype,
            palette: c.palette,
            typography: c.typography,
            tradeOff: c.tradeOff,
          })),
          summary: `Synthesized ${res.generation?.concepts?.length || 2} visual UI concepts (Generation ${res.generation?.generationNumber || 1}) grounded in UX direction "${res.basedOnUx?.title || res.generation?.basedOnUxTitle || 'Selected UX'}" in the conversation-attached card deck. Direct the user to review the visual UI concept cards above the composer and choose their concept. Do not dump prose tables or color code tables into chat.`,
        };
      }

      case 'aether_select_ui': {
        const sessionId = await this.resolveSessionId(args.sessionId);
        const payload = {
          sessionId,
          conceptId:
            args.conceptId ||
            args.uiConceptId ||
            args.id ||
            args.title ||
            args.name ||
            (args.index !== undefined ? String(args.index) : undefined),
          generationId: args.generationId,
          userInitiated: false,
        };
        return await this.fetchJson(`${this.serverUrl}/api/ui/select`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      case 'aether_edit_component': {
        return await this.fetchJson(`${this.serverUrl}/api/edit/direct`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args),
        });
      }

      case 'aether_approve_promote': {
        return await this.fetchJson(`${this.serverUrl}/api/approval/promote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args),
        });
      }

      case 'aether_restore_checkpoint': {
        return await this.fetchJson(`${this.serverUrl}/api/checkpoint/restore`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args),
        });
      }

      case 'aether_export_handoff': {
        const format = args.format || 'all';
        const res = await fetch(`${this.serverUrl}/api/handoff/export?format=${format}`);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        if (format === 'markdown') {
          return await res.text();
        }
        return await res.json();
      }

      default:
        throw new Error(`Unknown Aether tool: "${name}"`);
    }
  }

  /**
   * Starts an interactive stdio JSON-RPC loop for Hermes Agent / MCP clients.
   */
  public startStdio(): void {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const parsed = JSON.parse(trimmed);
        const response = await this.handleJsonRpcMessage(parsed);
        if (response) {
          process.stdout.write(JSON.stringify(response) + '\n');
        }
      } catch (err: any) {
        process.stdout.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: `Parse error: ${err.message}` },
          }) + '\n'
        );
      }
    });
  }
}

// Auto-run if executed as standalone script
if (require.main === module) {
  const server = new AetherMcpServer();
  server.ensureServerRunning().then(() => {
    server.startStdio();
  });
}
