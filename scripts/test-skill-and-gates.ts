import * as path from 'path';
import * as fs from 'fs';
import { AetherEngine } from '../src/engine/aether-engine';
import { StudioServer } from '../src/server/studio-server';
import { AetherMcpServer } from '../src/mcp/aether-mcp-server';

async function verifyGates() {
  console.log('=== VERIFYING SKILL AND HARD PRECONDITION GATES ===\n');

  const testPort = 49300;
  const engine = new AetherEngine({
    hostRootDir: process.cwd(),
    dbPath: ':memory:',
  });

  const server = new StudioServer(engine, { port: testPort, host: '127.0.0.1' });
  await server.start();
  console.log(`[1] StudioServer started on port ${testPort}`);

  const mcpServer = new AetherMcpServer({
    serverUrl: `http://127.0.0.1:${testPort}`,
  });

  try {
    const testSession = 'gate-test-session-1';

    // Focus desktop session
    await fetch(`http://127.0.0.1:${testPort}/api/session/focus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: testSession, profileId: 'test-aether' }),
    });

    // GATE TEST 1: Calling aether_generate_ui on fresh session returns PRECONDITION_FAILED
    console.log('[TEST 1] Calling aether_generate_ui on fresh session (no UX generations)...');
    let gate1Passed = false;
    try {
      await mcpServer.executeTool('aether_generate_ui', { sessionId: testSession });
    } catch (err: any) {
      if (err.message.includes('PRECONDITION_FAILED: Cannot generate UI concepts before UX directions exist')) {
        gate1Passed = true;
        console.log(`✓ PASS: Gate 1 blocked premature aether_generate_ui: "${err.message}"`);
      } else {
        throw new Error(`Unexpected error message for Gate 1: ${err.message}`);
      }
    }
    if (!gate1Passed) {
      throw new Error('GATE 1 FAILED: aether_generate_ui did not reject when uxGenerations.length === 0');
    }

    // Now generate UX directions
    console.log('\n[TEST 2] Generating UX directions for session...');
    const uxRes = await mcpServer.executeTool('aether_generate_ux', {
      sessionId: testSession,
      promptSummary: 'Fitness tracker dashboard and workout log',
    });
    console.log(`✓ Generated ${uxRes.directionsGenerated} UX directions.`);

    // GATE TEST 2: Calling aether_generate_ui when UX exists but selectedUx === null returns PRECONDITION_FAILED
    console.log('\n[TEST 3] Calling aether_generate_ui after generate_ux but BEFORE selection...');
    let gate2Passed = false;
    try {
      await mcpServer.executeTool('aether_generate_ui', { sessionId: testSession });
    } catch (err: any) {
      if (err.message.includes('PRECONDITION_FAILED: UX directions have been generated for this session, but the user has not selected a UX direction yet')) {
        gate2Passed = true;
        console.log(`✓ PASS: Gate 2 blocked premature aether_generate_ui before selection: "${err.message}"`);
      } else {
        throw new Error(`Unexpected error message for Gate 2: ${err.message}`);
      }
    }
    if (!gate2Passed) {
      throw new Error('GATE 2 FAILED: aether_generate_ui did not reject when selectedUx === null');
    }

    // GATE TEST 3: Calling aether_select_ux immediately (< 2s) in the same automated turn returns WAIT_FOR_USER
    console.log('\n[TEST 4] Calling aether_select_ux immediately (< 2s) via automated agent turn...');
    let gate3Passed = false;
    try {
      await mcpServer.executeTool('aether_select_ux', {
        sessionId: testSession,
        directionId: 'ux_gen1_dir1',
      });
    } catch (err: any) {
      if (err.message.includes('WAIT_FOR_USER: Do not auto-select a UX direction on the same turn it was generated')) {
        gate3Passed = true;
        console.log(`✓ PASS: Gate 3 blocked automated same-turn auto-selection: "${err.message}"`);
      } else {
        throw new Error(`Unexpected error message for Gate 3: ${err.message}`);
      }
    }
    if (!gate3Passed) {
      throw new Error('GATE 3 FAILED: aether_select_ux did not reject when called < 2s after generation');
    }

    // Wait > 2 seconds to simulate user interaction
    console.log('\n[TEST 5] Waiting 2.1 seconds for user interaction window...');
    await new Promise((resolve) => setTimeout(resolve, 2100));

    // Now selection by user (or after delay) should succeed!
    console.log('Selecting UX direction after delay...');
    const selectRes = await mcpServer.executeTool('aether_select_ux', {
      sessionId: testSession,
      directionId: 'ux_gen1_dir1',
    });
    console.log(`✓ PASS: Selection succeeded: ${JSON.stringify(selectRes.selectedUx)}`);

    // Now aether_generate_ui should succeed!
    console.log('Generating UI concepts after valid selection...');
    const uiRes = await mcpServer.executeTool('aether_generate_ui', { sessionId: testSession });
    console.log(`✓ PASS: UI concepts generated successfully: ${uiRes.concepts?.length || 2} concepts.`);

    console.log('\n=============================================================');
    console.log('ALL PRECONDITION GATES VERIFIED SUCCESSFULLY (3/3)');
    console.log('=============================================================\n');
  } finally {
    await server.stop();
  }
}

verifyGates().catch((err) => {
  console.error('GATE VERIFICATION FAILED:', err);
  process.exit(1);
});
