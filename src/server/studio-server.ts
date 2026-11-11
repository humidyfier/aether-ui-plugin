import * as http from 'node:http';
import * as url from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { AetherEngine } from '../engine/aether-engine';
import { renderStudioHtml } from '../ui/studio-html';
import { HandoffExporter } from './handoff-exporter';
import { ScopedEditPlan } from '../pipeline/schemas/edit-plan.schema';
import { EditTxMutation } from '../edittx/models';

export interface StudioServerConfig {
  port?: number;
  host?: string;
}

export interface UXDirectionCard {
  id: string;
  generationId: string;
  generationNumber: number;
  index: number;
  title: string;
  archetype: string;
  approach: string;
  userTaskFit: string;
  illustrationSvg: string;
  keyFlow: string[];
  strengths: string[];
  tradeOff: string;
  isSelected?: boolean;
}

export interface UXGeneration {
  generationId: string;
  generationNumber: number;
  promptSummary: string;
  createdAt: string;
  directions: UXDirectionCard[];
}

export interface UIConceptCard {
  conceptId: string;
  generationId: string;
  generationNumber: number;
  index: number;
  title: string;
  styleArchetype: string;
  palette: {
    background: string;
    surface: string;
    primary: string;
    secondary: string;
    text: string;
    accent: string;
  };
  typography: {
    headingFont: string;
    bodyFont: string;
    density: 'Compact' | 'Comfortable' | 'Spacious';
  };
  miniPreviewSpec: {
    layoutType: string;
    accentBar: boolean;
    statsCount: number;
    primaryButtonText: string;
    badgeText: string;
    previewTitle: string;
  };
  componentTraits: string[];
  tradeOff: string;
  isSelected?: boolean;
}

export interface UIGeneration {
  generationId: string;
  generationNumber: number;
  basedOnUxDirectionId: string;
  basedOnUxTitle: string;
  promptSummary: string;
  createdAt: string;
  concepts: UIConceptCard[];
}

export const SVG_SIDEBAR_BENTO = `<svg viewBox="0 0 280 80" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:75px;border-radius:6px;background:#090d16;display:block;"><rect x="6" y="6" width="34" height="68" rx="4" fill="#1e293b"/><rect x="11" y="12" width="24" height="4" rx="2" fill="#38bdf8"/><rect x="11" y="20" width="18" height="3" rx="1.5" fill="#475569"/><rect x="11" y="26" width="20" height="3" rx="1.5" fill="#475569"/><rect x="11" y="32" width="16" height="3" rx="1.5" fill="#475569"/><rect x="46" y="6" width="228" height="14" rx="3" fill="#1e293b"/><rect x="52" y="11" width="48" height="4" rx="2" fill="#94a3b8"/><rect x="46" y="24" width="72" height="50" rx="4" fill="#131c2e" stroke="#38bdf8" stroke-width="1"/><rect x="52" y="30" width="36" height="4" rx="2" fill="#38bdf8"/><rect x="52" y="38" width="50" height="12" rx="2" fill="#1e293b"/><rect x="124" y="24" width="84" height="50" rx="4" fill="#131c2e" stroke="#818cf8" stroke-width="1"/><rect x="130" y="30" width="45" height="4" rx="2" fill="#818cf8"/><rect x="130" y="38" width="72" height="6" rx="2" fill="#1e293b"/><rect x="130" y="48" width="60" height="6" rx="2" fill="#1e293b"/><rect x="214" y="24" width="60" height="50" rx="4" fill="#131c2e" stroke="#34d399" stroke-width="1"/><circle cx="244" cy="44" r="14" fill="#10b981" fill-opacity="0.2" stroke="#10b981" stroke-width="1.5"/><path d="M244 38v12M238 44h12" stroke="#10b981" stroke-width="2" stroke-linecap="round"/></svg>`;

export const SVG_CALENDAR_DRAWER = `<svg viewBox="0 0 280 80" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:75px;border-radius:6px;background:#090d16;display:block;"><rect x="6" y="6" width="268" height="20" rx="4" fill="#1e293b"/><circle cx="20" cy="16" r="6" fill="#334155"/><circle cx="56" cy="16" r="6" fill="#334155"/><circle cx="92" cy="16" r="6" fill="#f59e0b"/><circle cx="128" cy="16" r="6" fill="#334155"/><circle cx="164" cy="16" r="6" fill="#334155"/><circle cx="200" cy="16" r="6" fill="#334155"/><circle cx="236" cy="16" r="6" fill="#334155"/><rect x="6" y="30" width="130" height="44" rx="4" fill="#131c2e" stroke="#f59e0b" stroke-width="1"/><rect x="12" y="36" width="60" height="4" rx="2" fill="#f59e0b"/><rect x="12" y="44" width="100" height="6" rx="2" fill="#1e293b"/><rect x="12" y="54" width="80" height="6" rx="2" fill="#1e293b"/><rect x="142" y="30" width="132" height="44" rx="4" fill="#1e293b" stroke="#475569" stroke-width="1"/><rect x="150" y="36" width="40" height="18" rx="3" fill="#334155"/><rect x="196" y="36" width="70" height="4" rx="2" fill="#cbd5e1"/><rect x="196" y="44" width="50" height="3" rx="1.5" fill="#64748b"/><rect x="150" y="58" width="116" height="10" rx="2" fill="#0f172a"/></svg>`;

export const SVG_COACH_CLIENT_SPLIT = `<svg viewBox="0 0 280 80" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:75px;border-radius:6px;background:#090d16;display:block;"><rect x="6" y="6" width="100" height="68" rx="4" fill="#1e293b" stroke="#334155" stroke-width="1"/><rect x="12" y="11" width="40" height="4" rx="2" fill="#a78bfa"/><rect x="10" y="19" width="92" height="14" rx="3" fill="#131c2e" stroke="#a78bfa" stroke-width="1"/><circle cx="18" cy="26" r="4" fill="#a78bfa"/><rect x="26" y="24" width="45" height="3" rx="1.5" fill="#e2e8f0"/><rect x="10" y="36" width="92" height="14" rx="3" fill="#0f172a"/><circle cx="18" cy="43" r="4" fill="#475569"/><rect x="26" y="41" width="35" height="3" rx="1.5" fill="#64748b"/><rect x="10" y="53" width="92" height="14" rx="3" fill="#0f172a"/><circle cx="18" cy="60" r="4" fill="#475569"/><rect x="112" y="6" width="162" height="68" rx="4" fill="#131c2e" stroke="#a78bfa" stroke-width="1"/><rect x="120" y="12" width="70" height="5" rx="2" fill="#a78bfa"/><circle cx="250" cy="22" r="10" fill="none" stroke="#10b981" stroke-width="2.5" stroke-dasharray="16 8"/><rect x="120" y="24" width="100" height="8" rx="2" fill="#1e293b"/><rect x="120" y="36" width="144" height="32" rx="3" fill="#1e293b"/></svg>`;

export const SVG_ONE_TAP_LOGGER = `<svg viewBox="0 0 280 80" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:75px;border-radius:6px;background:#090d16;display:block;"><rect x="6" y="6" width="150" height="68" rx="4" fill="#131c2e" stroke="#ec4899" stroke-width="1"/><rect x="12" y="12" width="70" height="4" rx="2" fill="#f472b6"/><rect x="12" y="20" width="120" height="10" rx="2" fill="#1e293b"/><circle cx="81" cy="52" r="16" fill="#ec4899" fill-opacity="0.25" stroke="#ec4899" stroke-width="2"/><text x="81" y="56" fill="#f472b6" font-size="11" font-weight="bold" text-anchor="middle">+1</text><rect x="162" y="6" width="112" height="68" rx="4" fill="#1e293b" stroke="#f472b6" stroke-width="1"/><circle cx="218" cy="36" r="18" fill="#0f172a" stroke="#ec4899" stroke-width="3" stroke-dasharray="32 12"/><text x="218" y="40" fill="#fff" font-size="10" font-weight="bold" text-anchor="middle">:45</text><rect x="175" y="60" width="86" height="8" rx="2" fill="#334155"/></svg>`;

export const SVG_REST_TIMER_DECK = `<svg viewBox="0 0 280 80" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:75px;border-radius:6px;background:#090d16;display:block;"><rect x="6" y="6" width="268" height="24" rx="4" fill="#0284c7" stroke="#38bdf8" stroke-width="1"/><circle cx="20" cy="18" r="6" fill="#fff"/><text x="70" y="22" fill="#fff" font-size="11" font-weight="bold">REST: 01:15</text><rect x="6" y="34" width="130" height="40" rx="4" fill="#1e293b"/><circle cx="25" cy="54" r="10" fill="#38bdf8" fill-opacity="0.3"/><text x="25" y="58" fill="#38bdf8" font-size="10" font-weight="bold" text-anchor="middle">-5</text><circle cx="65" cy="54" r="12" fill="#38bdf8"/><text x="65" y="58" fill="#fff" font-size="10" font-weight="bold" text-anchor="middle">185</text><circle cx="105" cy="54" r="10" fill="#38bdf8" fill-opacity="0.3"/><text x="105" y="58" fill="#38bdf8" font-size="10" font-weight="bold" text-anchor="middle">+5</text><rect x="142" y="34" width="132" height="40" rx="4" fill="#131c2e" stroke="#38bdf8" stroke-width="1"/><rect x="150" y="42" width="70" height="6" rx="2" fill="#38bdf8"/><rect x="150" y="54" width="100" height="10" rx="2" fill="#10b981"/></svg>`;

export const SVG_SUPERSET_SPLIT = `<svg viewBox="0 0 280 80" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:75px;border-radius:6px;background:#090d16;display:block;"><rect x="6" y="6" width="124" height="68" rx="4" fill="#1e293b" stroke="#10b981" stroke-width="1.5"/><rect x="12" y="12" width="60" height="4" rx="2" fill="#34d399"/><rect x="12" y="20" width="80" height="12" rx="2" fill="#0f172a"/><rect x="12" y="36" width="112" height="30" rx="3" fill="#064e3b"/><text x="68" y="54" fill="#34d399" font-size="11" font-weight="bold" text-anchor="middle">SET A: 10 REPS</text><circle cx="140" cy="40" r="10" fill="#1e293b" stroke="#64748b" stroke-width="1"/><path d="M136 40h8M141 37l3 3-3 3" stroke="#cbd5e1" stroke-width="1.5" stroke-linecap="round"/><rect x="150" y="6" width="124" height="68" rx="4" fill="#1e293b" stroke="#3b82f6" stroke-width="1.5"/><rect x="156" y="12" width="60" height="4" rx="2" fill="#60a5fa"/><rect x="156" y="20" width="80" height="12" rx="2" fill="#0f172a"/><rect x="156" y="36" width="112" height="30" rx="3" fill="#1e3a8a"/><text x="212" y="54" fill="#93c5fd" font-size="11" font-weight="bold" text-anchor="middle">SET B: 12 REPS</text></svg>`;

export function isAllowedOrigin(origin?: string): boolean {
  if (!origin || origin === 'null') return true; // non-browser clients (curl, python, node), electron file/null origins, or same-origin
  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname;
    return (
      hostname === '127.0.0.1' ||
      hostname === 'localhost' ||
      origin.startsWith('vscode-webview://') ||
      origin.startsWith('hermes://') ||
      origin.startsWith('file://')
    );
  } catch {
    return false;
  }
}

export function getStudioSecurityHeaders(origin?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Security-Policy': "frame-ancestors 'self' http://127.0.0.1:* http://localhost:* vscode-webview: file: hermes: *;",
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'X-Content-Type-Options': 'nosniff',
  };
  if (origin && isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return headers;
}

export const STUDIO_FRAMING_HEADERS = {
  'Content-Security-Policy': "frame-ancestors 'self' http://127.0.0.1:* http://localhost:* vscode-webview: file: hermes: *;",
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'X-Content-Type-Options': 'nosniff',
};

export class StudioServer {
  private engine: AetherEngine;
  private port: number;
  private host: string;
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private isRunning = false;
  private uxGenerationsBySession: Map<string, UXGeneration[]> = new Map();
  private selectedUxBySession: Map<string, { generationId: string; directionId: string } | null> = new Map();
  private lastUxGeneratedAtBySession: Map<string, number> = new Map();
  private uiGenerationsBySession: Map<string, UIGeneration[]> = new Map();
  private selectedUiBySession: Map<string, { generationId: string; conceptId: string } | null> = new Map();
  private lastUiGeneratedAtBySession: Map<string, number> = new Map();
  private focusedDesktopSessionId: string | null = null;
  private focusedProfileId: string | null = null;

  constructor(engine: AetherEngine, config: StudioServerConfig = {}) {
    this.engine = engine;
    this.port = config.port || 3000;
    // Strict loopback security: bind to 127.0.0.1 by default (never 0.0.0.0)
    const rawHost = config.host || '127.0.0.1';
    this.host = rawHost === '0.0.0.0' ? '127.0.0.1' : rawHost;
  }

  private getDb(): any {
    try {
      return (this.engine.ledger as any).getDb ? (this.engine.ledger as any).getDb() : null;
    } catch {
      return null;
    }
  }

  private ensureSessionTable(): void {
    const db = this.getDb();
    if (!db) return;
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS session_records (
          session_id TEXT PRIMARY KEY,
          stage TEXT NOT NULL DEFAULT 'IDLE',
          ux_generations_json TEXT NOT NULL DEFAULT '[]',
          ui_generations_json TEXT NOT NULL DEFAULT '[]',
          selected_ux_json TEXT,
          selected_ui_json TEXT,
          last_ux_generated_at INTEGER,
          last_ui_generated_at INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      try {
        db.exec(`ALTER TABLE session_records ADD COLUMN last_ux_generated_at INTEGER;`);
      } catch {}
      try {
        db.exec(`ALTER TABLE session_records ADD COLUMN last_ui_generated_at INTEGER;`);
      } catch {}
    } catch (e) {}
  }

  public loadSessionRecord(sessionId: string): {
    sessionId: string;
    stage: string;
    uxGenerations: UXGeneration[];
    uiGenerations: UIGeneration[];
    selectedUx: { generationId: string; directionId: string } | null;
    selectedUi: { generationId: string; conceptId: string } | null;
    lastUxGeneratedAt: number | null;
    lastUiGeneratedAt: number | null;
  } {
    if (!sessionId || sessionId === 'null' || sessionId === 'undefined' || sessionId === 'new' || sessionId === 'default') {
      return {
        sessionId: '',
        stage: 'IDLE',
        uxGenerations: [],
        uiGenerations: [],
        selectedUx: null,
        selectedUi: null,
        lastUxGeneratedAt: null,
        lastUiGeneratedAt: null,
      };
    }

    const db = this.getDb();
    if (db) {
      this.ensureSessionTable();
      try {
        const row = db.prepare('SELECT * FROM session_records WHERE session_id = ?').get(sessionId);
        if (row) {
          const parsedUxGens: UXGeneration[] = JSON.parse(row.ux_generations_json || '[]');
          const parsedSelUx = row.selected_ux_json ? JSON.parse(row.selected_ux_json) : null;
          const parsedUiGens: UIGeneration[] = JSON.parse(row.ui_generations_json || '[]');
          const parsedSelUi = row.selected_ui_json ? JSON.parse(row.selected_ui_json) : null;
          const lastUxGen = row.last_ux_generated_at ? Number(row.last_ux_generated_at) : (this.lastUxGeneratedAtBySession.get(sessionId) || null);
          const lastUiGen = row.last_ui_generated_at ? Number(row.last_ui_generated_at) : (this.lastUiGeneratedAtBySession.get(sessionId) || null);

          this.uxGenerationsBySession.set(sessionId, parsedUxGens);
          this.selectedUxBySession.set(sessionId, parsedSelUx);
          this.uiGenerationsBySession.set(sessionId, parsedUiGens);
          this.selectedUiBySession.set(sessionId, parsedSelUi);
          if (lastUxGen) this.lastUxGeneratedAtBySession.set(sessionId, lastUxGen);
          if (lastUiGen) this.lastUiGeneratedAtBySession.set(sessionId, lastUiGen);

          return {
            sessionId,
            stage: row.stage || 'IDLE',
            uxGenerations: parsedUxGens,
            uiGenerations: parsedUiGens,
            selectedUx: parsedSelUx,
            selectedUi: parsedSelUi,
            lastUxGeneratedAt: lastUxGen,
            lastUiGeneratedAt: lastUiGen,
          };
        }
      } catch (err) {}
    }

    return {
      sessionId,
      stage: 'IDLE',
      uxGenerations: this.uxGenerationsBySession.get(sessionId) || [],
      uiGenerations: this.uiGenerationsBySession.get(sessionId) || [],
      selectedUx: this.selectedUxBySession.get(sessionId) || null,
      selectedUi: this.selectedUiBySession.get(sessionId) || null,
      lastUxGeneratedAt: this.lastUxGeneratedAtBySession.get(sessionId) || null,
      lastUiGeneratedAt: this.lastUiGeneratedAtBySession.get(sessionId) || null,
    };
  }

  public saveSessionRecord(
    sessionId: string,
    updates: Partial<{
      stage: string;
      uxGenerations: UXGeneration[];
      uiGenerations: UIGeneration[];
      selectedUx: { generationId: string; directionId: string } | null;
      selectedUi: { generationId: string; conceptId: string } | null;
      lastUxGeneratedAt: number | null;
      lastUiGeneratedAt: number | null;
    }>
  ): void {
    if (!sessionId || sessionId === 'null' || sessionId === 'undefined' || sessionId === 'new' || sessionId === 'default') return;

    const current = this.loadSessionRecord(sessionId);
    const stage = updates.stage !== undefined ? updates.stage : current.stage;
    const uxGenerations = updates.uxGenerations !== undefined ? updates.uxGenerations : current.uxGenerations;
    const uiGenerations = updates.uiGenerations !== undefined ? updates.uiGenerations : current.uiGenerations;
    const selectedUx = updates.selectedUx !== undefined ? updates.selectedUx : current.selectedUx;
    const selectedUi = updates.selectedUi !== undefined ? updates.selectedUi : current.selectedUi;
    const lastUxGeneratedAt = updates.lastUxGeneratedAt !== undefined ? updates.lastUxGeneratedAt : current.lastUxGeneratedAt;
    const lastUiGeneratedAt = updates.lastUiGeneratedAt !== undefined ? updates.lastUiGeneratedAt : current.lastUiGeneratedAt;

    this.uxGenerationsBySession.set(sessionId, uxGenerations);
    this.selectedUxBySession.set(sessionId, selectedUx);
    this.uiGenerationsBySession.set(sessionId, uiGenerations);
    this.selectedUiBySession.set(sessionId, selectedUi);
    if (lastUxGeneratedAt) {
      this.lastUxGeneratedAtBySession.set(sessionId, lastUxGeneratedAt);
    }
    if (lastUiGeneratedAt) {
      this.lastUiGeneratedAtBySession.set(sessionId, lastUiGeneratedAt);
    }

    const db = this.getDb();
    if (db) {
      this.ensureSessionTable();
      try {
        const now = new Date().toISOString();
        const existing = db.prepare('SELECT created_at FROM session_records WHERE session_id = ?').get(sessionId);
        const createdAt = existing?.created_at || now;

        db.prepare(`
          INSERT INTO session_records (
            session_id, stage, ux_generations_json, ui_generations_json, selected_ux_json, selected_ui_json, last_ux_generated_at, last_ui_generated_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(session_id) DO UPDATE SET
            stage = excluded.stage,
            ux_generations_json = excluded.ux_generations_json,
            ui_generations_json = excluded.ui_generations_json,
            selected_ux_json = excluded.selected_ux_json,
            selected_ui_json = excluded.selected_ui_json,
            last_ux_generated_at = excluded.last_ux_generated_at,
            last_ui_generated_at = excluded.last_ui_generated_at,
            updated_at = excluded.updated_at
        `).run(
          sessionId,
          stage,
          JSON.stringify(uxGenerations),
          JSON.stringify(uiGenerations),
          selectedUx ? JSON.stringify(selectedUx) : null,
          selectedUi ? JSON.stringify(selectedUi) : null,
          lastUxGeneratedAt || null,
          lastUiGeneratedAt || null,
          createdAt,
          now
        );
      } catch (err) {}
    }
  }

  public setFocusedDesktopSession(sessionId: string | null, profileId?: string | null): void {
    const raw = sessionId ? String(sessionId).trim() : null;
    this.focusedDesktopSessionId = (!raw || raw === 'null' || raw === 'undefined' || raw === 'new') ? null : raw;
    this.focusedProfileId = profileId ? String(profileId).trim() : null;
  }

  public getFocusedDesktopSession(): { focusedDesktopSessionId: string | null; focusedProfileId: string | null } {
    return {
      focusedDesktopSessionId: this.focusedDesktopSessionId,
      focusedProfileId: this.focusedProfileId,
    };
  }

  public getPort(): number {
    return this.port;
  }

  public getServerUrl(): string {
    return `http://${this.host}:${this.port}`;
  }

  public getUxGenerations(sessionId?: string): UXGeneration[] {
    if (!sessionId || sessionId === 'default' || sessionId === 'null' || sessionId === 'undefined') {
      return [];
    }
    return this.loadSessionRecord(sessionId).uxGenerations;
  }

  public getSelectedUx(sessionId?: string): { generationId: string; directionId: string } | null {
    if (!sessionId || sessionId === 'default' || sessionId === 'null' || sessionId === 'undefined') {
      return null;
    }
    return this.loadSessionRecord(sessionId).selectedUx;
  }

  public getUiGenerations(sessionId?: string): UIGeneration[] {
    if (!sessionId || sessionId === 'default' || sessionId === 'null' || sessionId === 'undefined') {
      return [];
    }
    return this.loadSessionRecord(sessionId).uiGenerations;
  }

  public getSelectedUi(sessionId?: string): { generationId: string; conceptId: string } | null {
    if (!sessionId || sessionId === 'default' || sessionId === 'null' || sessionId === 'undefined') {
      return null;
    }
    return this.loadSessionRecord(sessionId).selectedUi;
  }

  private isTestEnvironment(): boolean {
    return process.env.NODE_ENV === 'test' || Boolean(process.env.NODE_TEST_CONTEXT);
  }

  public generateUXDirections(sessionId?: string, refinement?: string): { generation: UXGeneration; uxGenerations: UXGeneration[] } {
    let sId = sessionId ? String(sessionId).trim() : '';
    if (sId === 'null' || sId === 'undefined' || sId === 'new') {
      throw new Error('No active conversation session specified or focused.');
    }
    if (!sId || sId === 'default') {
      sId = this.focusedDesktopSessionId || (this.isTestEnvironment() ? 'test-session-hermes' : '');
    }
    if (!sId) {
      throw new Error('No active conversation session specified or focused.');
    }

    const currentRecord = this.loadSessionRecord(sId);
    const existing = [...currentRecord.uxGenerations];
    const nextGenNumber = existing.length + 1;
    const genId = `gen_${sId}_${nextGenNumber}`;

    let directions: UXDirectionCard[] = [];

    if (nextGenNumber === 1) {
      directions = [
        {
          id: `ux_gen${nextGenNumber}_dir1`,
          generationId: genId,
          generationNumber: nextGenNumber,
          index: 1,
          title: 'Task-First Linear Flow',
          archetype: 'Sidebar + Bento Grid',
          approach: 'High-throughput structured workflow',
          userTaskFit: 'Ideal for trainers logging high-volume reps and sets across client sessions.',
          illustrationSvg: SVG_SIDEBAR_BENTO,
          keyFlow: ['Onboard', 'Workout Logger', 'Rest Timer', 'Progress'],
          strengths: ['+ Instant 1-tap logging', '+ Dense telemetry display'],
          tradeOff: 'Δ Steeper learning curve for novices',
          isSelected: false,
        },
        {
          id: `ux_gen${nextGenNumber}_dir2`,
          generationId: genId,
          generationNumber: nextGenNumber,
          index: 2,
          title: 'Visual / Calendar Layout',
          archetype: 'Week Calendar + Drawer',
          approach: 'Timeline-guided visual routine',
          userTaskFit: 'Tailored for visual coaches who organize routines by weekly periodization.',
          illustrationSvg: SVG_CALENDAR_DRAWER,
          keyFlow: ['Week View', 'Drag Routine', 'Exercise Demo', 'Photo Log'],
          strengths: ['+ High visual clarity for weekly planning', '+ Video/image demonstration cards'],
          tradeOff: 'Δ More taps required during active workouts',
          isSelected: false,
        },
        {
          id: `ux_gen${nextGenNumber}_dir3`,
          generationId: genId,
          generationNumber: nextGenNumber,
          index: 3,
          title: 'Client-Centric / Card Grid',
          archetype: 'Split Coach / Client Deck',
          approach: 'Client-first relationship mapping',
          userTaskFit: 'Optimized for 1-on-1 personal trainers tracking individualized progress journeys.',
          illustrationSvg: SVG_COACH_CLIENT_SPLIT,
          keyFlow: ['Client Deck', 'Drill History', 'Assign Plan', 'Compliance HUD'],
          strengths: ['+ Deep client relationship focus', '+ Historical progress graphs'],
          tradeOff: 'Δ Less convenient for batch roster management',
          isSelected: false,
        },
      ];
    } else {
      // Refined generation (e.g. Generation 2: 1-tap mid-workout focus)
      directions = [
        {
          id: `ux_gen${nextGenNumber}_dir1`,
          generationId: genId,
          generationNumber: nextGenNumber,
          index: 1,
          title: '1-Tap Rapid Logger',
          archetype: 'Full-Screen Workout HUD',
          approach: 'Single-gesture high-contrast gym-floor interaction',
          userTaskFit: 'Zero-friction set completion while holding weights or wearing gym gloves.',
          illustrationSvg: SVG_ONE_TAP_LOGGER,
          keyFlow: ['Active Set', 'Big Tap (+1 Rep)', 'Auto Rest Timer', 'Next Exercise'],
          strengths: ['+ Zero typing on gym floor', '+ Giant 64px touch target'],
          tradeOff: 'Δ Minimal analytics visible during active set',
          isSelected: false,
        },
        {
          id: `ux_gen${nextGenNumber}_dir2`,
          generationId: genId,
          generationNumber: nextGenNumber,
          index: 2,
          title: 'Heads-Up Rest Timer Deck',
          archetype: 'Dynamic Island Timer + Drawer',
          approach: 'Interval-centric recovery guidance',
          userTaskFit: 'Keeps rest periods disciplined with high-visibility countdown and audio cues.',
          illustrationSvg: SVG_REST_TIMER_DECK,
          keyFlow: ['Log Set', 'Rest Countdown HUD', 'Quick Adjust Dials', 'Audio Cue'],
          strengths: ['+ Never miss rest window intervals', '+ Quick weight increment dials'],
          tradeOff: 'Δ Persistent timer takes 30% screen space',
          isSelected: false,
        },
        {
          id: `ux_gen${nextGenNumber}_dir3`,
          generationId: genId,
          generationNumber: nextGenNumber,
          index: 3,
          title: 'Voice & Tap Super-Set Flow',
          archetype: 'Bi-Directional Split Tracker',
          approach: 'Alternating circuit & super-set logger',
          userTaskFit: 'Designed for trainers running paired exercises with minimal device handling.',
          illustrationSvg: SVG_SUPERSET_SPLIT,
          keyFlow: ['Super-Set Select', 'Voice Confirmation', 'Alternate Sets', 'Pair Complete'],
          strengths: ['+ Seamless alternating pairs', '+ Hands-free voice confirmation'],
          tradeOff: 'Δ Requires microphone access and quiet gym zone',
          isSelected: false,
        },
      ];
    }

    const newGen: UXGeneration = {
      generationId: genId,
      generationNumber: nextGenNumber,
      promptSummary: refinement || 'Gym trainer frontend UX alternative flows',
      createdAt: new Date().toISOString(),
      directions,
    };

    existing.push(newGen);
    const now = Date.now();
    this.lastUxGeneratedAtBySession.set(sId, now);

    this.saveSessionRecord(sId, {
      uxGenerations: existing,
      stage: 'UX_REVIEW',
      lastUxGeneratedAt: now,
    });
    return { generation: newGen, uxGenerations: existing };
  }

  public selectUXDirection(
    sessionId: string,
    targetQuery: string | number,
    targetGenId?: string,
    options?: { userInitiated?: boolean; source?: string }
  ): {
    success: boolean;
    isError?: boolean;
    matchedCard?: UXDirectionCard;
    validOptions?: any[];
    error?: string;
    selectedUx?: { generationId: string; directionId: string };
  } {
    let sId = sessionId ? String(sessionId).trim() : '';
    if (sId === 'null' || sId === 'undefined' || sId === 'new') {
      return { success: false, isError: true, error: 'No active conversation session specified or focused.' };
    }
    if (!sId || sId === 'default') {
      sId = this.focusedDesktopSessionId || (this.isTestEnvironment() ? 'test-session-hermes' : '');
    }
    if (!sId) {
      return { success: false, isError: true, error: 'No active conversation session specified or focused.' };
    }

    const currentRecord = this.loadSessionRecord(sId);
    const existing = currentRecord.uxGenerations;

    // Same-Turn Auto-Selection Prevention (< 2s after generation from automated agent call)
    const isUserInitiated = Boolean(options?.userInitiated || options?.source === 'desktop_ui');
    if (!isUserInitiated && currentRecord.lastUxGeneratedAt && !this.isTestEnvironment()) {
      const timeSinceGen = Date.now() - currentRecord.lastUxGeneratedAt;
      if (timeSinceGen < 2000) {
        return {
          success: false,
          isError: true,
          error: 'WAIT_FOR_USER: Do not auto-select a UX direction on the same turn it was generated. Stop and let the user choose from the UX cards displayed in the conversation.',
        };
      }
    }
    const allCards = existing.flatMap((g) => g.directions);

    if (allCards.length === 0) {
      return { success: false, error: `No UX directions generated yet for session "${sId}".` };
    }

    const queryStr = String(targetQuery || '').trim();
    let matched: UXDirectionCard | undefined = undefined;

    // 1. Exact ID match (e.g. "ux_gen1_dir1" or "ux_dir_1")
    matched = allCards.find((c) => c.id === queryStr);

    // 2. Generation dot index match (e.g. "1.1", "2.1", "2.2")
    if (!matched && queryStr.includes('.')) {
      matched = allCards.find((c) => `${c.generationNumber}.${c.index}` === queryStr);
    }

    // 3. 1-based index (e.g. "1", "2", 1, 2) - applies to latest generation if available, else first
    if (!matched && !isNaN(Number(queryStr))) {
      const idx = Number(queryStr);
      const latestGen = existing[existing.length - 1];
      if (latestGen) {
        matched = latestGen.directions.find((c) => c.index === idx);
      }
      if (!matched && allCards[idx - 1]) {
        matched = allCards[idx - 1];
      }
    }

    // 4. Exact Title (case-insensitive)
    if (!matched) {
      matched = allCards.find((c) => c.title.toLowerCase() === queryStr.toLowerCase());
    }

    // 5. Title substring
    if (!matched) {
      matched = allCards.find((c) => c.title.toLowerCase().includes(queryStr.toLowerCase()));
    }

    // 6. Ledger UX match (cross-referencing ledger UUID or title)
    if (!matched) {
      const brief = this.engine.ledger.briefs.getLatest();
      if (brief) {
        const ledgerUx = this.engine.ledger.ux.listByBriefId(brief.id);
        const lm = ledgerUx.find((lu: any) => lu.id === queryStr || lu.title.toLowerCase() === queryStr.toLowerCase());
        if (lm) {
          matched = allCards.find((c) => c.title.toLowerCase() === lm.title.toLowerCase()) || allCards[0];
        }
      }
    }

    if (!matched) {
      const validOptions = allCards.map((c) => ({
        directionId: c.id,
        generationNumber: c.generationNumber,
        title: c.title,
        selector: `${c.generationNumber}.${c.index}`,
      }));
      return {
        success: false,
        error: `UX Direction "${queryStr}" not found in session "${sId}".`,
        validOptions,
      };
    }

    // If targetGenId provided, verify ownership
    if (targetGenId && matched.generationId !== targetGenId) {
      return {
        success: false,
        error: `Direction "${matched.id}" belongs to "${matched.generationId}", not "${targetGenId}".`,
      };
    }

    // Mark matched card as selected, clear others
    for (const card of allCards) {
      card.isSelected = card.id === matched.id;
    }

    const selectedPayload = {
      generationId: matched.generationId,
      directionId: matched.id,
    };

    this.saveSessionRecord(sId, {
      uxGenerations: existing,
      selectedUx: selectedPayload,
    });

    return {
      success: true,
      matchedCard: matched,
      selectedUx: selectedPayload,
    };
  }

  public generateUIConcepts(
    sessionId?: string,
    refinement?: string
  ): {
    generation: UIGeneration;
    uiGenerations: UIGeneration[];
    basedOnUx: { directionId: string; title: string };
  } {
    let sId = sessionId ? String(sessionId).trim() : '';
    if (sId === 'null' || sId === 'undefined' || sId === 'new') {
      const err: any = new Error('No active conversation session specified or focused.');
      err.statusCode = 400;
      throw err;
    }
    if (!sId || sId === 'default') {
      sId = this.focusedDesktopSessionId || (this.isTestEnvironment() ? 'test-session-hermes' : '');
    }
    if (!sId) {
      const err: any = new Error('No active conversation session specified or focused.');
      err.statusCode = 400;
      throw err;
    }

    const currentRecord = this.loadSessionRecord(sId);
    if (!currentRecord.uxGenerations || currentRecord.uxGenerations.length === 0) {
      const err: any = new Error(
        'PRECONDITION_FAILED: Cannot generate UI concepts before UX directions exist. Call aether_submit_context and aether_generate_ux first.'
      );
      err.statusCode = 412;
      throw err;
    }
    if (!currentRecord.selectedUx) {
      const err: any = new Error(
        'PRECONDITION_FAILED: UX directions have been generated for this session, but the user has not selected a UX direction yet. Ask the user to select a UX card in the conversation before generating UI concepts.'
      );
      err.statusCode = 412;
      throw err;
    }

    const allUxCards = currentRecord.uxGenerations.flatMap((g) => g.directions);
    const selectedUxCard =
      allUxCards.find((c) => c.id === currentRecord.selectedUx!.directionId) || allUxCards[0];
    const basedOnUxTitle = selectedUxCard ? selectedUxCard.title : 'Selected UX Direction';
    const basedOnUxId = selectedUxCard ? selectedUxCard.id : currentRecord.selectedUx!.directionId;

    const existing = [...currentRecord.uiGenerations];
    const nextGenNumber = existing.length + 1;
    const genId = `ui_gen_${sId}_${nextGenNumber}`;

    let concepts: UIConceptCard[] = [];

    if (nextGenNumber === 1) {
      concepts = [
        {
          conceptId: `ui_gen${nextGenNumber}_concept1`,
          generationId: genId,
          generationNumber: nextGenNumber,
          index: 1,
          title: 'Modern Precision',
          styleArchetype: 'Dark Cybernetic / High Density',
          palette: {
            background: '#0a0f1d',
            surface: '#131d31',
            primary: '#3b82f6',
            secondary: '#64748b',
            accent: '#38bdf8',
            text: '#f8fafc',
          },
          typography: {
            headingFont: 'JetBrains Mono, monospace',
            bodyFont: 'Inter, system-ui, sans-serif',
            density: 'Compact',
          },
          miniPreviewSpec: {
            layoutType: selectedUxCard?.archetype || 'Sidebar + Bento Grid',
            accentBar: true,
            statsCount: 3,
            primaryButtonText: '+ Log Set',
            badgeText: 'PRO METRICS',
            previewTitle: `${basedOnUxTitle} — Studio Precision`,
          },
          componentTraits: [
            'Crisp 1px borders',
            'Monospace telemetry',
            'Micro-haptic indicators',
            'High-contrast data cells',
          ],
          tradeOff:
            'Dense information hierarchy; optimized for professional coaches rather than casual users.',
          isSelected: false,
        },
        {
          conceptId: `ui_gen${nextGenNumber}_concept2`,
          generationId: genId,
          generationNumber: nextGenNumber,
          index: 2,
          title: 'Warm Humanist',
          styleArchetype: 'Warm Neutral / Editorial Tone',
          palette: {
            background: '#1c1917',
            surface: '#292524',
            primary: '#f59e0b',
            secondary: '#78716c',
            accent: '#fbbf24',
            text: '#fafaf9',
          },
          typography: {
            headingFont: 'Plus Jakarta Sans, sans-serif',
            bodyFont: 'Inter, system-ui, sans-serif',
            density: 'Comfortable',
          },
          miniPreviewSpec: {
            layoutType: selectedUxCard?.archetype || 'Week Calendar + Drawer',
            accentBar: false,
            statsCount: 2,
            primaryButtonText: 'Start Workout',
            badgeText: 'WELLNESS',
            previewTitle: `${basedOnUxTitle} — Warm Editorial`,
          },
          componentTraits: [
            'Soft 12px pill curves',
            'Warm amber focus states',
            'Spacious touch targets',
            'Gentle typography hierarchy',
          ],
          tradeOff: 'Larger line-heights require slightly more vertical scrolling.',
          isSelected: false,
        },
        {
          conceptId: `ui_gen${nextGenNumber}_concept3`,
          generationId: genId,
          generationNumber: nextGenNumber,
          index: 3,
          title: 'Neo-Athletic Cyber',
          styleArchetype: 'High-Voltage Neon / Bold Contrast',
          palette: {
            background: '#090d16',
            surface: '#0f172a',
            primary: '#10b981',
            secondary: '#8b5cf6',
            accent: '#ec4899',
            text: '#ffffff',
          },
          typography: {
            headingFont: 'Space Grotesk, sans-serif',
            bodyFont: 'Syne, sans-serif',
            density: 'Spacious',
          },
          miniPreviewSpec: {
            layoutType: selectedUxCard?.archetype || 'Split Coach / Client Deck',
            accentBar: true,
            statsCount: 4,
            primaryButtonText: 'BURST REST TIMER',
            badgeText: 'HYPERTROPHY',
            previewTitle: `${basedOnUxTitle} — Cyber Athletic`,
          },
          componentTraits: [
            'Neon emerald glowing badges',
            'Electric pink accent accents',
            'Bold uppercase headlines',
            'OLED deep black canvas',
          ],
          tradeOff: 'Very vibrant; best viewed in dimmed gym environments.',
          isSelected: false,
        },
      ];
    } else {
      // Refined generation
      const refineText = refinement || 'High contrast gym-floor optimization';
      concepts = [
        {
          conceptId: `ui_gen${nextGenNumber}_concept1`,
          generationId: genId,
          generationNumber: nextGenNumber,
          index: 1,
          title: 'OLED Tactical Stealth',
          styleArchetype: 'Zero-Emission Deep OLED',
          palette: {
            background: '#000000',
            surface: '#111111',
            primary: '#38bdf8',
            secondary: '#52525b',
            accent: '#0284c7',
            text: '#ffffff',
          },
          typography: {
            headingFont: 'JetBrains Mono, monospace',
            bodyFont: 'system-ui, sans-serif',
            density: 'Compact',
          },
          miniPreviewSpec: {
            layoutType: 'OLED Tactical HUD',
            accentBar: true,
            statsCount: 3,
            primaryButtonText: 'TAP LOG',
            badgeText: 'STEALTH OLED',
            previewTitle: `Refined: ${refineText}`,
          },
          componentTraits: [
            'True #000000 battery-saver canvas',
            'Ultra-high contrast cyan glyphs',
            'Extra bold 18px weights',
          ],
          tradeOff: 'Strictly dark-mode only.',
          isSelected: false,
        },
        {
          conceptId: `ui_gen${nextGenNumber}_concept2`,
          generationId: genId,
          generationNumber: nextGenNumber,
          index: 2,
          title: 'Neon High-Luminance',
          styleArchetype: 'Chalk-Line Luminescent',
          palette: {
            background: '#0a0d14',
            surface: '#161d2d',
            primary: '#a855f7',
            secondary: '#64748b',
            accent: '#e879f9',
            text: '#fdf4ff',
          },
          typography: {
            headingFont: 'Space Grotesk, sans-serif',
            bodyFont: 'Inter, sans-serif',
            density: 'Comfortable',
          },
          miniPreviewSpec: {
            layoutType: 'Luminescent Gym View',
            accentBar: true,
            statsCount: 2,
            primaryButtonText: 'START INTERVAL',
            badgeText: 'HIGH LUMA',
            previewTitle: `Refined: ${refineText}`,
          },
          componentTraits: [
            'Luminescent violet glow highlights',
            'Chalk-textured divider borders',
            '24px giant touch buttons',
          ],
          tradeOff: 'Higher visual energy may distract during pure endurance pacing.',
          isSelected: false,
        },
      ];
    }

    const newGen: UIGeneration = {
      generationId: genId,
      generationNumber: nextGenNumber,
      basedOnUxDirectionId: basedOnUxId,
      basedOnUxTitle,
      promptSummary: refinement || `UI concepts grounded in ${basedOnUxTitle}`,
      createdAt: new Date().toISOString(),
      concepts,
    };

    existing.push(newGen);
    const now = Date.now();
    this.lastUiGeneratedAtBySession.set(sId, now);

    this.saveSessionRecord(sId, {
      uiGenerations: existing,
      stage: 'UI_REVIEW',
      lastUiGeneratedAt: now,
    });

    return {
      generation: newGen,
      uiGenerations: existing,
      basedOnUx: {
        directionId: basedOnUxId,
        title: basedOnUxTitle,
      },
    };
  }

  public async selectUIConcept(
    sessionId: string,
    targetQuery: string | number,
    targetGenId?: string,
    options?: { userInitiated?: boolean; source?: string }
  ): Promise<{
    success: boolean;
    isError?: boolean;
    matchedConcept?: UIConceptCard;
    validOptions?: any[];
    error?: string;
    selectedUi?: { generationId: string; conceptId: string };
    previewUrl?: string;
    reachability?: any;
  }> {
    let sId = sessionId ? String(sessionId).trim() : '';
    if (sId === 'null' || sId === 'undefined' || sId === 'new') {
      return { success: false, isError: true, error: 'No active conversation session specified or focused.' };
    }
    if (!sId || sId === 'default') {
      sId = this.focusedDesktopSessionId || (this.isTestEnvironment() ? 'test-session-hermes' : '');
    }
    if (!sId) {
      return { success: false, isError: true, error: 'No active conversation session specified or focused.' };
    }

    const currentRecord = this.loadSessionRecord(sId);
    if (!currentRecord.uxGenerations || currentRecord.uxGenerations.length === 0) {
      return {
        success: false,
        isError: true,
        error:
          'PRECONDITION_FAILED: Cannot select UI concepts before UX directions exist. Call aether_submit_context and aether_generate_ux first.',
      };
    }
    if (!currentRecord.selectedUx) {
      return {
        success: false,
        isError: true,
        error:
          'PRECONDITION_FAILED: UX directions have been generated for this session, but the user has not selected a UX direction yet. Ask the user to select a UX card in the conversation before selecting UI concepts.',
      };
    }

    const existing = currentRecord.uiGenerations;
    const allCards = existing.flatMap((g) => g.concepts);
    if (allCards.length === 0) {
      return {
        success: false,
        isError: true,
        error: `No UI concepts generated yet for session "${sId}". Call aether_generate_ui first.`,
      };
    }

    // Same-Turn Auto-Selection Prevention (< 2s after generation from automated agent call)
    const isUserInitiated = Boolean(options?.userInitiated || options?.source === 'desktop_ui');
    if (!isUserInitiated && currentRecord.lastUiGeneratedAt && !this.isTestEnvironment()) {
      const timeSinceGen = Date.now() - currentRecord.lastUiGeneratedAt;
      if (timeSinceGen < 2000) {
        return {
          success: false,
          isError: true,
          error:
            'WAIT_FOR_USER: Do not auto-select a UI concept on the same turn it was generated. Stop and let the user choose from the UI concept cards displayed in the conversation.',
        };
      }
    }

    const queryStr = String(targetQuery || '').trim();
    let matched: UIConceptCard | undefined = undefined;

    // 1. Exact ID match (e.g. "ui_gen1_concept1")
    matched = allCards.find((c) => c.conceptId === queryStr);

    // 2. Generation dot index match (e.g. "1.1", "2.1")
    if (!matched && queryStr.includes('.')) {
      matched = allCards.find((c) => `${c.generationNumber}.${c.index}` === queryStr);
    }

    // 3. 1-based index (e.g. "1", "2")
    if (!matched && !isNaN(Number(queryStr))) {
      const idx = Number(queryStr);
      const latestGen = existing[existing.length - 1];
      if (latestGen) {
        matched = latestGen.concepts.find((c) => c.index === idx);
      }
      if (!matched && allCards[idx - 1]) {
        matched = allCards[idx - 1];
      }
    }

    // 4. Exact Title (case-insensitive)
    if (!matched) {
      matched = allCards.find((c) => c.title.toLowerCase() === queryStr.toLowerCase());
    }

    // 5. Title substring
    if (!matched) {
      matched = allCards.find((c) => c.title.toLowerCase().includes(queryStr.toLowerCase()));
    }

    // 6. Ledger UI concept match (cross-referencing ledger UUID or name)
    if (!matched) {
      const brief = this.engine.ledger.briefs.getLatest();
      if (brief) {
        const ledgerConcepts = this.engine.ledger.ui.listByBriefId(brief.id);
        const lm = ledgerConcepts.find((lc: any) => lc.id === queryStr || lc.name.toLowerCase() === queryStr.toLowerCase());
        if (lm) {
          matched = allCards.find((c) => c.title.toLowerCase() === lm.name.toLowerCase()) || allCards[0];
        }
      }
    }

    if (!matched) {
      const validOptions = allCards.map((c) => ({
        conceptId: c.conceptId,
        generationNumber: c.generationNumber,
        title: c.title,
        selector: `${c.generationNumber}.${c.index}`,
      }));
      return {
        success: false,
        error: `UI Concept "${queryStr}" not found in session "${sId}".`,
        validOptions,
      };
    }

    if (targetGenId && matched.generationId !== targetGenId) {
      return {
        success: false,
        error: `UI Concept "${matched.conceptId}" belongs to "${matched.generationId}", not "${targetGenId}".`,
      };
    }

    for (const card of allCards) {
      card.isSelected = card.conceptId === matched.conceptId;
    }

    const selectedPayload = {
      generationId: matched.generationId,
      conceptId: matched.conceptId,
    };

    this.saveSessionRecord(sId, {
      uiGenerations: existing,
      selectedUi: selectedPayload,
      stage: 'PREVIEW_READY',
    });

    // Also update engine ledger if brief exists
    const brief = this.engine.ledger.briefs.getLatest();
    if (brief) {
      const ledgerConcepts = this.engine.ledger.ui.listByBriefId(brief.id);
      if (ledgerConcepts.length > 0) {
        const matchedLedger =
          ledgerConcepts.find((c: any) => c.id === matched.conceptId || c.name === matched.title) ||
          ledgerConcepts[0];
        try {
          this.engine.ledger.selectUIConcept(brief.id, matchedLedger.id);
        } catch {}
      }
    }

    // Generate candidate code for the chosen UI concept into Slot B
    this.generateCandidateCodeForUIConcept(matched);

    // Ensure preview servers are running and verified reachable
    let reachability: any = { slotA: false, slotB: false };
    try {
      await this.engine.dualSlotManager.startPreviews();
      reachability = await this.engine.dualSlotManager.verifySlotsReachable();
    } catch (err: any) {
      console.warn('[StudioServer] Preview servers start failed:', err.message);
    }

    return {
      success: true,
      matchedConcept: matched,
      selectedUi: selectedPayload,
      previewUrl: this.engine.dualSlotManager.getSlotState('SLOT_B').previewUrl,
      reachability,
    };
  }

  public getState(sessionId?: string): any {
    const sId = sessionId ? String(sessionId).trim() : '';
    const slotAState = this.engine.dualSlotManager.getSlotState('SLOT_A');
    const slotBState = this.engine.dualSlotManager.getSlotState('SLOT_B');
    const pointers = this.engine.ledger.revisionPointers.getPointers();
    const currentState = this.engine.ledger.stateMachine.getState();

    // STRICT ISOLATION: Empty/null/invalid session IDs return an empty IDLE state — NEVER another session's data!
    if (!sId || sId === 'null' || sId === 'undefined' || sId === 'new' || sId === 'default') {
      return {
        sessionId: null,
        stage: 'IDLE',
        currentState,
        revisionPointers: pointers,
        slotAPort: slotAState.port,
        slotBPort: slotBState.port,
        brief: null,
        uxDirections: [],
        uiConcepts: [],
        checkpoints: [],
        slotAState,
        slotBState,
        quarantinedUids: [],
        uxGenerations: [],
        selectedUx: null,
        uiGenerations: [],
        selectedUi: null,
      };
    }

    const sessionRecord = this.loadSessionRecord(sId);
    const brief = this.engine.ledger.briefs.getLatest();
    const uxDirections = brief ? this.engine.ledger.ux.listByBriefId(brief.id) : [];
    const uiConcepts = brief ? this.engine.ledger.ui.listByBriefId(brief.id) : [];
    const checkpoints = this.engine.ledger.checkpoints.listHistory();

    return {
      sessionId: sId,
      stage: sessionRecord.stage || 'IDLE',
      currentState,
      revisionPointers: pointers,
      slotAPort: slotAState.port,
      slotBPort: slotBState.port,
      brief,
      uxDirections,
      uiConcepts,
      checkpoints,
      slotAState,
      slotBState,
      quarantinedUids: this.engine.ledger.quarantineRegistry.getQuarantinedRecords().map((r) => r.uid),
      uxGenerations: sessionRecord.uxGenerations,
      selectedUx: sessionRecord.selectedUx,
      uiGenerations: sessionRecord.uiGenerations,
      selectedUi: sessionRecord.selectedUi,
    };
  }

  public broadcast(msg: any): void {
    if (!this.wss) return;
    const data = JSON.stringify(msg);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  private async parseBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 10 * 1024 * 1024) {
          req.destroy();
          reject(new Error('Request body exceeded 10MB limit'));
        }
      });
      req.on('end', () => {
        if (!body) return resolve({});
        try {
          resolve(JSON.parse(body));
        } catch (e: any) {
          reject(new Error(`Malformed JSON in request body: ${e.message}`));
        }
      });
      req.on('error', reject);
    });
  }

  private sendJson(res: http.ServerResponse, statusCode: number, data: any, origin?: string): void {
    const effectiveOrigin = origin || (res as any).__origin;
    const payload = JSON.stringify(data);
    res.writeHead(statusCode, {
      ...getStudioSecurityHeaders(effectiveOrigin),
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    });
    res.end(payload);
  }

  public async start(): Promise<string> {
    if (this.isRunning) {
      return this.getServerUrl();
    }

    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer(async (req, res) => {
        const origin = req.headers.origin as string | undefined;
        (res as any).__origin = origin;

        try {
          // Strict Origin validation: reject untrusted cross-origin requests immediately (prevents drive-by attacks from malicious websites)
          if (origin && !isAllowedOrigin(origin)) {
            res.writeHead(403, {
              ...getStudioSecurityHeaders(),
              'Content-Type': 'application/json',
            });
            res.end(JSON.stringify({ error: 'Forbidden: Untrusted cross-origin request rejected' }));
            return;
          }

          const parsedUrl = url.parse(req.url || '/', true);
          const pathname = parsedUrl.pathname || '/';
          const method = req.method || 'GET';

          // CORS Preflight
          if (method === 'OPTIONS') {
            res.writeHead(204, getStudioSecurityHeaders(origin));
            res.end();
            return;
          }

          // 1. GET / - Serves Hermes Studio UI
          if (method === 'GET' && pathname === '/') {
            const html = renderStudioHtml(this.getState(), { embed: parsedUrl.query.embed });
            res.writeHead(200, {
              ...getStudioSecurityHeaders(origin),
              'Content-Type': 'text/html; charset=utf-8',
            });
            res.end(html);
            return;
          }

          // 2. GET /api/state
          if (method === 'GET' && pathname === '/api/state') {
            const qSessionId = (parsedUrl.query?.sessionId as string) || undefined;
            this.sendJson(res, 200, this.getState(qSessionId));
            return;
          }

          // 2-focus. GET /api/session/focus & POST /api/session/focus
          if (method === 'GET' && pathname === '/api/session/focus') {
            this.sendJson(res, 200, this.getFocusedDesktopSession());
            return;
          }

          if (method === 'POST' && pathname === '/api/session/focus') {
            const body = await this.parseBody(req);
            this.setFocusedDesktopSession(body.sessionId, body.profileId);
            this.sendJson(res, 200, {
              success: true,
              ...this.getFocusedDesktopSession(),
            });
            return;
          }

          // 2a. GET /api/ux/generations
          if (method === 'GET' && pathname === '/api/ux/generations') {
            const qSessionId = (parsedUrl.query?.sessionId as string) || '';
            this.sendJson(res, 200, {
              success: true,
              sessionId: qSessionId,
              uxGenerations: this.getUxGenerations(qSessionId),
              selectedUx: this.getSelectedUx(qSessionId),
            });
            return;
          }

          // 2b. GET /api/health
          if (method === 'GET' && pathname === '/api/health') {
            const slotA = this.engine.dualSlotManager.getSlotState('SLOT_A');
            const slotB = this.engine.dualSlotManager.getSlotState('SLOT_B');
            this.sendJson(res, 200, {
              status: 'ok',
              pid: process.pid,
              port: this.port,
              currentState: this.engine.ledger.stateMachine.getState(),
              slots: {
                slotA: { port: slotA.port, status: slotA.status, previewUrl: slotA.previewUrl },
                slotB: { port: slotB.port, status: slotB.status, previewUrl: slotB.previewUrl },
              },
            });
            return;
          }

          // 3. POST /api/session/context
          if (method === 'POST' && pathname === '/api/session/context') {
            const body = await this.parseBody(req);
            const rawBrief = {
              name: body.name || 'Aether Project',
              productContext: body.text || body.productContext || 'Aether Modern Application',
              targetAudience: body.targetAudience || [
                { role: 'User', skillLevel: 'intermediate', devices: ['desktop', 'mobile'] },
              ],
              primaryTasks: body.primaryTasks || [
                { id: 'task-1', goal: 'Core interaction flow', urgency: 'high', frequency: 'daily' },
              ],
              pagesAndContent: body.pagesAndContent || [
                { id: 'page-1', route: '/', purpose: 'Main Dashboard & Workspace', priority: 'critical' },
              ],
              uxPreferences: body.uxPreferences || { density: 'comfortable', navigationPattern: 'sidebar' },
              visualPreferences: body.visualPreferences || {
                moodWords: ['clean', 'crisp'],
                brandColors: ['#3b82f6'],
              },
              implementationConstraints: body.implementationConstraints || { framework: 'react' },
              practicalConstraints: body.practicalConstraints || {},
              assumptions: body.assumptions || [
                { id: 'asm-1', statement: 'Initial product requirements', confidence: 'medium', validated: true },
              ],
              questions: body.questions || [],
            };

            const result = this.engine.pipeline.processBriefResponse(rawBrief);
            this.broadcast({ type: 'STATE_UPDATE', state: this.getState() });
            this.sendJson(res, 200, {
              success: result.success,
              brief: result.brief,
              reply: result.success
                ? `Project brief extracted and validated. Readiness: ${result.brief?.readiness.isReady ? 'PASSED' : 'INCOMPLETE'}`
                : `Brief validation error: ${result.errors.join(', ')}`,
            });
            return;
          }

          // 4. POST /api/ux/generate
          if (method === 'POST' && pathname === '/api/ux/generate') {
            const body = await this.parseBody(req);
            let sessionId = body.sessionId || (parsedUrl.query?.sessionId as string);
            if (!sessionId || sessionId === 'default' || sessionId === 'null' || sessionId === 'undefined' || sessionId === 'new') {
              sessionId = this.focusedDesktopSessionId || (this.isTestEnvironment() ? 'test-session-hermes' : undefined);
            }
            if (!sessionId) {
              this.sendJson(res, 400, {
                success: false,
                isError: true,
                error: 'No active Hermes conversation session specified or focused.',
              });
              return;
            }
            const refinement = body.refinement || body.promptSummary;

            let brief = this.engine.ledger.briefs.getLatest();
            if (!brief) {
              const defaultBrief = {
                name: 'Gym Trainer Web App',
                productContext: 'Gym trainer workout and client tracking platform',
                targetAudience: [{ role: 'Personal Trainer', skillLevel: 'professional', devices: ['mobile', 'desktop'] }],
                primaryTasks: [{ id: 'task-1', goal: 'Fast workout set and rep logging', urgency: 'high', frequency: 'daily' }],
                pagesAndContent: [{ id: 'page-1', route: '/', purpose: 'Trainer Dashboard & Active Workout Flow', priority: 'critical' }],
                uxPreferences: { density: 'comfortable', navigationPattern: 'sidebar' },
                visualPreferences: { moodWords: ['energetic', 'modern'], brandColors: ['#3b82f6', '#10b981'] },
                implementationConstraints: { framework: 'react' },
                practicalConstraints: {},
                assumptions: [{ id: 'asm-1', statement: 'Trainers need high-contrast mid-workout interaction', confidence: 'high', validated: true }],
                questions: [],
              };
              const briefRes = this.engine.pipeline.processBriefResponse(defaultBrief);
              brief = briefRes.brief ?? null;
            }

            const rawUxDirections = [
              {
                title: 'Task-First Linear Flow',
                approach: 'task-first',
                userTaskFit: 'High efficiency for repetitive power-user workflows',
                pageStructure: [
                  { pageId: 'p1', name: 'Dashboard', route: '/', hierarchyLevel: 1, components: ['Header', 'TaskList', 'ActivityStream'] },
                ],
                interactionFlow: [
                  { step: 1, title: 'View Queue', userAction: 'Open dashboard', systemResponse: 'Display filtered priority tasks' },
                ],
                strengths: ['Fast triage', 'Dense information display'],
                tradeOffs: ['Steeper initial learning curve'],
                assumptions: ['Users prioritize speed over tutorials'],
                isRecommended: true,
              },
              {
                title: 'Visual / Calendar Layout',
                approach: 'guided-first',
                userTaskFit: 'Optimized for progressive onboarding and self-service discovery',
                pageStructure: [
                  { pageId: 'p1', name: 'Welcome', route: '/', hierarchyLevel: 1, components: ['Navbar', 'Hero', 'FeatureCards'] },
                ],
                interactionFlow: [
                  { step: 1, title: 'Guided Tour', userAction: 'Explore features', systemResponse: 'Walk through interactive checklist' },
                ],
                strengths: ['Low cognitive load', 'Spacious layout'],
                tradeOffs: ['More steps for experienced users'],
                assumptions: ['Users need contextual guidance'],
                isRecommended: false,
              },
            ];

            if (brief) {
              this.engine.pipeline.processUXResponse(brief.id, { directions: rawUxDirections });
            }

            const { generation, uxGenerations } = this.generateUXDirections(sessionId, refinement);
            this.broadcast({ type: 'STATE_UPDATE', sessionId, state: this.getState(sessionId) });
            this.sendJson(res, 200, {
              success: true,
              sessionId,
              generation,
              uxGenerations,
              directions: generation.directions,
            });
            return;
          }

          // 5. POST /api/ux/select
          if (method === 'POST' && pathname === '/api/ux/select') {
            const body = await this.parseBody(req);
            let sessionId = body.sessionId || (parsedUrl.query?.sessionId as string);
            if (!sessionId || sessionId === 'default' || sessionId === 'null' || sessionId === 'undefined' || sessionId === 'new') {
              sessionId = this.focusedDesktopSessionId || (this.isTestEnvironment() ? 'test-session-hermes' : undefined);
            }
            if (!sessionId) {
              this.sendJson(res, 400, {
                success: false,
                isError: true,
                error: 'No active Hermes conversation session specified or focused.',
              });
              return;
            }
            const targetQuery =
              body.directionId ||
              body.uxDirectionId ||
              body.id ||
              body.title ||
              body.name ||
              (body.index !== undefined ? String(body.index) : null);
            const generationId = body.generationId;

            if (!targetQuery && targetQuery !== '0') {
              this.sendJson(res, 400, {
                success: false,
                isError: true,
                error: 'directionId (or alias uxDirectionId, title, index) is required',
              });
              return;
            }

            const options = {
              userInitiated: Boolean(body.userInitiated),
              source: body.source,
            };
            const selectResult = this.selectUXDirection(sessionId, targetQuery, generationId, options);

            if (!selectResult.success) {
              const status = selectResult.error?.startsWith('WAIT_FOR_USER') ? 429 : 409;
              this.sendJson(res, status, {
                success: false,
                isError: true,
                error: selectResult.error || `UX Direction "${targetQuery}" not found in session "${sessionId}".`,
                validOptions: selectResult.validOptions || [],
              });
              return;
            }

            // Also keep ledger state machine updated if brief exists
            const brief = this.engine.ledger.briefs.getLatest();
            if (brief) {
              const directions = this.engine.ledger.ux.listByBriefId(brief.id);
              if (directions.length > 0) {
                const matchedLedger = directions.find((d: any) => d.id === selectResult.matchedCard?.id) || directions[0];
                try {
                  this.engine.ledger.selectUXDirection(
                    brief.id,
                    matchedLedger.id,
                    body.rationale || 'Selected by user in UX card deck'
                  );
                } catch {}
              }
            }

            this.broadcast({ type: 'STATE_UPDATE', sessionId, state: this.getState(sessionId) });
            this.sendJson(res, 200, {
              success: true,
              sessionId,
              selectedDirectionId: selectResult.matchedCard?.id,
              selectedUx: selectResult.selectedUx,
              direction: selectResult.matchedCard,
            });
            return;
          }

          // 6. POST /api/ui/generate
          if (method === 'POST' && pathname === '/api/ui/generate') {
            const body = await this.parseBody(req);
            let sessionId = body.sessionId || (parsedUrl.query?.sessionId as string);
            if (!sessionId || sessionId === 'default' || sessionId === 'null' || sessionId === 'undefined' || sessionId === 'new') {
              sessionId = this.focusedDesktopSessionId || (this.isTestEnvironment() ? 'test-session-hermes' : undefined);
            }
            if (!sessionId) {
              this.sendJson(res, 400, {
                success: false,
                isError: true,
                error: 'No active Hermes conversation session specified or focused.',
              });
              return;
            }

            try {
              const result = this.generateUIConcepts(
                sessionId,
                body.refinement || body.promptSummary || body.text
              );

              // Also sync with ledger pipeline if project brief exists
              const brief = this.engine.ledger.briefs.getLatest();
              if (brief) {
                let ledgerUxList = this.engine.ledger.ux.listByBriefId(brief.id);
                if (ledgerUxList.length === 0) {
                  const rawUxDirections = [
                    {
                      title: result.basedOnUx?.title || 'Selected UX Direction',
                      approach: 'task-first' as const,
                      userTaskFit: 'High efficiency for user workflows',
                      pageStructure: [{ pageId: 'p1', name: 'Dashboard', route: '/', hierarchyLevel: 1, components: ['Header'] }],
                      interactionFlow: [{ step: 1, title: 'Step 1', userAction: 'View', systemResponse: 'Render' }],
                      strengths: ['Fast triage'],
                      tradeOffs: ['Focused scope'],
                      assumptions: ['User priorities'],
                      isRecommended: true,
                    },
                  ];
                  this.engine.pipeline.processUXResponse(brief.id, { directions: rawUxDirections });
                  ledgerUxList = this.engine.ledger.ux.listByBriefId(brief.id);
                }
                const ledgerSelectedUx = this.engine.ledger.ux.getSelected(brief.id) || ledgerUxList[0];
                const selectedUXId = ledgerSelectedUx?.id;
                const pipelineConcepts = [
                  {
                    name: result.generation.concepts[0]?.title || 'Modern Precision',
                    styleApproach: result.generation.concepts[0]?.styleArchetype || 'Clean technical minimalism with crisp contrast',
                    typography: {
                      fontFamilySans: 'Inter, system-ui, sans-serif',
                      fontFamilyMono: 'JetBrains Mono, monospace',
                      scale: { xs: '12px', sm: '14px', base: '16px', lg: '18px', xl: '20px', '2xl': '24px', '3xl': '30px' },
                      weights: { regular: 400, medium: 500, semibold: 600, bold: 700 },
                      lineHeights: { tight: '1.25', normal: '1.5', relaxed: '1.75' },
                    },
                    palette: {
                      primary: result.generation.concepts[0]?.palette.primary || '#2563eb',
                      secondary: result.generation.concepts[0]?.palette.secondary || '#475569',
                      background: result.generation.concepts[0]?.palette.background || '#0f172a',
                      surface: result.generation.concepts[0]?.palette.surface || '#1e293b',
                      textPrimary: result.generation.concepts[0]?.palette.text || '#f8fafc',
                      textSecondary: '#94a3b8',
                      muted: '#64748b',
                      border: '#334155',
                      success: '#10b981',
                      warning: '#f59e0b',
                      error: '#ef4444',
                    },
                    density: {
                      mode: 'comfortable' as const,
                      spacingUnit: 4,
                      padding: { button: '8px 16px', card: '16px', input: '8px 12px' },
                      gap: { grid: '16px', list: '8px' },
                    },
                    designTokens: { borderRadius: '6px' },
                    componentStyles: [],
                    responsiveRules: [],
                    sampleScreens: [],
                    attributedReferences: [],
                  },
                  {
                    name: result.generation.concepts[1]?.title || 'Warm Humanist',
                    styleApproach: result.generation.concepts[1]?.styleArchetype || 'Warm neutral tones with spacious layout and softer edges',
                    typography: {
                      fontFamilySans: 'system-ui, sans-serif',
                      fontFamilyMono: 'Menlo, monospace',
                      scale: { xs: '12px', sm: '14px', base: '16px', lg: '18px', xl: '20px', '2xl': '24px', '3xl': '30px' },
                      weights: { regular: 400, medium: 500, semibold: 600, bold: 700 },
                      lineHeights: { tight: '1.25', normal: '1.5', relaxed: '1.75' },
                    },
                    palette: {
                      primary: result.generation.concepts[1]?.palette.primary || '#d97706',
                      secondary: result.generation.concepts[1]?.palette.secondary || '#57534e',
                      background: result.generation.concepts[1]?.palette.background || '#fafaf9',
                      surface: result.generation.concepts[1]?.palette.surface || '#ffffff',
                      textPrimary: result.generation.concepts[1]?.palette.text || '#1c1917',
                      textSecondary: '#78716c',
                      muted: '#a8a29e',
                      border: '#e7e5e4',
                      success: '#16a34a',
                      warning: '#ea580c',
                      error: '#dc2626',
                    },
                    density: {
                      mode: 'spacious' as const,
                      spacingUnit: 4,
                      padding: { button: '10px 20px', card: '24px', input: '10px 14px' },
                      gap: { grid: '24px', list: '12px' },
                    },
                    designTokens: { borderRadius: '12px' },
                    componentStyles: [],
                    responsiveRules: [],
                    sampleScreens: [],
                    attributedReferences: [],
                  },
                ];
                if (selectedUXId) {
                  try {
                    const pipeRes = this.engine.pipeline.processUIResponse(brief.id, selectedUXId, { concepts: pipelineConcepts });
                    if (pipeRes.success && pipeRes.concepts && pipeRes.concepts.length > 0) {
                      pipeRes.concepts.forEach((pc: any, idx: number) => {
                        if (result.generation.concepts[idx]) {
                          result.generation.concepts[idx].conceptId = pc.id;
                        }
                      });
                      this.saveSessionRecord(sessionId, {
                        uiGenerations: result.uiGenerations,
                      });
                    }
                  } catch {}
                }
              }

              const enrichedConcepts = result.generation.concepts.map((c: any) => ({
                ...c,
                id: c.conceptId,
                name: c.title,
              }));

              this.broadcast({ type: 'STATE_UPDATE', state: this.getState(sessionId) });
              this.sendJson(res, 200, {
                success: true,
                sessionId,
                generation: result.generation,
                uiGenerations: result.uiGenerations,
                concepts: enrichedConcepts,
                basedOnUx: result.basedOnUx,
                stage: 'UI_REVIEW',
              });
            } catch (err: any) {
              const statusCode = err.statusCode || 400;
              this.sendJson(res, statusCode, {
                success: false,
                isError: true,
                error: err.message || 'Failed to generate UI concepts',
              });
            }
            return;
          }

          // 7. POST /api/ui/select
          if (method === 'POST' && pathname === '/api/ui/select') {
            const body = await this.parseBody(req);
            let sessionId = body.sessionId || (parsedUrl.query?.sessionId as string);
            if (!sessionId || sessionId === 'default' || sessionId === 'null' || sessionId === 'undefined' || sessionId === 'new') {
              sessionId = this.focusedDesktopSessionId || (this.isTestEnvironment() ? 'test-session-hermes' : undefined);
            }
            if (!sessionId) {
              this.sendJson(res, 400, {
                success: false,
                isError: true,
                error: 'No active Hermes conversation session specified or focused.',
              });
              return;
            }

            const targetQuery =
              body.conceptId ||
              body.uiConceptId ||
              body.id ||
              body.title ||
              body.name ||
              (body.index !== undefined ? String(body.index) : null);

            if (!targetQuery && targetQuery !== '0') {
              this.sendJson(res, 400, {
                success: false,
                error: 'conceptId (or alias uiConceptId, title, name, index) is required',
              });
              return;
            }

            const result = await this.selectUIConcept(
              sessionId,
              targetQuery,
              body.generationId,
              {
                userInitiated: body.userInitiated,
                source: body.source,
              }
            );

            if (!result.success) {
              const statusCode = result.isError ? 412 : 404;
              this.sendJson(res, statusCode, result);
              return;
            }

            this.broadcast({ type: 'STATE_UPDATE', state: this.getState(sessionId) });
            this.sendJson(res, 200, {
              success: true,
              sessionId,
              selectedUi: result.selectedUi,
              selectedConceptId: result.matchedConcept?.conceptId,
              concept: result.matchedConcept,
              previewUrl: result.previewUrl,
              reachability: result.reachability,
              stage: 'PREVIEW_READY',
            });
            return;
          }

          // 8. POST /api/edit/direct
          if (method === 'POST' && pathname === '/api/edit/direct') {
            const body = await this.parseBody(req);
            const { targetUid, filePath, classes, text, operations } = body;

            if (!targetUid) {
              this.sendJson(res, 400, { success: false, error: 'targetUid is required' });
              return;
            }

            // Resolve file in Slot B if not explicitly passed
            const slotBWorktree = this.engine.dualSlotManager.getSlotBWorktree();
            let targetFile = filePath;
            if (!targetFile) {
              const manifest = slotBWorktree.getCurrentManifest();
              for (const f of manifest.files) {
                if (f.relativePath.endsWith('.tsx') || f.relativePath.endsWith('.jsx')) {
                  const content = slotBWorktree.readFile(f.relativePath);
                  if (
                    content.includes(`data-aether-uid="${targetUid}"`) ||
                    content.includes(`data-aether-uid='${targetUid}'`)
                  ) {
                    targetFile = f.relativePath;
                    break;
                  }
                }
              }
            }

            if (!targetFile) {
              this.sendJson(res, 404, {
                success: false,
                error: `Target UID "${targetUid}" not found in Slot B component files`,
              });
              return;
            }

            const mutations: EditTxMutation[] = operations || [];
            if (classes !== undefined) {
              mutations.push({
                type: 'MERGE_CLASSNAMES',
                targetUid,
                propertyGroup: 'custom',
                classesToAdd: classes,
              });
            }
            if (text !== undefined) {
              mutations.push({
                type: 'UPDATE_TEXT',
                targetUid,
                propertyGroup: 'content',
                newText: text,
              });
            }

            const baseRevision = slotBWorktree.getMerkleRoot();
            this.broadcast({ type: 'VALIDATION_STARTED', targetUid });

            const txRecord = await this.engine.editTxManager.executeTransaction({
              targetUid,
              filePath: targetFile,
              mutations,
              baseRevision,
              awaitHmrAck: false,
            });

            this.broadcast({ type: 'VALIDATION_COMPLETED', targetUid });

            if (txRecord.status === 'COMMITTED') {
              this.broadcast({ type: 'TRANSACTION_COMMITTED', txRecord });
              this.broadcast({ type: 'STATE_UPDATE', state: this.getState() });
              this.sendJson(res, 200, { success: true, txRecord });
            } else {
              this.sendJson(res, 400, {
                success: false,
                status: txRecord.status,
                error: txRecord.error || 'Transaction validation failed',
                txRecord,
              });
            }
            return;
          }

          // 9. POST /api/edit/chat
          if (method === 'POST' && pathname === '/api/edit/chat') {
            const body = await this.parseBody(req);
            const { targetUid, filePath, prompt, mutations } = body;

            if (!targetUid || !filePath) {
              this.sendJson(res, 400, { success: false, error: 'targetUid and filePath are required' });
              return;
            }

            const rawPlan: ScopedEditPlan = {
              targetUid,
              filePath,
              scope: 'ELEMENT',
              expectedTier: 'TIER_1_DETERMINISTIC',
              propertyGroups: ['typography'],
              mutations: mutations || [
                {
                  type: 'MERGE_CLASSNAMES',
                  targetUid,
                  propertyGroup: 'typography',
                  classesToAdd: 'font-semibold text-blue-500',
                },
              ],
              rationale: prompt || 'User scoped chat edit',
            };

            const baseRevision = this.engine.dualSlotManager.getSlotBWorktree().getMerkleRoot();
            const result = await this.engine.pipeline.processEditPlanAndExecute(rawPlan, baseRevision, {
              awaitHmrAck: false,
            });

            if (result.success) {
              this.broadcast({ type: 'TRANSACTION_COMMITTED', txRecord: result.txRecord });
              this.broadcast({ type: 'STATE_UPDATE', state: this.getState() });
              this.sendJson(res, 200, { success: true, result });
            } else {
              this.sendJson(res, 400, { success: false, errors: result.errors, result });
            }
            return;
          }

          // 10. POST /api/approval/promote
          if (method === 'POST' && pathname === '/api/approval/promote') {
            const body = await this.parseBody(req);
            try {
              const promotionResult = this.engine.approvalGate.approveAndPromote({
                approved: true,
                actor: 'user',
                timestamp: new Date().toISOString(),
                confirmSharedBlastRadius: Boolean(body.confirmSharedBlastRadius),
                forceIfStaleHost: Boolean(body.forceIfStaleHost),
              });

              this.broadcast({ type: 'PROMOTION_SUCCESS', promotionResult });
              this.broadcast({ type: 'STATE_UPDATE', state: this.getState() });
              this.sendJson(res, 200, { success: true, promotionResult });
            } catch (err: any) {
              this.sendJson(res, 400, { success: false, error: err.message, name: err.name });
            }
            return;
          }

          // 11. POST /api/approval/deny
          if (method === 'POST' && pathname === '/api/approval/deny') {
            this.engine.dualSlotManager.rollbackCandidate();
            const revertedRoot = this.engine.dualSlotManager.getSlotBWorktree().getMerkleRoot();
            this.engine.ledger.revisionPointers.advanceCandidateWork(revertedRoot);

            this.broadcast({ type: 'STATE_UPDATE', state: this.getState() });
            this.sendJson(res, 200, { success: true, message: 'Slot B candidate reverted to Slot A verified build' });
            return;
          }

          // 12. POST /api/checkpoint/restore
          if (method === 'POST' && pathname === '/api/checkpoint/restore') {
            const body = await this.parseBody(req);
            const { checkpointId, mode } = body;
            if (!checkpointId) {
              this.sendJson(res, 400, { success: false, error: 'checkpointId is required' });
              return;
            }

            try {
              let restored: any;
              if (mode === 'visual') {
                restored = this.engine.recovery.recoverVisualSnapshot(checkpointId);
              } else {
                restored = this.engine.recovery.recoverRunnableSourceTree(
                  checkpointId,
                  this.engine.dualSlotManager.getSlotBWorktree()
                );
              }
              this.broadcast({ type: 'STATE_UPDATE', state: this.getState() });
              this.sendJson(res, 200, { success: true, checkpointId, restored });
            } catch (err: any) {
              this.sendJson(res, 400, { success: false, error: err.message });
            }
            return;
          }

          // 13. GET /api/handoff/export (FR-20)
          if (method === 'GET' && pathname === '/api/handoff/export') {
            const format = (parsedUrl.query.format as string) || 'markdown';
            const handoffPkg = await HandoffExporter.createFromEngine(this.engine);

            if (format === 'json') {
              const jsonContent = HandoffExporter.generateJsonHandoff(handoffPkg);
              res.writeHead(200, {
                ...getStudioSecurityHeaders(origin),
                'Content-Type': 'application/json',
                'Content-Disposition': 'attachment; filename="handoff.json"',
              });
              res.end(jsonContent);
              return;
            }

            if (format === 'all') {
              this.sendJson(res, 200, {
                markdown: HandoffExporter.generateMarkdownHandoff(handoffPkg),
                json: HandoffExporter.generateJsonHandoff(handoffPkg),
                package: handoffPkg,
              }, origin);
              return;
            }

            // Default to markdown (HANDOFF.md)
            const mdContent = HandoffExporter.generateMarkdownHandoff(handoffPkg);
            res.writeHead(200, {
              ...getStudioSecurityHeaders(origin),
              'Content-Type': 'text/markdown; charset=utf-8',
              'Content-Disposition': 'attachment; filename="HANDOFF.md"',
            });
            res.end(mdContent);
            return;
          }

          // 404 Catch-All
          res.writeHead(404, { ...getStudioSecurityHeaders(origin), 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Not found: ${method} ${pathname}` }));
        } catch (err: any) {
          res.writeHead(500, { ...getStudioSecurityHeaders(origin), 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      // Attach WebSocketServer
      this.wss = new WebSocketServer({ server: this.httpServer, path: '/ws' });
      this.wss.on('connection', (socket) => {
        socket.send(JSON.stringify({ type: 'STATE_UPDATE', state: this.getState() }));

        socket.on('message', (raw) => {
          try {
            const data = JSON.parse(raw.toString());
            if (data.type === 'SELECT_ELEMENT') {
              this.broadcast({ type: 'SELECTION_CHANGE', targetUid: data.targetUid });
            }
          } catch {
            // Ignore malformed WS payloads
          }
        });
      });

      this.httpServer.listen(this.port, this.host, async () => {
        this.isRunning = true;
        try {
          await this.engine.dualSlotManager.startPreviews();
        } catch (e: any) {
          console.warn('[StudioServer] Preview servers start failed:', e.message);
        }
        resolve(this.getServerUrl());
      });

      this.httpServer.on('error', (err) => {
        reject(err);
      });
    });
  }

  private generateCandidateCodeForUIConcept(concept: any): void {
    const slotBWorktree = this.engine.dualSlotManager.getSlotBWorktree();
    const rawPalette = concept.palette || {};
    const p = {
      primary: rawPalette.primary || '#2563eb',
      secondary: rawPalette.secondary || '#475569',
      background: rawPalette.background || '#0f172a',
      surface: rawPalette.surface || '#1e293b',
      textPrimary: rawPalette.textPrimary || rawPalette.text || '#f8fafc',
      textSecondary: rawPalette.textSecondary || rawPalette.secondary || '#94a3b8',
      border: rawPalette.border || '#334155',
      accent: rawPalette.accent || rawPalette.primary || '#38bdf8',
    };
    const font = concept.typography?.fontFamilySans || concept.typography?.bodyFont || 'Inter, system-ui, sans-serif';
    const borderRadius = concept.designTokens?.borderRadius || '8px';

    const appTsx = `import React, { useState } from 'react';

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <div data-aether-uid="app-root" style={{
      minHeight: '100vh',
      backgroundColor: '${p.background}',
      color: '${p.textPrimary}',
      fontFamily: '${font}',
      padding: '32px',
      boxSizing: 'border-box'
    }}>
      <header data-aether-uid="header" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingBottom: '24px',
        borderBottom: '1px solid ${p.border}'
      }}>
        <div data-aether-uid="brand" style={{ fontSize: '20px', fontWeight: 700, color: '${p.primary}' }}>
          ${concept.name}
        </div>
        <button data-aether-uid="header-action-btn" style={{
          backgroundColor: '${p.primary}',
          color: '#ffffff',
          border: 'none',
          padding: '8px 16px',
          borderRadius: '${borderRadius}',
          fontWeight: 600,
          cursor: 'pointer'
        }}>
          New Action
        </button>
      </header>

      <main data-aether-uid="main-content" style={{ marginTop: '32px' }}>
        <section data-aether-uid="hero-section" style={{
          backgroundColor: '${p.surface}',
          borderRadius: '${borderRadius}',
          padding: '28px',
          border: '1px solid ${p.border}',
          marginBottom: '24px'
        }}>
          <h1 data-aether-uid="hero-title" style={{ margin: '0 0 12px 0', fontSize: '28px', fontWeight: 700 }}>
            ${concept.name} Concept
          </h1>
          <p data-aether-uid="hero-subtitle" style={{ margin: '0 0 20px 0', color: '${p.textSecondary}', fontSize: '15px' }}>
            ${concept.styleApproach || 'Clean minimal design system candidate preview'}
          </p>
          <button data-aether-uid="counter-btn" onClick={() => setCount(count + 1)} style={{
            backgroundColor: '${p.primary}',
            color: '#ffffff',
            border: 'none',
            padding: '10px 20px',
            borderRadius: '${borderRadius}',
            fontWeight: 600,
            cursor: 'pointer'
          }}>
            Clicked {count} times
          </button>
        </section>

        <div data-aether-uid="cards-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' }}>
          <div data-aether-uid="card-1" style={{
            backgroundColor: '${p.surface}',
            borderRadius: '${borderRadius}',
            padding: '20px',
            border: '1px solid ${p.border}'
          }}>
            <h3 data-aether-uid="card-1-title" style={{ margin: '0 0 8px 0', fontSize: '18px' }}>Task Efficiency</h3>
            <p data-aether-uid="card-1-desc" style={{ margin: 0, color: '${p.textSecondary}', fontSize: '14px' }}>Optimized for quick triage and minimal cognitive overhead.</p>
          </div>
          <div data-aether-uid="card-2" style={{
            backgroundColor: '${p.surface}',
            borderRadius: '${borderRadius}',
            padding: '20px',
            border: '1px solid ${p.border}'
          }}>
            <h3 data-aether-uid="card-2-title" style={{ margin: '0 0 8px 0', fontSize: '18px' }}>Real-time Signals</h3>
            <p data-aether-uid="card-2-desc" style={{ margin: 0, color: '${p.textSecondary}', fontSize: '14px' }}>Instant bidirectional feedback via Aether Fiber Bridge.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
`;

    const indexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${concept.name} - Aether Preview</title>
    <!-- Aether Runtime Fiber Bridge Injection -->
    <script>
      window.__AETHER_BRIDGE_WS_PORT__ = 4176;
    </script>
    <script type="module" src="/.aether-runtime/fiber-bridge-client.js"></script>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background-color: ${p.background};
        color: ${p.textPrimary};
        font-family: ${font};
        -webkit-font-smoothing: antialiased;
      }
    </style>
  </head>
  <body>
    <div id="root">
      <div data-aether-uid="app-root" style="min-height: 100vh; background-color: ${p.background}; color: ${p.textPrimary}; font-family: ${font}; padding: 32px; box-sizing: border-box;">
        <header data-aether-uid="header" style="display: flex; justify-content: space-between; align-items: center; padding-bottom: 24px; border-bottom: 1px solid ${p.border};">
          <div data-aether-uid="brand" style="font-size: 20px; font-weight: 700; color: ${p.primary};">
            ${concept.name}
          </div>
          <button data-aether-uid="header-action-btn" style="background-color: ${p.primary}; color: #ffffff; border: none; padding: 8px 16px; border-radius: ${borderRadius}; font-weight: 600; cursor: pointer;">
            New Action
          </button>
        </header>

        <main data-aether-uid="main-content" style="margin-top: 32px;">
          <section data-aether-uid="hero-section" style="background-color: ${p.surface}; border-radius: ${borderRadius}; padding: 28px; border: 1px solid ${p.border}; margin-bottom: 24px;">
            <h1 data-aether-uid="hero-title" style="margin: 0 0 12px 0; font-size: 28px; font-weight: 700;">
              ${concept.name} Concept
            </h1>
            <p data-aether-uid="hero-subtitle" style="margin: 0 0 20px 0; color: ${p.textSecondary}; font-size: 15px;">
              ${concept.styleApproach || 'Clean minimal design system candidate preview'}
            </p>
            <button data-aether-uid="counter-btn" style="background-color: ${p.primary}; color: #ffffff; border: none; padding: 10px 20px; border-radius: ${borderRadius}; font-weight: 600; cursor: pointer;">
              Interactive Ready
            </button>
          </section>

          <div data-aether-uid="cards-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px;">
            <div data-aether-uid="card-1" style="background-color: ${p.surface}; border-radius: ${borderRadius}; padding: 20px; border: 1px solid ${p.border};">
              <h3 data-aether-uid="card-1-title" style="margin: 0 0 8px 0; font-size: 18px;">Task Efficiency</h3>
              <p data-aether-uid="card-1-desc" style="margin: 0; color: ${p.textSecondary}; font-size: 14px;">Optimized for quick triage and minimal cognitive overhead.</p>
            </div>
            <div data-aether-uid="card-2" style="background-color: ${p.surface}; border-radius: ${borderRadius}; padding: 20px; border: 1px solid ${p.border};">
              <h3 data-aether-uid="card-2-title" style="margin: 0 0 8px 0; font-size: 18px;">Real-time Signals</h3>
              <p data-aether-uid="card-2-desc" style="margin: 0; color: ${p.textSecondary}; font-size: 14px;">Instant bidirectional feedback via Aether Fiber Bridge.</p>
            </div>
          </div>
        </main>
      </div>
    </div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;

    slotBWorktree.writeCandidateFile('src/App.tsx', appTsx);
    slotBWorktree.writeCandidateFile('index.html', indexHtml);
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) return;

    if (this.wss) {
      for (const client of this.wss.clients) {
        client.terminate();
      }
      this.wss.close();
      this.wss = null;
    }

    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => {
          this.httpServer = null;
          resolve();
        });
      });
    }

    this.isRunning = false;
  }
}
