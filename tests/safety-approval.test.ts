import { test, describe, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { StateLedger } from '../src/ledger/ledger';
import { DualSlotManager } from '../src/sandbox/dual-slot-manager';
import {
  ApprovalGate,
  ApprovalDeniedError,
  ElevatedConfirmationRequiredError,
  StaleHostConflictError,
} from '../src/safety/approval/approval-gate';

describe('Module 5 Requirement 1: Implementation Approval Gate (FR-19 & BR-08)', () => {
  const testBaseDir = path.resolve('.tmp_test_approval_gate');
  const hostDir = path.join(testBaseDir, 'host');
  const sandboxDir = path.join(testBaseDir, 'sandbox');

  let ledger: StateLedger;
  let slotManager: DualSlotManager;

  beforeEach(async () => {
    if (fs.existsSync(testBaseDir)) {
      fs.rmSync(testBaseDir, { recursive: true, force: true });
    }
    fs.mkdirSync(hostDir, { recursive: true });

    // Set up mock host files
    fs.writeFileSync(
      path.join(hostDir, 'package.json'),
      JSON.stringify({ name: 'my-app', dependencies: { react: '^18.0.0' } }, null, 2)
    );
    fs.writeFileSync(
      path.join(hostDir, 'Button.tsx'),
      `export const Button = () => <button data-aether-uid="btn">Click</button>;`
    );
    fs.writeFileSync(
      path.join(hostDir, 'PageA.tsx'),
      `import { Button } from './Button';\nexport const PageA = () => <div><Button /></div>;`
    );
    fs.writeFileSync(
      path.join(hostDir, 'PageB.tsx'),
      `import { Button } from './Button';\nexport const PageB = () => <div><Button /></div>;`
    );

    ledger = new StateLedger(':memory:');
    slotManager = new DualSlotManager({
      baseHostDir: hostDir,
      sandboxRootDir: sandboxDir,
      ledger,
    });

    await slotManager.initialize(false);

    // Mirror host files into Slot A and Slot B
    slotManager.getSlotAWorktree().mirrorFromHost(['package.json', 'Button.tsx', 'PageA.tsx', 'PageB.tsx']);
    slotManager.getSlotBWorktree().mirrorFromHost(['package.json', 'Button.tsx', 'PageA.tsx', 'PageB.tsx']);

    // Advance state machine to Preview Ready
    ledger.stateMachine.updateContext({
      hasBrief: true,
      isBriefReady: true,
      selectedUxDirectionId: 'ux-1',
      selectedUiConceptId: 'ui-1',
    });
    ledger.transitionState('Gathering Brief', 'Init');
    ledger.transitionState('UX Review', 'UX Done');
    ledger.transitionState('UI Review', 'UI Done');
    ledger.transitionState('Preview Ready', 'Preview initialized');
  });

  afterEach(async () => {
    await slotManager.stopAll();
    ledger.close();
    if (fs.existsSync(testBaseDir)) {
      fs.rmSync(testBaseDir, { recursive: true, force: true });
    }
  });

  test('Prepares review package with affected files, dependency diff, and blast radius (BR-08)', () => {
    // Apply candidate change to Button.tsx in Slot B
    slotManager.applyCandidateEdit(
      'Button.tsx',
      `export const Button = () => <button data-aether-uid="btn" className="bg-blue-600">Click</button>;`
    );

    // Add a dependency to Slot B package.json
    slotManager.applyCandidateEdit(
      'package.json',
      JSON.stringify(
        { name: 'my-app', dependencies: { react: '^18.0.0', 'clsx': '^2.0.0' } },
        null,
        2
      )
    );

    const gate = new ApprovalGate({
      hostRootDir: hostDir,
      slotManager,
      ledger,
    });

    const review = gate.prepareReviewPackage();

    // Verify affected files
    const modifiedNames = review.affectedFiles.map((f) => f.relativePath);
    assert.ok(modifiedNames.includes('Button.tsx'));
    assert.ok(modifiedNames.includes('package.json'));

    // Verify dependency diff
    assert.strictEqual(review.dependencyChanges.length, 1);
    assert.strictEqual(review.dependencyChanges[0].packageName, 'clsx');
    assert.strictEqual(review.dependencyChanges[0].type, 'added');

    // Verify Shared Component Blast Radius (BR-08)
    // Button is instantiated in PageA and PageB -> count = 2 -> requiresElevatedConfirmation = true
    assert.strictEqual(review.blastRadius.length, 1);
    assert.strictEqual(review.blastRadius[0].componentName, 'Button');
    assert.strictEqual(review.blastRadius[0].consumingFilesCount, 2);
    assert.strictEqual(review.blastRadius[0].requiresElevatedConfirmation, true);
    assert.strictEqual(review.requiresElevatedConfirmation, true);
  });

  test('Blocks promotion without elevated confirmation when blast radius > 1 (BR-08)', () => {
    slotManager.applyCandidateEdit(
      'Button.tsx',
      `export const Button = () => <button data-aether-uid="btn" className="bg-red-500">Click</button>;`
    );

    const gate = new ApprovalGate({
      hostRootDir: hostDir,
      slotManager,
      ledger,
    });

    gate.requestApproval();
    assert.strictEqual(ledger.stateMachine.getState(), 'Implementation Approval');

    // Attempt promotion without confirming blast radius -> must throw ElevatedConfirmationRequiredError
    assert.throws(
      () => {
        gate.approveAndPromote({
          approved: true,
          actor: 'user',
          timestamp: new Date().toISOString(),
          confirmSharedBlastRadius: false, // Omitted confirmation
        });
      },
      ElevatedConfirmationRequiredError
    );

    // Host project and Slot A must remain completely untouched
    const hostButtonContent = fs.readFileSync(path.join(hostDir, 'Button.tsx'), 'utf8');
    assert.strictEqual(hostButtonContent.includes('bg-red-500'), false);
  });

  test('Denial of approval preserves Slot A and Host untouched and transitions back to Preview Ready', () => {
    slotManager.applyCandidateEdit(
      'Button.tsx',
      `export const Button = () => <button data-aether-uid="btn" className="bg-red-500">Click</button>;`
    );

    const gate = new ApprovalGate({
      hostRootDir: hostDir,
      slotManager,
      ledger,
    });

    gate.requestApproval();
    assert.strictEqual(ledger.stateMachine.getState(), 'Implementation Approval');

    // User denies approval
    gate.denyApproval({
      approved: false,
      actor: 'user',
      timestamp: new Date().toISOString(),
      reason: 'Colors look too bright',
    });

    assert.strictEqual(ledger.stateMachine.getState(), 'Preview Ready');

    // Host and Slot A are untouched
    const hostButton = fs.readFileSync(path.join(hostDir, 'Button.tsx'), 'utf8');
    assert.strictEqual(hostButton.includes('bg-red-500'), false);
    const slotAButton = slotManager.getSlotAWorktree().readFile('Button.tsx');
    assert.strictEqual(slotAButton.includes('bg-red-500'), false);
  });

  test('Detects stale host state and blocks promotion until conflict review', () => {
    const gate = new ApprovalGate({
      hostRootDir: hostDir,
      slotManager,
      ledger,
    });

    slotManager.applyCandidateEdit(
      'Button.tsx',
      `export const Button = () => <button data-aether-uid="btn" className="bg-indigo-600">Click</button>;`
    );

    gate.requestApproval();

    // Concurrent host modification happens while candidate was awaiting review!
    fs.writeFileSync(
      path.join(hostDir, 'PageC.tsx'),
      `export const PageC = () => <div>New Host Page</div>;`
    );

    // Attempt promotion -> must detect stale host state
    assert.throws(
      () => {
        gate.approveAndPromote({
          approved: true,
          actor: 'user',
          timestamp: new Date().toISOString(),
          confirmSharedBlastRadius: true,
          forceIfStaleHost: false,
        });
      },
      StaleHostConflictError
    );
  });

  test('Successful approval promotes Slot B to Host and Slot A and records Checkpoint', () => {
    slotManager.applyCandidateEdit(
      'Button.tsx',
      `export const Button = () => <button data-aether-uid="btn" className="bg-emerald-600">Click</button>;`
    );

    const gate = new ApprovalGate({
      hostRootDir: hostDir,
      slotManager,
      ledger,
    });

    gate.requestApproval();

    const result = gate.approveAndPromote({
      approved: true,
      actor: 'user',
      timestamp: new Date().toISOString(),
      confirmSharedBlastRadius: true,
    });

    assert.strictEqual(result.success, true);
    assert.ok(result.checkpointId);

    // Verify Host project received the approved changes
    const hostButton = fs.readFileSync(path.join(hostDir, 'Button.tsx'), 'utf8');
    assert.ok(hostButton.includes('bg-emerald-600'));

    // Verify Slot A is now in sync with Slot B
    const slotAButton = slotManager.getSlotAWorktree().readFile('Button.tsx');
    assert.ok(slotAButton.includes('bg-emerald-600'));

    // Verify state machine transitioned to Building
    assert.strictEqual(ledger.stateMachine.getState(), 'Building');
  });
});
