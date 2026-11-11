const { AetherEngine } = require('../dist/engine/aether-engine.js');
const { StudioServer } = require('../dist/server/studio-server.js');
const assert = require('node:assert');

async function testPhase1() {
  console.log('--- TESTING PHASE 1 BACKEND LEDGER & TOOL CONTRACTS ---');

  const engine = new AetherEngine({ hostRootDir: process.cwd(), mode: 'mock_http' });
  await engine.initialize(true);

  const server = new StudioServer(engine, { port: 4173 });
  await server.start();
  const baseUrl = 'http://127.0.0.1:4173';

  try {
    const sessionId = 'test-session-gym';

    // 1. Initial state has 0 generations
    console.log('1. Checking initial state...');
    const initRes = await fetch(`${baseUrl}/api/state?sessionId=${sessionId}`).then(r => r.json());
    assert.strictEqual(initRes.uxGenerations.length, 0, 'Initial uxGenerations must be empty');
    assert.strictEqual(initRes.selectedUx, null, 'Initial selectedUx must be null');
    console.log('   ✓ Initial state clean (0 generations, null selectedUx)');

    // 2. Generation 1
    console.log('2. Generating UX Generation 1...');
    const gen1Res = await fetch(`${baseUrl}/api/ux/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        promptSummary: 'Gym trainer workout and client tracking platform',
      }),
    }).then(r => r.json());

    assert.strictEqual(gen1Res.success, true);
    assert.strictEqual(gen1Res.generation.generationNumber, 1);
    assert.strictEqual(gen1Res.generation.directions.length, 3);
    assert.strictEqual(gen1Res.uxGenerations.length, 1);
    console.log('   ✓ Generation 1 created with 3 cards:', gen1Res.generation.directions.map(d => d.title));

    // Verify state endpoint reflects Gen 1
    const stateGen1 = await fetch(`${baseUrl}/api/state?sessionId=${sessionId}`).then(r => r.json());
    assert.strictEqual(stateGen1.uxGenerations.length, 1);
    assert.strictEqual(stateGen1.uxGenerations[0].generationNumber, 1);
    console.log('   ✓ GET /api/state reflects Generation 1');

    // 3. Generation 2 (Refinement: "Focus on 1-tap mid-workout set logging")
    console.log('3. Appending Generation 2 (Refinement)...');
    const gen2Res = await fetch(`${baseUrl}/api/ux/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        refinement: 'Focus on 1-tap mid-workout set logging',
      }),
    }).then(r => r.json());

    assert.strictEqual(gen2Res.success, true);
    assert.strictEqual(gen2Res.generation.generationNumber, 2);
    assert.strictEqual(gen2Res.uxGenerations.length, 2);
    // Generation 1 MUST still be preserved!
    assert.strictEqual(gen2Res.uxGenerations[0].generationNumber, 1);
    assert.strictEqual(gen2Res.uxGenerations[1].generationNumber, 2);
    console.log('   ✓ Generation 2 appended! Total generations =', gen2Res.uxGenerations.length);
    console.log('   ✓ Gen 1 preserved:', gen2Res.uxGenerations[0].directions.map(d => d.title));
    console.log('   ✓ Gen 2 cards:', gen2Res.uxGenerations[1].directions.map(d => d.title));

    // 4. Select Card from Gen 1
    console.log('4. Selecting card from Generation 1 ("ux_gen1_dir1")...');
    const selGen1Res = await fetch(`${baseUrl}/api/ux/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        directionId: 'ux_gen1_dir1',
      }),
    }).then(r => r.json());
    assert.strictEqual(selGen1Res.success, true);
    assert.strictEqual(selGen1Res.selectedUx.directionId, 'ux_gen1_dir1');
    console.log('   ✓ Selected Gen 1 card successfully:', selGen1Res.selectedUx);

    // 5. Select Card from Gen 2 using generation-dot-index ("2.1")
    console.log('5. Selecting card from Generation 2 via dot-index ("2.1")...');
    const selGen2Res = await fetch(`${baseUrl}/api/ux/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        directionId: '2.1',
      }),
    }).then(r => r.json());
    assert.strictEqual(selGen2Res.success, true);
    assert.strictEqual(selGen2Res.selectedUx.directionId, 'ux_gen2_dir1');
    assert.strictEqual(selGen2Res.direction.title, '1-Tap Rapid Logger');
    console.log('   ✓ Selected Gen 2 card via "2.1":', selGen2Res.direction.title);

    // 6. Select Card using case-insensitive title substring ("Timer")
    console.log('6. Selecting card via title substring ("Timer")...');
    const selTitleRes = await fetch(`${baseUrl}/api/ux/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        directionId: 'Timer',
      }),
    }).then(r => r.json());
    assert.strictEqual(selTitleRes.success, true);
    assert.strictEqual(selTitleRes.direction.title, 'Heads-Up Rest Timer Deck');
    console.log('   ✓ Selected card via substring "Timer":', selTitleRes.direction.title);

    // 7. Invalid ID Guard ("ux_invalid_999")
    console.log('7. Testing invalid ID guard ("ux_invalid_999")...');
    const invalidRes = await fetch(`${baseUrl}/api/ux/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        directionId: 'ux_invalid_999',
      }),
    });
    assert.strictEqual(invalidRes.status, 400);
    const invalidData = await invalidRes.json();
    assert.strictEqual(invalidData.success, false);
    assert.strictEqual(invalidData.isError, true);
    assert.ok(invalidData.error.includes('ux_invalid_999'));
    assert.ok(Array.isArray(invalidData.validOptions));
    assert.strictEqual(invalidData.validOptions.length, 6); // 3 from Gen 1 + 3 from Gen 2
    console.log('   ✓ Invalid ID returned isError: true with 6 validOptions:');
    invalidData.validOptions.forEach(opt => {
      console.log(`     - [${opt.selector}] ${opt.directionId}: ${opt.title} (Gen ${opt.generationNumber})`);
    });

    console.log('\n--- ALL PHASE 1 BACKEND LEDGER TESTS PASSED ---');
  } finally {
    await server.stop();
  }
}

testPhase1().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
