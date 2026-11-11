import { test, describe, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  DualSlotManager,
  EditTransactionManager,
  QuarantineRegistry,
  FiberBridgeServer,
  MockFiberClient,
  StateLedger,
} from '../src/index';

describe('[INTEGRATION TESTS] Module 3: EditTx Engine & Sandbox Integration', () => {
  const testHostDir = path.join(process.cwd(), '.tmp_test_edittx_host');
  let bridgeServer: FiberBridgeServer | null = null;
  let mockBrowser: MockFiberClient | null = null;

  afterEach(async () => {
    if (mockBrowser) {
      mockBrowser.disconnect();
      mockBrowser = null;
    }
    if (bridgeServer) {
      await bridgeServer.stop();
      bridgeServer = null;
    }
    if (fs.existsSync(testHostDir)) {
      fs.rmSync(testHostDir, { recursive: true, force: true });
    }
  });

  test('E2E: Successful Tier 1 edit committed to Slot B; Slot A & Host are completely untouched', async () => {
    fs.mkdirSync(testHostDir, { recursive: true });
    const manager = new DualSlotManager({
      baseHostDir: testHostDir,
      slotAPort: 5200,
      slotBPort: 5201,
    });
    await manager.initialize(true);

    // Initial content in Slot A & Slot B
    const initialAppCode = `
import React from 'react';
export default function App() {
  return (
    <div>
      <h1 data-aether-uid="title-node">Original Title</h1>
    </div>
  );
}
    `;
    manager.getSlotAWorktree().writeCandidateFile('src/App.tsx', initialAppCode);
    manager.getSlotBWorktree().writeCandidateFile('src/App.tsx', initialAppCode);

    const slotAInitialRoot = manager.getSlotState('SLOT_A').merkleRoot;
    const baseRevision = manager.getSlotState('SLOT_B').merkleRoot;

    const txManager = new EditTransactionManager({
      dualSlotManager: manager,
    });

    // Execute Tier 1 Edit Transaction on Slot B
    const txRecord = await txManager.executeTransaction({
      targetUid: 'title-node',
      filePath: 'src/App.tsx',
      baseRevision,
      mutations: [
        {
          type: 'UPDATE_TEXT',
          targetUid: 'title-node',
          propertyGroup: 'content',
          newText: 'Updated Live Title',
        },
      ],
    });

    assert.strictEqual(txRecord.status, 'COMMITTED');
    assert.strictEqual(txRecord.tier, 'TIER_1_DETERMINISTIC');

    // Invariant Check 1: Slot B contains the updated code
    const slotBCode = manager.getSlotBWorktree().readFile('src/App.tsx');
    assert.ok(slotBCode.includes('Updated Live Title'));

    // Invariant Check 2: Slot A (Last Verified Build) is 100% UNTOUCHED
    const slotACode = manager.getSlotAWorktree().readFile('src/App.tsx');
    assert.ok(slotACode.includes('Original Title'));
    assert.strictEqual(slotACode.includes('Updated Live Title'), false);
    assert.strictEqual(manager.getSlotState('SLOT_A').merkleRoot, slotAInitialRoot);

    // Invariant Check 3: Host project files are 100% untouched
    assert.strictEqual(fs.existsSync(path.join(testHostDir, 'src', 'App.tsx')), false);
  });

  test('E2E: Full Fiber Bridge WebSocket handshake verifies DOM update during EditTx', async () => {
    fs.mkdirSync(testHostDir, { recursive: true });
    const manager = new DualSlotManager({
      baseHostDir: testHostDir,
      slotAPort: 5202,
      slotBPort: 5203,
    });
    await manager.initialize(true);

    const initialCode = `
import React from 'react';
export default function App() {
  return <button data-aether-uid="btn-act" className="btn-base">Click</button>;
}
    `;
    manager.getSlotAWorktree().writeCandidateFile('src/App.tsx', initialCode);
    manager.getSlotBWorktree().writeCandidateFile('src/App.tsx', initialCode);
    const baseRevision = manager.getSlotState('SLOT_B').merkleRoot;

    // Start real WebSocket Bridge
    bridgeServer = new FiberBridgeServer({ port: 6390 });
    await bridgeServer.start();

    // Connect mock browser client
    mockBrowser = new MockFiberClient(bridgeServer.getWsUrl());
    await mockBrowser.connect();

    mockBrowser.registerDomElement({
      uid: 'btn-act',
      tagName: 'button',
      textContent: 'Click',
      attributes: {
        'data-aether-uid': 'btn-act',
        className: 'btn-base p-4',
      },
    });

    const txManager = new EditTransactionManager({
      dualSlotManager: manager,
      bridgeServer,
    });

    // Run transaction with live HMR ACK
    const txPromise = txManager.executeTransaction({
      targetUid: 'btn-act',
      filePath: 'src/App.tsx',
      baseRevision,
      awaitHmrAck: true,
      mutations: [
        {
          type: 'MERGE_CLASSNAMES',
          targetUid: 'btn-act',
          propertyGroup: 'spacing',
          classesToAdd: 'p-4',
        },
      ],
    });

    // Browser responds to vite:afterUpdate event
    setTimeout(() => {
      const activeTxs = txManager.getAllTransactions();
      if (activeTxs.length > 0) {
        mockBrowser?.simulateViteAfterUpdate(activeTxs[0].id);
      }
    }, 20);

    const txRecord = await txPromise;
    assert.strictEqual(txRecord.status, 'COMMITTED');
    assert.strictEqual(txRecord.validation.passed, true);
    assert.ok(txRecord.validation.hmrHandshake?.verified);
  });

  test('Rejection: Quarantined duplicate UID is rejected immediately (Zero Auto-Resolution)', async () => {
    fs.mkdirSync(testHostDir, { recursive: true });
    const manager = new DualSlotManager({
      baseHostDir: testHostDir,
    });
    await manager.initialize(true);

    const quarantineRegistry = new QuarantineRegistry();
    quarantineRegistry.quarantine(
      'dupe-uid',
      [
        { filePath: 'src/A.tsx', tagName: 'button', componentScopeName: 'A', range: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 10, offset: 9 } } },
        { filePath: 'src/B.tsx', tagName: 'a', componentScopeName: 'B', range: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 10, offset: 9 } } },
      ],
      'Collision quarantine'
    );

    const txManager = new EditTransactionManager({
      dualSlotManager: manager,
      quarantineRegistry,
    });

    const txRecord = await txManager.executeTransaction({
      targetUid: 'dupe-uid',
      filePath: 'src/App.tsx',
      baseRevision: 'rev-0',
      mutations: [{ type: 'UPDATE_TEXT', targetUid: 'dupe-uid', propertyGroup: 'content', newText: 'X' }],
    });

    assert.strictEqual(txRecord.status, 'REJECTED');
    assert.ok(txRecord.error?.includes('quarantined due to ambiguous collision'));
  });

  test('E2E: Atomic Rollback on validation failure preserves Slot B and Slot A cleanly', async () => {
    fs.mkdirSync(testHostDir, { recursive: true });
    const manager = new DualSlotManager({
      baseHostDir: testHostDir,
    });
    await manager.initialize(true);

    const pristineCode = `
import React from 'react';
export default function App() {
  return <div data-aether-uid="container">Pristine Content</div>;
}
    `;
    manager.getSlotBWorktree().writeCandidateFile('src/App.tsx', pristineCode);
    manager.getSlotAWorktree().writeCandidateFile('src/App.tsx', pristineCode);

    const baseRevision = manager.getSlotState('SLOT_B').merkleRoot;
    const txManager = new EditTransactionManager({ dualSlotManager: manager });

    // Execute Tier 2 mutation that triggers a Critical Viewport Overflow violation
    const txRecord = await txManager.executeTransaction({
      targetUid: 'container',
      filePath: 'src/App.tsx',
      baseRevision,
      scope: 'COMPONENT',
      mutations: [
        {
          type: 'REPLACE_SUBTREE',
          targetUid: 'container',
          propertyGroup: 'layout',
          newSubtreeJsx: `<div style={{ width: '800px' }}>Excessive Width</div>`,
        },
      ],
      elementLayoutMetrics: [
        {
          uid: 'container',
          tagName: 'div',
          width: 800, // 800px on 375px mobile triggers CRITICAL HORIZONTAL_OVERFLOW
          height: 100,
        },
      ],
    });

    // Invariant: Validation fails and transaction is ROLLED_BACK
    assert.strictEqual(txRecord.status, 'ROLLED_BACK');
    assert.ok(txRecord.error?.includes('Viewport Probe critical violation'));

    // Invariant: Slot B was atomically restored to pristine state
    const currentSlotBCode = manager.getSlotBWorktree().readFile('src/App.tsx');
    assert.ok(currentSlotBCode.includes('Pristine Content'));
    assert.strictEqual(currentSlotBCode.includes('Excessive Width'), false);

    // Invariant: Slot A remains untouched
    const currentSlotACode = manager.getSlotAWorktree().readFile('src/App.tsx');
    assert.ok(currentSlotACode.includes('Pristine Content'));
  });

  test('E2E: Stale Host Change triggers Conflict state without silently overwriting', async () => {
    fs.mkdirSync(testHostDir, { recursive: true });
    const ledger = new StateLedger(':memory:');
    const manager = new DualSlotManager({
      baseHostDir: testHostDir,
      ledger,
    });
    await manager.initialize(true);

    const baseCode = `
import React from 'react';
export default function App() {
  return (
    <div>
      {isUserLoggedIn && <button data-aether-uid="btn-act">Action</button>}
    </div>
  );
}
    `;
    manager.getSlotBWorktree().writeCandidateFile('src/App.tsx', baseCode);
    const staleBaseRevision = manager.getSlotState('SLOT_B').merkleRoot;

    // Simulate host advancing concurrently and changing the conditional ancestor
    const advancedHostCode = `
import React from 'react';
export default function App() {
  return (
    <div>
      {hasAdminPermission && <button data-aether-uid="btn-act">Action</button>}
    </div>
  );
}
    `;
    manager.getSlotAWorktree().writeCandidateFile('src/App.tsx', advancedHostCode);

    const txManager = new EditTransactionManager({
      dualSlotManager: manager,
      ledger,
    });

    const txRecord = await txManager.executeTransaction({
      targetUid: 'btn-act',
      filePath: 'src/App.tsx',
      baseRevision: staleBaseRevision, // Stale base revision!
      mutations: [
        {
          type: 'UPDATE_TEXT',
          targetUid: 'btn-act',
          propertyGroup: 'content',
          newText: 'Stale Action Edit',
        },
      ],
    });

    assert.strictEqual(txRecord.status, 'CONFLICT');
    assert.ok(txRecord.error?.includes('Concurrent host change detected'));

    ledger.close();
  });
});
