import { test, describe, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { WebSocket } from 'ws';
import { AetherEngine } from '../src/engine/aether-engine';
import { StudioServer, STUDIO_FRAMING_HEADERS } from '../src/server/studio-server';
import { AetherMcpServer, AETHER_MCP_TOOLS } from '../src/mcp/aether-mcp-server';
import { renderStudioHtml } from '../src/ui/studio-html';

describe('Module 7: Hermes Plugin Manifest, MCP Tools & Split-Screen Embed', () => {
  let tempHostDir: string;
  let engine: AetherEngine;
  let server: StudioServer;
  let serverUrl: string;
  let mcpServer: AetherMcpServer;

  const studioPort = 39140;
  const slotAPort = 39141;
  const slotBPort = 39142;

  before(async () => {
    tempHostDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-hermes-test-'));

    // Populate a sample host app
    const appTsx = `
import React from 'react';

export function Dashboard() {
  return (
    <div data-aether-uid="dash-root" className="p-6 bg-slate-900 text-white">
      <h1 data-aether-uid="dash-title" className="text-xl font-bold">Hermes Dashboard</h1>
      <button data-aether-uid="dash-btn" className="px-3 py-1 bg-emerald-500 rounded">
        Execute Task
      </button>
    </div>
  );
}
    `.trim();

    fs.writeFileSync(path.join(tempHostDir, 'App.tsx'), appTsx, 'utf8');
    fs.writeFileSync(
      path.join(tempHostDir, 'package.json'),
      JSON.stringify({ name: 'hermes-test-app', version: '1.0.0' }, null, 2),
      'utf8'
    );

    engine = new AetherEngine({
      hostRootDir: tempHostDir,
      slotAPort,
      slotBPort,
      mode: 'mock_http',
    });

    await engine.initialize(false);

    engine.dualSlotManager.getSlotAWorktree().mirrorFromHost(['package.json', 'App.tsx']);
    engine.dualSlotManager.getSlotBWorktree().mirrorFromHost(['package.json', 'App.tsx']);

    await engine.dualSlotManager.startPreviews();

    server = new StudioServer(engine, { port: studioPort, host: '127.0.0.1' });
    serverUrl = await server.start();

    mcpServer = new AetherMcpServer({
      engine,
      serverUrl,
      port: studioPort,
    });
  });

  after(async () => {
    await server.stop();
    await engine.stop();
    try {
      fs.rmSync(tempHostDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  });

  test('1. Loopback Security & Iframe Framing Headers are enforced with restricted CORS', async () => {
    // 1. Check StudioServer framing headers with legitimate loopback origin
    const res = await fetch(`${serverUrl}/api/state`, {
      headers: { Origin: 'http://127.0.0.1:4173' },
    });
    assert.strictEqual(res.status, 200);

    const csp = res.headers.get('content-security-policy') || '';
    assert.ok(csp.includes("frame-ancestors 'self'") && csp.includes("http://127.0.0.1:*") && csp.includes("file: hermes: *;"));

    // Origin is reflected only when allowed, never wildcard '*'
    const cors = res.headers.get('access-control-allow-origin');
    assert.strictEqual(cors, 'http://127.0.0.1:4173');

    // 2. Reject untrusted cross-origin requests immediately (prevents drive-by attacks from arbitrary websites)
    const evilRes = await fetch(`${serverUrl}/api/state`, {
      headers: { Origin: 'http://evil.com' },
    });
    assert.strictEqual(evilRes.status, 403);
    const evilBody = await evilRes.json();
    assert.ok(evilBody.error.includes('Forbidden'));

    // 3. Check OPTIONS preflight with allowed origin
    const optionsRes = await fetch(`${serverUrl}/api/state`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://127.0.0.1:4173' },
    });
    assert.strictEqual(optionsRes.status, 204);
    assert.ok(optionsRes.headers.get('content-security-policy')?.includes('frame-ancestors'));
    assert.strictEqual(optionsRes.headers.get('access-control-allow-origin'), 'http://127.0.0.1:4173');

    // 4. Preflight with untrusted origin is rejected
    const evilOptions = await fetch(`${serverUrl}/api/state`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://evil.com' },
    });
    assert.strictEqual(evilOptions.status, 403);

    // 5. Check ViteHarness headers (Slot A)
    const slotARes = await fetch(`http://127.0.0.1:${slotAPort}/index.html`, {
      headers: { Origin: 'http://127.0.0.1:4173' },
    });
    const slotACsp = slotARes.headers.get('content-security-policy') || '';
    assert.ok(slotACsp.includes('frame-ancestors'));
    assert.strictEqual(slotARes.headers.get('access-control-allow-origin'), 'http://127.0.0.1:4173');

    // Untrusted origin to ViteHarness is rejected
    const slotAEvil = await fetch(`http://127.0.0.1:${slotAPort}/index.html`, {
      headers: { Origin: 'http://evil.com' },
    });
    assert.strictEqual(slotAEvil.status, 403);
  });

  test('2. Hermes Split-Screen Embed Mode (?embed=hermes) renders compact split UI', async () => {
    // 1. Direct fetch with query param ?embed=hermes
    const res = await fetch(`${serverUrl}/?embed=hermes`);
    assert.strictEqual(res.status, 200);
    const html = await res.text();

    assert.ok(html.includes('hermes-badge'));
    assert.ok(html.includes('Hermes Split Mode'));
    assert.ok(html.includes('split-mode-btn'));
    assert.ok(html.includes('chat-toggle-btn'));
    assert.ok(html.includes('isSplitMode'));
    assert.ok(html.includes('hermes-embed'));

    // 2. Server render with options.embed = 'hermes'
    const serverHtml = renderStudioHtml({ currentState: 'Preview Ready' }, { embed: 'hermes' });
    assert.ok(serverHtml.includes('Hermes Split Mode'));
    assert.ok(serverHtml.includes('true;')); // isEmbedInitial true
  });

  test('3. MCP Protocol Handshake: initialize and tools/list', async () => {
    // 1. Initialize
    const initRes = await mcpServer.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    });

    assert.strictEqual(initRes.id, 1);
    assert.strictEqual(initRes.result.serverInfo.name, 'aether-mcp-server');
    assert.ok(initRes.result.capabilities.tools);

    // 2. Tools List
    const listRes = await mcpServer.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });

    assert.strictEqual(listRes.id, 2);
    const tools = listRes.result.tools;
    assert.ok(Array.isArray(tools));
    assert.strictEqual(tools.length, 10);

    const toolNames = tools.map((t: any) => t.name);
    assert.ok(toolNames.includes('aether_status'));
    assert.ok(toolNames.includes('aether_submit_context'));
    assert.ok(toolNames.includes('aether_generate_ux'));
    assert.ok(toolNames.includes('aether_select_ux'));
    assert.ok(toolNames.includes('aether_generate_ui'));
    assert.ok(toolNames.includes('aether_select_ui'));
    assert.ok(toolNames.includes('aether_edit_component'));
    assert.ok(toolNames.includes('aether_approve_promote'));
    assert.ok(toolNames.includes('aether_restore_checkpoint'));
    assert.ok(toolNames.includes('aether_export_handoff'));
  });

  test('4. Native Hermes Tools drive Aether state machine from Chat & broadcast to Split View', async () => {
    // Connect WebSocket client to simulate the split-screen webview
    const wsUrl = `ws://127.0.0.1:${studioPort}/ws`;
    const ws = new WebSocket(wsUrl);
    const wsMessages: any[] = [];

    ws.on('message', (data) => {
      wsMessages.push(JSON.parse(data.toString()));
    });

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    // 1. aether_status
    const statusRes = await mcpServer.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { name: 'aether_status', arguments: {} },
    });
    assert.strictEqual(statusRes.result.isError, false);
    const statusData = JSON.parse(statusRes.result.content[0].text);
    assert.ok(statusData.currentState);
    assert.ok(statusData.revisionPointers);

    // 2. aether_submit_context (FR-01)
    const ctxRes = await mcpServer.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: {
        name: 'aether_submit_context',
        arguments: {
          name: 'Hermes Cloud Console',
          text: 'Autonomous cloud infrastructure provisioning with live container telemetry.',
        },
      },
    });
    assert.strictEqual(ctxRes.result.isError, false);
    const ctxData = JSON.parse(ctxRes.result.content[0].text);
    assert.strictEqual(ctxData.success, true);
    assert.strictEqual(ctxData.brief.name, 'Hermes Cloud Console');

    // 3. aether_generate_ux & aether_select_ux (FR-02, FR-03)
    const genUxRes = await mcpServer.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: { name: 'aether_generate_ux', arguments: {} },
    });
    const uxData = JSON.parse(genUxRes.result.content[0].text);
    assert.strictEqual(uxData.success, true);
    assert.ok(uxData.directions.length >= 2);

    const chosenUxId = uxData.directions[0].id;
    const selectUxRes = await mcpServer.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/call',
      params: {
        name: 'aether_select_ux',
        arguments: { directionId: chosenUxId, rationale: 'Hermes Agent automated choice' },
      },
    });
    const selectUxData = JSON.parse(selectUxRes.result.content[0].text);
    assert.strictEqual(selectUxData.success, true);

    // 4. aether_generate_ui & aether_select_ui (FR-04 to FR-08)
    const genUiRes = await mcpServer.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 14,
      method: 'tools/call',
      params: { name: 'aether_generate_ui', arguments: {} },
    });
    const uiData = JSON.parse(genUiRes.result.content[0].text);
    assert.strictEqual(uiData.success, true);

    const chosenUiId = uiData.concepts[0].id;
    const selectUiRes = await mcpServer.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 15,
      method: 'tools/call',
      params: { name: 'aether_select_ui', arguments: { conceptId: chosenUiId } },
    });
    const selectUiData = JSON.parse(selectUiRes.result.content[0].text);
    assert.strictEqual(selectUiData.success, true);

    // 5. aether_edit_component (Deterministic AST Surgery on Slot B)
    const editRes = await mcpServer.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 16,
      method: 'tools/call',
      params: {
        name: 'aether_edit_component',
        arguments: {
          targetUid: 'dash-title',
          classes: 'text-2xl font-black text-cyan-400 tracking-wide',
          text: 'Hermes Telemetry Hub',
        },
      },
    });
    const editData = JSON.parse(editRes.result.content[0].text);
    assert.strictEqual(editData.success, true);
    assert.strictEqual(editData.txRecord.status, 'COMMITTED');

    // Verify Slot B modified while Slot A and Host untouched
    const slotBApp = engine.dualSlotManager.getSlotBWorktree().readFile('App.tsx');
    assert.ok(slotBApp.includes('Hermes Telemetry Hub'));
    assert.ok(!engine.dualSlotManager.getSlotAWorktree().readFile('App.tsx').includes('Hermes Telemetry Hub'));
    assert.ok(!fs.readFileSync(path.join(tempHostDir, 'App.tsx'), 'utf8').includes('Hermes Telemetry Hub'));

    // Wait briefly for WebSocket notification
    await new Promise((resolve) => setTimeout(resolve, 80));
    const txWsMsg = wsMessages.find((m) => m.type === 'TRANSACTION_COMMITTED');
    assert.ok(txWsMsg, 'WebSocket must receive TRANSACTION_COMMITTED within <100ms in split mode');

    // 6. aether_approve_promote (Promote to host repo)
    const promoteRes = await mcpServer.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 17,
      method: 'tools/call',
      params: {
        name: 'aether_approve_promote',
        arguments: { confirmSharedBlastRadius: true, forceIfStaleHost: true },
      },
    });
    const promoteData = JSON.parse(promoteRes.result.content[0].text);
    assert.strictEqual(promoteData.success, true);

    // Host has stripped dev UIDs and updated text
    const hostApp = fs.readFileSync(path.join(tempHostDir, 'App.tsx'), 'utf8');
    assert.ok(hostApp.includes('Hermes Telemetry Hub'));
    assert.ok(!hostApp.includes('data-aether-uid'), 'Zero production DOM leak in host App.tsx');

    // 7. aether_export_handoff (FR-20)
    const handoffRes = await mcpServer.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 18,
      method: 'tools/call',
      params: { name: 'aether_export_handoff', arguments: { format: 'all' } },
    });
    const handoffData = JSON.parse(handoffRes.result.content[0].text);
    assert.ok(handoffData.markdown);
    assert.ok(handoffData.json);
    assert.strictEqual(handoffData.package.brief.name, 'Hermes Cloud Console');

    ws.close();
  });

  test('5. Hermes Desktop Plugin Contract: placement=main, dock, defaultCollapsed=true & auto-reveal wiring', async () => {
    const pluginCode = fs.readFileSync(path.resolve(process.cwd(), 'desktop', 'plugin.js'), 'utf8');

    // 1. Verify permitted runtime imports only
    assert.ok(pluginCode.includes("from '@hermes/plugin-sdk'"));
    assert.ok(pluginCode.includes("from 'react'"));
    assert.ok(pluginCode.includes("from 'react/jsx-runtime'"));
    assert.ok(!pluginCode.includes("from 'fs'"));
    assert.ok(!pluginCode.includes("from 'child_process'"));

    // 2. Verify Pane registration contract
    assert.ok(pluginCode.includes("id: 'studio'"));
    assert.ok(pluginCode.includes("placement: 'main'"), "Must use placement: 'main' to tile beside workspace chat, not 'right'");
    assert.ok(pluginCode.includes("pane: 'workspace'"));
    assert.ok(pluginCode.includes("pos: 'right'"));
    assert.ok(pluginCode.includes("defaultCollapsed: true"), "Must be defaultCollapsed: true to stay hidden until triggered");

    // 3. Verify Palette registration contract
    assert.ok(pluginCode.includes("area: 'palette'"));
    assert.ok(pluginCode.includes("run: () =>"));
    assert.ok(pluginCode.includes("aether-ui:studio"));

    // 4. Verify Programmatic Reveal Trigger wiring
    assert.ok(pluginCode.includes("host.revealPane('aether-ui:studio')"));
    assert.ok(pluginCode.includes("ctx.onEvent('*'"));

    // 5. Verify no unconditional popup at startup
    assert.ok(!pluginCode.includes("setTimeout(() => {\n          try {\n            host.revealPane"), "Must not unconditionally reveal at startup");

    // 6. Verify dark fallback and health check
    assert.ok(pluginCode.includes("checkHealth"));
    assert.ok(pluginCode.includes("/api/health"));
    assert.ok(pluginCode.includes("#0f172a"), "Must use dark theme background");
  });
});
