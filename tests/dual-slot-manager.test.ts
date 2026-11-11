import { test, describe, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import {
  DualSlotManager,
  StateLedger,
} from '../src/index';

describe('Module 2 Requirement 2: Dual-Slot Preview Manager (Slot A vs Slot B)', () => {
  let testHostDir: string;

  beforeEach(() => {
    testHostDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dual-slot-test-'));
  });

  afterEach(() => {
    if (testHostDir && fs.existsSync(testHostDir)) {
      try {
        fs.rmSync(testHostDir, { recursive: true, force: true });
      } catch {
        // ignore tmp cleanup error
      }
    }
  });

  test('Initializes Slot A (Verified Build) and Slot B (Candidate Sandbox) in parity', async () => {
    fs.mkdirSync(testHostDir, { recursive: true });
    const manager = new DualSlotManager({
      baseHostDir: testHostDir,
      slotAPort: 5180,
      slotBPort: 5181,
    });

    await manager.initialize(true);

    const slotA = manager.getSlotState('SLOT_A');
    const slotB = manager.getSlotState('SLOT_B');

    assert.strictEqual(slotA.name, 'Last Verified Build');
    assert.strictEqual(slotB.name, 'Candidate Sandbox');
    assert.strictEqual(slotA.merkleRoot, slotB.merkleRoot); // In parity initially
    assert.strictEqual(slotA.port, 5180);
    assert.strictEqual(slotB.port, 5181);

    const comparison = manager.getSlotComparison();
    assert.strictEqual(comparison.hasDivergence, false);
    assert.strictEqual(comparison.divergentFilesCount, 0);
  });

  test('Applying candidate edit mutates Slot B only, leaving Slot A untouched', async () => {
    fs.mkdirSync(testHostDir, { recursive: true });
    const manager = new DualSlotManager({
      baseHostDir: testHostDir,
      slotAPort: 5182,
      slotBPort: 5183,
    });

    await manager.initialize(true);

    // Apply visual edit to Slot B
    const editedAppCode = `
export default function App() {
  return <div style={{ color: 'blue' }}>Candidate Visual Update</div>;
}
    `;
    manager.applyCandidateEdit('src/App.tsx', editedAppCode);

    const slotA = manager.getSlotState('SLOT_A');
    const slotB = manager.getSlotState('SLOT_B');

    // Invariant: Slot A and Slot B have diverged
    assert.notStrictEqual(slotA.merkleRoot, slotB.merkleRoot);

    // Slot A retains previous code
    const slotACode = manager.getSlotAWorktree().readFile('src/App.tsx');
    assert.strictEqual(slotACode.includes('Aether UI Preview Canvas'), true);
    assert.strictEqual(slotACode.includes('Candidate Visual Update'), false);

    // Slot B contains the candidate code
    const slotBCode = manager.getSlotBWorktree().readFile('src/App.tsx');
    assert.strictEqual(slotBCode.includes('Candidate Visual Update'), true);

    // Verify comparison report
    const comparison = manager.getSlotComparison();
    assert.strictEqual(comparison.hasDivergence, true);
    assert.strictEqual(comparison.modifiedFiles.length, 1);
    assert.strictEqual(comparison.modifiedFiles[0], 'src/App.tsx');
  });

  test('Rollback Candidate resets Slot B to match Slot A verified baseline', async () => {
    fs.mkdirSync(testHostDir, { recursive: true });
    const manager = new DualSlotManager({
      baseHostDir: testHostDir,
      slotAPort: 5184,
      slotBPort: 5185,
    });

    await manager.initialize(true);

    manager.applyCandidateEdit('src/Card.tsx', 'export const Card = () => <div>Experimental</div>;');
    assert.strictEqual(manager.getSlotComparison().hasDivergence, true);

    // Rollback
    manager.rollbackCandidate();

    const comparisonAfterRollback = manager.getSlotComparison();
    assert.strictEqual(comparisonAfterRollback.hasDivergence, false);
    assert.strictEqual(manager.getSlotBWorktree().existsFile('src/Card.tsx'), false);
  });

  test('Promotion of Candidate promotes Slot B to Slot A and records Checkpoint in SQLite', async () => {
    fs.mkdirSync(testHostDir, { recursive: true });
    const ledger = new StateLedger(':memory:');
    const manager = new DualSlotManager({
      baseHostDir: testHostDir,
      slotAPort: 5186,
      slotBPort: 5187,
      ledger,
    });

    await manager.initialize(true);

    // Apply approved edit in candidate
    manager.applyCandidateEdit('src/Badge.tsx', 'export const Badge = () => <span>Approved</span>;');
    const candidateRoot = manager.getSlotState('SLOT_B').merkleRoot;

    // Promote
    const chk = manager.promoteCandidateToVerified('Approved Badge component addition');

    assert.ok(chk);
    assert.strictEqual(chk?.message, 'Approved Badge component addition');
    assert.strictEqual(chk?.merkleRoot, candidateRoot);

    // Now Slot A has the updated Merkle root and contains Badge.tsx
    const slotA = manager.getSlotState('SLOT_A');
    assert.strictEqual(slotA.merkleRoot, candidateRoot);
    assert.strictEqual(manager.getSlotAWorktree().existsFile('src/Badge.tsx'), true);

    // Verification in SQLite
    const savedChk = ledger.checkpoints.findById(chk!.id);
    assert.ok(savedChk);
    assert.strictEqual(savedChk?.merkleRoot, candidateRoot);

    ledger.close();
  });
});
