import { test, describe, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { WebSocket } from 'ws';
import { AetherEngine } from '../src/engine/aether-engine';
import { StudioServer } from '../src/server/studio-server';
import { HandoffExporter } from '../src/server/handoff-exporter';

describe('Module 6: StudioServer, Iframe Bridge & Hermes Workspace (FR-20)', () => {
  let tempHostDir: string;
  let engine: AetherEngine;
  let server: StudioServer;
  let serverUrl: string;
  const testPort = 38120;
  const slotAPort = 38121;
  const slotBPort = 38122;

  before(async () => {
    tempHostDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-studio-test-'));

    // Populate a sample host app with a React component
    const appTsx = `
import React from 'react';

export function App() {
  return (
    <div data-aether-uid="app-root-001" className="p-4 bg-gray-100">
      <h1 data-aether-uid="title-001" className="text-xl font-bold">Aether Welcome</h1>
      <button data-aether-uid="btn-001" className="px-4 py-2 bg-blue-600 text-white rounded">
        Click Me
      </button>
    </div>
  );
}
    `.trim();

    fs.writeFileSync(path.join(tempHostDir, 'App.tsx'), appTsx, 'utf8');
    fs.writeFileSync(
      path.join(tempHostDir, 'package.json'),
      JSON.stringify({ name: 'test-app', version: '1.0.0' }, null, 2),
      'utf8'
    );

    engine = new AetherEngine({
      hostRootDir: tempHostDir,
      slotAPort,
      slotBPort,
      mode: 'mock_http',
    });

    await engine.initialize(false);

    // Mirror host files to Slot A and Slot B
    engine.dualSlotManager.getSlotAWorktree().mirrorFromHost(['package.json', 'App.tsx']);
    engine.dualSlotManager.getSlotBWorktree().mirrorFromHost(['package.json', 'App.tsx']);

    server = new StudioServer(engine, { port: testPort });
    serverUrl = await server.start();
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

  test('1. GET / serves complete Hermes Studio HTML with 6 workspace regions', async () => {
    const res = await fetch(`${serverUrl}/`);
    assert.strictEqual(res.status, 200);
    const contentType = res.headers.get('content-type') || '';
    assert.ok(contentType.includes('text/html'));

    const html = await res.text();
    // Region 1: Top Bar
    assert.ok(html.includes('id="top-bar"'));
    assert.ok(html.includes('id="state-badge"'));
    assert.ok(html.includes('id="rev-host"'));
    assert.ok(html.includes('id="rev-slot-a"'));
    assert.ok(html.includes('id="rev-slot-b"'));

    // Region 2: Left Conversation Pane
    assert.ok(html.includes('id="left-pane"'));
    assert.ok(html.includes('id="chat-messages"'));

    // Region 3: Center Design Canvas
    assert.ok(html.includes('id="center-canvas"'));
    assert.ok(html.includes('id="preview-frame"'));
    assert.ok(html.includes('id="val-overlay"'));
    assert.ok(html.includes('id="commit-flash"'));

    // Region 4: Right Properties Panel
    assert.ok(html.includes('id="right-pane"'));
    assert.ok(html.includes('id="prop-uid"'));
    assert.ok(html.includes('id="blast-warning"'));

    // Region 5: Bottom Shelf
    assert.ok(html.includes('id="bottom-shelf"'));

    // Region 6: Bottom Decision Bar
    assert.ok(html.includes('id="decision-bar"'));
    assert.ok(html.includes('id="approval-modal"'));
  });

  test('2. GET /api/state returns current engine state and revision pointers', async () => {
    const res = await fetch(`${serverUrl}/api/state`);
    assert.strictEqual(res.status, 200);
    const state = await res.json();

    assert.ok(state.currentState);
    assert.ok(state.revisionPointers);
    assert.ok(state.revisionPointers.host_baseline_rev);
    assert.ok(state.revisionPointers.verified_preview_rev);
    assert.ok(state.revisionPointers.candidate_work_rev);
    assert.strictEqual(state.slotAPort, slotAPort);
    assert.strictEqual(state.slotBPort, slotBPort);
  });

  test('3. Full REST Pipeline: Context -> UX -> UI workflow', async () => {
    // Stage 1: Context Ingestion (FR-01)
    const ctxRes = await fetch(`${serverUrl}/api/session/context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Developer Metrics Portal',
        text: 'A high-velocity dashboard tracking engineering cycle time, PR reviews, and build metrics.',
      }),
    });

    assert.strictEqual(ctxRes.status, 200);
    const ctxData = await ctxRes.json();
    assert.strictEqual(ctxData.success, true);
    assert.ok(ctxData.brief);
    assert.strictEqual(ctxData.brief.name, 'Developer Metrics Portal');

    // Stage 2: UX Generation (FR-02)
    const uxRes = await fetch(`${serverUrl}/api/ux/generate`, { method: 'POST' });
    assert.strictEqual(uxRes.status, 200);
    const uxData = await uxRes.json();
    assert.strictEqual(uxData.success, true);
    assert.ok(Array.isArray(uxData.directions));
    assert.ok(uxData.directions.length >= 2);

    // Stage 3: UX Selection (FR-03)
    const selectedUxId = uxData.directions[0].id;
    const selectUxRes = await fetch(`${serverUrl}/api/ux/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directionId: selectedUxId, rationale: 'Optimized for engineering lead reviews' }),
    });
    assert.strictEqual(selectUxRes.status, 200);
    const selectUxData = await selectUxRes.json();
    assert.strictEqual(selectUxData.success, true);

    // Stage 4: UI Concept Synthesis (FR-04)
    const uiRes = await fetch(`${serverUrl}/api/ui/generate`, { method: 'POST' });
    assert.strictEqual(uiRes.status, 200);
    const uiData = await uiRes.json();
    assert.strictEqual(uiData.success, true);
    assert.ok(Array.isArray(uiData.concepts));
    assert.ok(uiData.concepts.length >= 2);

    // Stage 5: UI Concept Selection (FR-05)
    const selectedUiId = uiData.concepts[0].id;
    const selectUiRes = await fetch(`${serverUrl}/api/ui/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conceptId: selectedUiId }),
    });
    assert.strictEqual(selectUiRes.status, 200);
    const selectUiData = await selectUiRes.json();
    assert.strictEqual(selectUiData.success, true);
  });

  test('4. POST /api/edit/direct executes deterministic AST surgery on Slot B without mutating Slot A or Host', async () => {
    const directRes = await fetch(`${serverUrl}/api/edit/direct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetUid: 'title-001',
        classes: 'text-2xl font-extrabold text-indigo-700 tracking-tight',
        text: 'Aether Metrics Hub',
      }),
    });

    assert.strictEqual(directRes.status, 200);
    const directData = await directRes.json();
    assert.strictEqual(directData.success, true);
    assert.strictEqual(directData.txRecord.status, 'COMMITTED');

    // Invariant: Slot B modified
    const slotBApp = engine.dualSlotManager.getSlotBWorktree().readFile('App.tsx');
    assert.ok(slotBApp.includes('text-2xl font-extrabold text-indigo-700 tracking-tight'));
    assert.ok(slotBApp.includes('Aether Metrics Hub'));

    // Invariant: Slot A and Host untouched prior to approval
    const slotAApp = engine.dualSlotManager.getSlotAWorktree().readFile('App.tsx');
    assert.ok(!slotAApp.includes('Aether Metrics Hub'));

    const hostApp = fs.readFileSync(path.join(tempHostDir, 'App.tsx'), 'utf8');
    assert.ok(!hostApp.includes('Aether Metrics Hub'));
  });

  test('5. POST /api/approval/deny reverts Slot B candidate back to Slot A verified build', async () => {
    // Add another candidate change
    await fetch(`${serverUrl}/api/edit/direct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetUid: 'btn-001',
        text: 'Ephemeral Candidate Action',
      }),
    });

    assert.ok(
      engine.dualSlotManager.getSlotBWorktree().readFile('App.tsx').includes('Ephemeral Candidate Action')
    );

    // Call Deny
    const denyRes = await fetch(`${serverUrl}/api/approval/deny`, { method: 'POST' });
    assert.strictEqual(denyRes.status, 200);
    const denyData = await denyRes.json();
    assert.strictEqual(denyData.success, true);

    // Slot B now matches Slot A again
    const revertedB = engine.dualSlotManager.getSlotBWorktree().readFile('App.tsx');
    assert.ok(!revertedB.includes('Ephemeral Candidate Action'));
  });

  test('6. POST /api/approval/promote strips dev UIDs and commits approved build to host', async () => {
    // Apply candidate change
    await fetch(`${serverUrl}/api/edit/direct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetUid: 'title-001',
        text: 'Production Approved Title',
        classes: 'text-3xl font-black text-emerald-600',
      }),
    });

    const promoteRes = await fetch(`${serverUrl}/api/approval/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmSharedBlastRadius: true, forceIfStaleHost: true }),
    });

    assert.strictEqual(promoteRes.status, 200);
    const promoteData = await promoteRes.json();
    assert.strictEqual(promoteData.success, true);

    // Verify host file has updated content AND dev UIDs are strictly stripped
    const hostApp = fs.readFileSync(path.join(tempHostDir, 'App.tsx'), 'utf8');
    assert.ok(hostApp.includes('Production Approved Title'));
    assert.ok(hostApp.includes('text-3xl font-black text-emerald-600'));
    assert.ok(!hostApp.includes('data-aether-uid'), 'Zero production DOM leak invariant violated in host App.tsx');
  });

  test('7. GET /api/handoff/export generates comprehensive Markdown and JSON handoff packages (FR-20)', async () => {
    // 1. Markdown Export
    const mdRes = await fetch(`${serverUrl}/api/handoff/export?format=markdown`);
    assert.strictEqual(mdRes.status, 200);
    assert.ok(mdRes.headers.get('content-type')?.includes('text/markdown'));
    const md = await mdRes.text();

    assert.ok(md.includes('# Aether UI — Production Handoff Package (FR-20)'));
    assert.ok(md.includes('## 1. Project Context & Brief (FR-01)'));
    assert.ok(md.includes('## 2. Selected UX Direction (FR-02, FR-03)'));
    assert.ok(md.includes('## 3. Selected UI Concept & Design System (FR-04 to FR-08)'));
    assert.ok(md.includes('## 4. Component Symbol Inventory'));
    assert.ok(md.includes('## 5. Merkle Manifest & File Verification (FR-18)'));
    assert.ok(md.includes('## 6. Audit & Validation Profile (FR-14, FR-15)'));

    // 2. JSON Export
    const jsonRes = await fetch(`${serverUrl}/api/handoff/export?format=json`);
    assert.strictEqual(jsonRes.status, 200);
    const jsonData = await jsonRes.json();

    assert.ok(jsonData.exportedAt);
    assert.ok(jsonData.brief);
    assert.strictEqual(jsonData.brief.name, 'Developer Metrics Portal');
    assert.ok(jsonData.selectedUX);
    assert.ok(jsonData.selectedUI);
    assert.ok(jsonData.merkleManifest);
    assert.ok(jsonData.auditProfile);
    assert.strictEqual(jsonData.auditProfile.status, 'passed');
    assert.ok(jsonData.revisionPointers);

    // 3. Combined Export
    const allRes = await fetch(`${serverUrl}/api/handoff/export?format=all`);
    assert.strictEqual(allRes.status, 200);
    const allData = await allRes.json();
    assert.ok(allData.markdown);
    assert.ok(allData.json);
    assert.ok(allData.package);
  });

  test('8. WebSocket server broadcasts real-time state updates and selection changes', async () => {
    const wsUrl = `ws://127.0.0.1:${testPort}/ws`;
    const client = new WebSocket(wsUrl);

    const receivedMessages: any[] = [];
    client.on('message', (data) => {
      receivedMessages.push(JSON.parse(data.toString()));
    });

    await new Promise<void>((resolve, reject) => {
      client.on('open', resolve);
      client.on('error', reject);
    });

    // 1. Initial message is STATE_UPDATE
    assert.ok(receivedMessages.length >= 1);
    assert.strictEqual(receivedMessages[0].type, 'STATE_UPDATE');

    // 2. Send selection change
    client.send(JSON.stringify({ type: 'SELECT_ELEMENT', targetUid: 'title-001' }));

    // Wait briefly for broadcast
    await new Promise((resolve) => setTimeout(resolve, 100));

    const selectionMsg = receivedMessages.find((m) => m.type === 'SELECTION_CHANGE');
    assert.ok(selectionMsg);
    assert.strictEqual(selectionMsg.targetUid, 'title-001');

    client.close();
  });
});
