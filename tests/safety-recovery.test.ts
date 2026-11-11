import { test, describe, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { StateLedger } from '../src/ledger/ledger';
import {
  DualLevelRecoveryManager,
  CorruptedCheckpointError,
} from '../src/safety/recovery/dual-level-recovery';
import { ShadowWorktree } from '../src/sandbox/shadow-worktree';

describe('Module 5 Requirement 3: Dual-Level Checkpoint Recovery System', () => {
  const testBaseDir = path.resolve('.tmp_test_recovery');
  const hostDir = path.join(testBaseDir, 'host');
  const sandboxDir = path.join(testBaseDir, 'sandbox');

  let ledger: StateLedger;
  let recovery: DualLevelRecoveryManager;

  beforeEach(() => {
    if (fs.existsSync(testBaseDir)) {
      fs.rmSync(testBaseDir, { recursive: true, force: true });
    }
    fs.mkdirSync(hostDir, { recursive: true });
    ledger = new StateLedger(':memory:');
    recovery = new DualLevelRecoveryManager(testBaseDir, ledger);
  });

  afterEach(() => {
    ledger.close();
    if (fs.existsSync(testBaseDir)) {
      fs.rmSync(testBaseDir, { recursive: true, force: true });
    }
  });

  test('Level 1: Captures and recovers static Visual Snapshot (dist_snapshot/) without executing code', () => {
    const checkpointId = 'chk-visual-101';
    const mockHtml = '<!DOCTYPE html><html><body><div id="root"><h1>Static Preview</h1></div></body></html>';
    const mockCss = 'body { font-family: sans-serif; background: #f8fafc; }';

    const snapshot = recovery.captureVisualSnapshot(checkpointId, {
      indexHtml: mockHtml,
      stylesCss: mockCss,
      domStructureSnippet: '<div id="root"><h1>Static Preview</h1></div>',
      metadata: { viewport: 'desktop', theme: 'light' },
    });

    assert.strictEqual(snapshot.checkpointId, checkpointId);
    assert.ok(fs.existsSync(snapshot.snapshotDir));

    // Recover static snapshot
    const recovered = recovery.recoverVisualSnapshot(checkpointId);
    assert.strictEqual(recovered.indexHtml, mockHtml);
    assert.strictEqual(recovered.stylesCss, mockCss);
    assert.strictEqual(recovered.domStructureSnippet, '<div id="root"><h1>Static Preview</h1></div>');
  });

  test('Level 2: Recovers verified runnable source tree with Merkle integrity verification', () => {
    const files = [
      { relativePath: 'package.json', content: JSON.stringify({ name: 'runnable-app' }) },
      { relativePath: 'src/App.tsx', content: 'export default () => <div>Hello World</div>;' },
    ];

    // Create checkpoint in StateLedger
    const checkpoint = ledger.createCheckpoint({
      message: 'Verified runnable checkpoint',
      files,
    });

    // Persist source files in recovery store
    recovery.persistSourceFiles(checkpoint.id, files);

    // Prepare target worktree
    const targetWorktree = new ShadowWorktree(hostDir, sandboxDir, 'target-slot');

    // Perform runnable source tree checkout
    const result = recovery.recoverRunnableSourceTree(checkpoint.id, targetWorktree);

    assert.strictEqual(result.verifiedIntegrity, true);
    assert.strictEqual(result.filesRestoredCount, 2);
    assert.strictEqual(result.merkleRoot, checkpoint.merkleRoot);

    // Verify restored files in worktree
    assert.strictEqual(targetWorktree.readFile('package.json'), files[0].content);
    assert.strictEqual(targetWorktree.readFile('src/App.tsx'), files[1].content);
  });

  test('Integrity Violation: Detects corrupted/tampered checkpoint and aborts restoration', () => {
    const files = [
      { relativePath: 'src/Security.tsx', content: 'export const Safe = true;' },
    ];

    const checkpoint = ledger.createCheckpoint({
      message: 'Tamper detection test',
      files,
    });

    recovery.persistSourceFiles(checkpoint.id, files);

    // Simulate disk/archive corruption or malicious tampering: alter stored source file
    const storedFilePath = path.join(testBaseDir, '.aether', 'recovery', 'sources', checkpoint.id, 'src/Security.tsx');
    fs.writeFileSync(storedFilePath, 'export const Safe = false; // TAMPERED');

    const targetWorktree = new ShadowWorktree(hostDir, sandboxDir, 'target-corrupted-slot');

    // Attempting recovery must throw CorruptedCheckpointError
    assert.throws(
      () => {
        recovery.recoverRunnableSourceTree(checkpoint.id, targetWorktree);
      },
      CorruptedCheckpointError
    );
  });
});
