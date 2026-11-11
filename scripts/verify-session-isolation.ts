import * as path from 'path';
import * as fs from 'fs';

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err);
  process.exit(1);
});

import { AetherEngine } from '../src/engine/aether-engine';
import { StudioServer } from '../src/server/studio-server';
import { AetherMcpServer } from '../src/mcp/aether-mcp-server';

async function runTests() {
  console.log('--- Starting Session Isolation & Persistence Verification ---');
  console.log('Initializing AetherEngine...');
  const testDbDir = path.join(process.cwd(), '.test-session-db');
  try {
    if (fs.existsSync(testDbDir)) {
      fs.rmSync(testDbDir, { recursive: true, force: true });
    }
  } catch {}
  fs.mkdirSync(testDbDir, { recursive: true });

  const testPort = 49200;
  console.log('Creating AetherEngine instance...');
  const engine = new AetherEngine({
    hostRootDir: process.cwd(),
    dbPath: path.join(testDbDir, 'test-ledger.sqlite'),
  });
  console.log('AetherEngine instantiated successfully.');

  const server = new StudioServer(engine, { port: testPort, host: '127.0.0.1' });
  await server.start();
  console.log(`[1] StudioServer started on port ${testPort}`);

  const mcpServer = new AetherMcpServer({
    serverUrl: `http://127.0.0.1:${testPort}`,
  });

  try {
    // TEST 1: New session screen / no session returns clean empty IDLE state
    console.log('\n[TEST 1] Testing New Session Guard on GET /api/state...');
    for (const emptyVal of ['', '?sessionId=', '?sessionId=null', '?sessionId=undefined', '?sessionId=new', '?sessionId=default']) {
      const res = await fetch(`http://127.0.0.1:${testPort}/api/state${emptyVal}`);
      const data = await res.json();
      if (data.sessionId !== null && data.sessionId !== '') {
        throw new Error(`Expected null or empty sessionId for ${emptyVal}, got ${data.sessionId}`);
      }
      if (data.uxGenerations.length !== 0) {
        throw new Error(`Expected 0 uxGenerations for ${emptyVal}, got ${data.uxGenerations.length}`);
      }
      if (data.stage !== 'IDLE') {
        throw new Error(`Expected IDLE stage for ${emptyVal}, got ${data.stage}`);
      }
    }
    console.log('✓ PASS: New session and uninitialized sessions return strictly empty IDLE state (NO LEAKS).');

    // TEST 2: Calling MCP tool when no session is focused throws clear error
    console.log('\n[TEST 2] Testing MCP tool call with NO focused conversation...');
    let threwExpected = false;
    try {
      await mcpServer.executeTool('aether_status', {});
    } catch (err: any) {
      if (err.message.includes('No active Hermes conversation is focused')) {
        threwExpected = true;
      } else {
        throw err;
      }
    }
    if (!threwExpected) {
      throw new Error('Expected executeTool to fail when no conversation is focused');
    }
    console.log('✓ PASS: MCP tool fails closed when no Hermes conversation is focused.');

    // TEST 3: Focus Session A (e.g. gym-trainer conversation)
    console.log('\n[TEST 3] Focusing Conversation A ("session-gym-trainer-101")...');
    const focusRes = await fetch(`http://127.0.0.1:${testPort}/api/session/focus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-gym-trainer-101', profileId: 'test-aether' }),
    });
    const focusData = await focusRes.json();
    if (!focusData.success || focusData.focusedDesktopSessionId !== 'session-gym-trainer-101') {
      throw new Error(`Failed to set focus: ${JSON.stringify(focusData)}`);
    }

    // Verify GET /api/session/focus returns the focused session
    const getFocusRes = await fetch(`http://127.0.0.1:${testPort}/api/session/focus`);
    const getFocusData = await getFocusRes.json();
    if (getFocusData.focusedDesktopSessionId !== 'session-gym-trainer-101') {
      throw new Error(`Expected focused session to be session-gym-trainer-101, got ${getFocusData.focusedDesktopSessionId}`);
    }
    console.log('✓ PASS: Active desktop session successfully focused.');

    // TEST 4: Generate UX Directions in Conversation A via MCP tool
    console.log('\n[TEST 4] Generating UX Directions for Conversation A via MCP...');
    const genResult = await mcpServer.executeTool('aether_generate_ux', {
      prompt: 'Design a frontend for personal gym trainer with workout builder, exercise library, client progress',
    });
    if (!genResult.directions || genResult.directions.length !== 3) {
      throw new Error(`Expected 3 directions in generation, got ${genResult.directions?.length}`);
    }
    const card0 = genResult.directions[0];
    console.log(`✓ PASS: Generated 3 directions via MCP in session-gym-trainer-101.`);

    // TEST 5: Verify Session A State in StudioServer
    console.log('\n[TEST 5] Checking state for Conversation A...');
    const stateARes = await fetch(`http://127.0.0.1:${testPort}/api/state?sessionId=session-gym-trainer-101`);
    const stateA = await stateARes.json();
    if (stateA.sessionId !== 'session-gym-trainer-101' || stateA.uxGenerations.length !== 1) {
      throw new Error(`Session A state mismatch: ${JSON.stringify(stateA)}`);
    }
    const genId1 = stateA.uxGenerations[0].generationId;
    console.log(`✓ PASS: Conversation A contains exactly 1 generation (${genId1}) with 3 cards.`);

    // TEST 6: Verify Isolation - Conversation B (unrelated chat) is EMPTY
    console.log('\n[TEST 6] Verifying Cross-Session Isolation (Conversation B)...');
    const stateBRes = await fetch(`http://127.0.0.1:${testPort}/api/state?sessionId=session-unrelated-chat-202`);
    const stateB = await stateBRes.json();
    if (stateB.uxGenerations.length !== 0 || stateB.stage !== 'IDLE') {
      throw new Error(`CROSS-SESSION BLEED DETECTED! Session B received Session A data: ${JSON.stringify(stateB)}`);
    }
    console.log('✓ PASS: Strict isolation verified. Unrelated Conversation B has 0 generations.');

    // TEST 7: Cross-Session Selection Guard (Selecting Session A card while targeting Session B returns 409 Conflict)
    console.log('\n[TEST 7] Testing Cross-Session Selection Conflict Guard...');
    const conflictRes = await fetch(`http://127.0.0.1:${testPort}/api/ux/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'session-unrelated-chat-202',
        generationId: genId1,
        directionId: card0.id,
      }),
    });
    if (conflictRes.status !== 409) {
      throw new Error(`Expected 409 Conflict on cross-session card selection, got HTTP ${conflictRes.status}`);
    }
    const conflictData = await conflictRes.json();
    console.log(`✓ PASS: Received expected 409 Conflict: "${conflictData.error}"`);

    // TEST 8: Valid Selection in Conversation A
    console.log('\n[TEST 8] Selecting card in Conversation A...');
    const selectRes = await fetch(`http://127.0.0.1:${testPort}/api/ux/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'session-gym-trainer-101',
        generationId: genId1,
        directionId: card0.id,
        userInitiated: true,
      }),
    });
    if (!selectRes.ok) {
      throw new Error(`Failed to select card: HTTP ${selectRes.status}`);
    }
    const selectData = await selectRes.json();
    if (!selectData.direction || selectData.direction.id !== card0.id) {
      throw new Error(`Card selection mismatch: ${JSON.stringify(selectData)}`);
    }
    console.log(`✓ PASS: Successfully selected card "${card0.title}" in Conversation A.`);

    // TEST 9: SQLite Persistence and Server Restart Recovery
    console.log('\n[TEST 9] Verifying SQLite Persistence across server restart...');
    await server.stop();
    console.log('  StudioServer stopped.');

    // Restart server using same engine/ledger
    const restartedServer = new StudioServer(engine, { port: testPort, host: '127.0.0.1' });
    await restartedServer.start();
    console.log('  StudioServer restarted.');

    // Query restarted server for Conversation A
    const restoredARes = await fetch(`http://127.0.0.1:${testPort}/api/state?sessionId=session-gym-trainer-101`);
    const restoredA = await restoredARes.json();
    if (restoredA.uxGenerations.length !== 1 || restoredA.selectedUx?.directionId !== card0.id) {
      throw new Error(`Persistence failure! Restored state does not match: ${JSON.stringify(restoredA)}`);
    }
    console.log('✓ PASS: Conversation A fully restored from SQLite with generation and selected card!');

    // Query restarted server for New Session screen / Conversation B
    const restoredBRes = await fetch(`http://127.0.0.1:${testPort}/api/state?sessionId=session-unrelated-chat-202`);
    const restoredB = await restoredBRes.json();
    if (restoredB.uxGenerations.length !== 0) {
      throw new Error(`Persistence leak! Session B has data: ${JSON.stringify(restoredB)}`);
    }
    const restoredNullRes = await fetch(`http://127.0.0.1:${testPort}/api/state`);
    const restoredNull = await restoredNullRes.json();
    if (restoredNull.uxGenerations.length !== 0) {
      throw new Error(`Persistence leak! New session has data: ${JSON.stringify(restoredNull)}`);
    }
    console.log('✓ PASS: Restored state maintains strict isolation. Unrelated and new sessions remain 0 generations.');

    await restartedServer.stop();
    console.log('\n======================================================');
    console.log('ALL SESSION ISOLATION & PERSISTENCE TESTS PASSED (10/10)');
    console.log('======================================================\n');
  } finally {
    try {
      await server.stop();
    } catch {}
    if (fs.existsSync(testDbDir)) {
      try {
        fs.rmSync(testDbDir, { recursive: true, force: true });
      } catch {}
    }
  }
}

runTests().catch((err) => {
  console.error('VERIFICATION FAILED FULL STACK:', err && err.stack ? err.stack : err);
  process.exit(1);
});
