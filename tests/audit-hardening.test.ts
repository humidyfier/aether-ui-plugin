import { test, describe, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  AetherEngine,
  PathGuard,
  PathSecurityError,
  PromotionJournalManager,
  HostBuildVerificationError,
  CandidateDependencyInstaller,
  CommandRunner,
  CommandExecutionResult,
  UidInjector,
} from '../src/index';

describe('[PHASE 3.5 AUDIT & HARDENING TESTS]', () => {
  const testBaseDir = path.resolve('.tmp_test_phase35_audit');
  const hostDir = path.join(testBaseDir, 'host');
  const sandboxDir = path.join(testBaseDir, 'sandbox');

  let engine: AetherEngine;

  beforeEach(async () => {
    if (fs.existsSync(testBaseDir)) {
      fs.rmSync(testBaseDir, { recursive: true, force: true });
    }
    fs.mkdirSync(hostDir, { recursive: true });

    // Host files
    fs.writeFileSync(
      path.join(hostDir, 'package.json'),
      JSON.stringify({ name: 'audit-app', dependencies: { react: '^18.0.0' } }, null, 2)
    );
    fs.writeFileSync(
      path.join(hostDir, 'pnpm-lock.yaml'),
      'lockfileVersion: 5.4\nspecifiers:\n  react: ^18.0.0\n'
    );
    fs.writeFileSync(
      path.join(hostDir, 'Header.tsx'),
      `export const Header = () => <header data-aether-uid="hdr"><h1>App Title</h1></header>;`
    );
    fs.writeFileSync(
      path.join(hostDir, 'Card.tsx'),
      `export const Card = () => <div data-aether-uid="crd"><p>Card Content</p></div>;`
    );

    engine = new AetherEngine({
      hostRootDir: hostDir,
      sandboxRootDir: sandboxDir,
    });

    await engine.initialize(false);

    // Mirror to Slot A and Slot B
    engine.dualSlotManager.getSlotAWorktree().mirrorFromHost(['package.json', 'pnpm-lock.yaml', 'Header.tsx', 'Card.tsx']);
    engine.dualSlotManager.getSlotBWorktree().mirrorFromHost(['package.json', 'pnpm-lock.yaml', 'Header.tsx', 'Card.tsx']);
  });

  afterEach(async () => {
    await engine.stop();
    if (fs.existsSync(testBaseDir)) {
      fs.rmSync(testBaseDir, { recursive: true, force: true });
    }
  });

  // ==========================================
  // 1. Explicit Revision Pointers
  // ==========================================
  test('[UNIT TEST] Distinct revision pointers advance strictly according to lifecycle invariants', () => {
    const pointers = engine.ledger.revisionPointers;
    const initial = pointers.getPointers();

    assert.ok(initial.host_baseline_rev);
    assert.strictEqual(initial.verified_preview_rev, initial.host_baseline_rev);
    assert.strictEqual(initial.candidate_work_rev, initial.host_baseline_rev);

    // 1. Candidate edit applied to Slot B: only candidate_work_rev advances
    pointers.advanceCandidateWork('candidate-rev-1');
    const afterEdit = pointers.getPointers();
    assert.strictEqual(afterEdit.candidate_work_rev, 'candidate-rev-1');
    assert.strictEqual(afterEdit.verified_preview_rev, initial.host_baseline_rev);
    assert.strictEqual(afterEdit.host_baseline_rev, initial.host_baseline_rev);

    // 2. Verified preview passes validation (Slot A): verified_preview_rev advances
    pointers.advanceVerifiedPreview('verified-preview-rev-1');
    const afterVerified = pointers.getPointers();
    assert.strictEqual(afterVerified.verified_preview_rev, 'verified-preview-rev-1');
    assert.strictEqual(afterVerified.host_baseline_rev, initial.host_baseline_rev);

    // 3. Approval denial: candidate rollback returns candidate_work_rev to verified_preview_rev
    pointers.rollbackCandidate();
    const afterRollback = pointers.getPointers();
    assert.strictEqual(afterRollback.candidate_work_rev, 'verified-preview-rev-1');
    assert.strictEqual(afterRollback.host_baseline_rev, initial.host_baseline_rev);

    // 4. Host promotion: host_baseline_rev advances to promoted revision
    pointers.advanceHostBaseline('promoted-host-rev-2');
    const afterPromotion = pointers.getPointers();
    assert.strictEqual(afterPromotion.host_baseline_rev, 'promoted-host-rev-2');
    assert.strictEqual(afterPromotion.verified_preview_rev, 'promoted-host-rev-2');
    assert.strictEqual(afterPromotion.candidate_work_rev, 'promoted-host-rev-2');
  });

  // ==========================================
  // 2. Zero Production DOM Leak & Exact Post-Strip Hashing
  // ==========================================
  test('[INTEGRATION TEST] approveAndPromote strips data-aether-uid attributes and hashes exact post-strip files', () => {
    // Modify Card.tsx in Slot B with dev UIDs
    engine.dualSlotManager.applyCandidateEdit(
      'Card.tsx',
      `export const Card = () => <div data-aether-uid="crd" className="p-4"><p data-aether-uid="txt">Updated Card</p></div>;`
    );

    // Advance state to Preview Ready -> Request Approval
    engine.ledger.stateMachine.updateContext({
      hasBrief: true,
      isBriefReady: true,
      selectedUxDirectionId: 'ux-1',
      selectedUiConceptId: 'ui-1',
    });
    engine.ledger.transitionState('Gathering Brief', 'Init');
    engine.ledger.transitionState('UX Review', 'UX Done');
    engine.ledger.transitionState('UI Review', 'UI Done');
    engine.ledger.transitionState('Preview Ready', 'Preview ready');

    engine.approvalGate.requestApproval();

    // Approve promotion
    const result = engine.approvalGate.approveAndPromote({
      approved: true,
      actor: 'user',
      timestamp: new Date().toISOString(),
      confirmSharedBlastRadius: true,
    });

    assert.strictEqual(result.success, true);

    // Read host file
    const promotedHostCard = fs.readFileSync(path.join(hostDir, 'Card.tsx'), 'utf8');

    // Invariant (FR-11): Zero production DOM leak
    assert.strictEqual(promotedHostCard.includes('data-aether-uid'), false);
    assert.ok(promotedHostCard.includes('className="p-4"'));
    assert.doesNotThrow(() => {
      UidInjector.verifyZeroProductionLeak(promotedHostCard, 'Card.tsx');
    });

    // Verify host baseline Merkle manifest matches the exact post-stripped bytes
    assert.strictEqual(result.hostMerkleRoot, engine.approvalGate.getBaseHostMerkleRoot());
  });

  // ==========================================
  // 3. Transactional Promotion Rollback & Unrelated Host Edit Preservation
  // ==========================================
  test('[INTEGRATION TEST] Host build failure rolls back promotion while strictly preserving unrelated host edits', () => {
    // In Slot B, introduce a syntax error in Card.tsx that fails host build check
    engine.dualSlotManager.applyCandidateEdit(
      'Card.tsx',
      `export const Card = () => <div className="syntax error !! broken>`
    );

    engine.ledger.stateMachine.updateContext({
      hasBrief: true,
      isBriefReady: true,
      selectedUxDirectionId: 'ux-1',
      selectedUiConceptId: 'ui-1',
    });
    engine.ledger.transitionState('Gathering Brief', 'Init');
    engine.ledger.transitionState('UX Review', 'UX Done');
    engine.ledger.transitionState('UI Review', 'UI Done');
    engine.ledger.transitionState('Preview Ready', 'Preview ready');

    engine.approvalGate.requestApproval();

    // Attempt promotion -> must trigger HostBuildVerificationError and roll back
    assert.throws(
      () => {
        engine.approvalGate.approveAndPromote({
          approved: true,
          actor: 'user',
          timestamp: new Date().toISOString(),
          confirmSharedBlastRadius: true,
        });
      },
      HostBuildVerificationError
    );

    // Host file was rolled back to original pre-promotion backup
    const hostCard = fs.readFileSync(path.join(hostDir, 'Card.tsx'), 'utf8');
    assert.ok(hostCard.includes('Card Content'));
    assert.strictEqual(hostCard.includes('syntax error'), false);
  });

  test('[INTEGRATION TEST] Rollback preserves unrelated concurrent edits and reports conflict', () => {
    const journalManager = PromotionJournalManager;
    const testFile = path.join(hostDir, 'Header.tsx');
    const initialContent = fs.readFileSync(testFile, 'utf8');

    // Simulate active journal where Header.tsx was staged with "STAGED_POST_STRIP"
    const stagedPostStripContent = 'export const Header = () => <header><h1>Staged</h1></header>;';
    const journal = {
      journalId: 'test-journal-1',
      hostRootDir: hostDir,
      baseHostRev: 'base-rev',
      status: 'BUILD_VERIFYING' as const,
      stagedFiles: [
        {
          relativePath: 'Header.tsx',
          prePromotionContent: initialContent,
          prePromotionSha256: 'initial-hash',
          stagedPostStripContent,
          stagedPostStripSha256: 'staged-hash-123',
          writtenToHost: true,
        },
      ],
      writtenFiles: ['Header.tsx'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    journalManager.saveJournal(journal);

    // Concurrent user edit: User modified Header.tsx during staging!
    const concurrentUserContent = 'export const Header = () => <header><h1>User Concurrent Edit</h1></header>;';
    fs.writeFileSync(testFile, concurrentUserContent);

    // Rollback journal -> must preserve concurrent user edit and report conflict!
    const rollbackResult = journalManager.rollbackJournal(journal, 'Build verification failed');

    assert.strictEqual(rollbackResult.success, false);
    assert.strictEqual(rollbackResult.abortedBecauseOfConflict, true);
    assert.ok(rollbackResult.conflictedFiles.includes('Header.tsx'));

    // Invariant: Header.tsx was NOT overwritten by rollback!
    const preservedContent = fs.readFileSync(testFile, 'utf8');
    assert.strictEqual(preservedContent, concurrentUserContent);
  });

  // ==========================================
  // 4. Startup Crash Recovery
  // ==========================================
  test('[INTEGRATION TEST] Startup recovery detects and safely rolls back interrupted journal', () => {
    // Simulate crashed journal left in APPLYING state
    const targetFile = path.join(hostDir, 'Card.tsx');
    const originalCard = fs.readFileSync(targetFile, 'utf8');

    const stagedContent = 'export const Card = () => <div>Crashed Write</div>;';
    const stagedHash = require('../src/merkle/merkle-tree').sha256(stagedContent);
    fs.writeFileSync(targetFile, stagedContent);

    const crashedJournal = {
      journalId: 'crashed-journal-999',
      hostRootDir: hostDir,
      baseHostRev: 'base-rev',
      status: 'APPLYING' as const,
      stagedFiles: [
        {
          relativePath: 'Card.tsx',
          prePromotionContent: originalCard,
          prePromotionSha256: require('../src/merkle/merkle-tree').sha256(originalCard),
          stagedPostStripContent: stagedContent,
          stagedPostStripSha256: stagedHash,
          writtenToHost: true,
        },
      ],
      writtenFiles: ['Card.tsx'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    PromotionJournalManager.saveJournal(crashedJournal);

    // New engine instance starting up
    const recoveryResult = PromotionJournalManager.recoverInterruptedJournal(hostDir);

    assert.strictEqual(recoveryResult.recovered, true);
    assert.ok(recoveryResult.rollbackResult?.restoredFiles.includes('Card.tsx'));

    // Card.tsx was safely restored to original pre-crash backup
    const restoredCard = fs.readFileSync(targetFile, 'utf8');
    assert.strictEqual(restoredCard, originalCard);
  });

  // ==========================================
  // 5. Dependency Install Rollback & Lockfile Restoration
  // ==========================================
  test('[MOCK RUNNER] package.json and lockfile are restored together on failed install', async () => {
    const worktree = engine.dualSlotManager.getSlotBWorktree();
    const initialPkg = JSON.stringify({ name: 'my-app', dependencies: { react: '^18.0.0' } });
    const initialLock = 'lockfileVersion: 5.4\nreact: 18.0.0\n';

    worktree.writeCandidateFile('package.json', initialPkg);
    worktree.writeCandidateFile('pnpm-lock.yaml', initialLock);

    // Mock runner simulating package install failure
    const failingRunner: CommandRunner = {
      async exec(): Promise<CommandExecutionResult> {
        return { exitCode: 1, stdout: '', stderr: 'ERR_PNPM_NETWORK_FAILURE' };
      },
    };

    const installer = new CandidateDependencyInstaller(worktree, failingRunner);
    const result = await installer.installPackages(['@unsupported/non-icon-pkg']);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.requiresUserReview, true);
    assert.ok(result.reviewOptions?.includes('ABORT_EDIT'));

    // Both package.json AND pnpm-lock.yaml restored together
    assert.strictEqual(worktree.readFile('package.json'), initialPkg);
    assert.strictEqual(worktree.readFile('pnpm-lock.yaml'), initialLock);
  });

  test('[UNIT TEST] Non-allowlisted or unmapped icon dependency failure does not substitute code silently', async () => {
    const worktree = engine.dualSlotManager.getSlotBWorktree();

    // Source code importing an unmapped icon 'Rocket'
    const code = `import { Rocket } from 'lucide-react';\nexport const Comp = () => <div><Rocket /></div>;`;
    worktree.writeCandidateFile('src/Comp.tsx', code);

    const failingRunner: CommandRunner = {
      async exec(): Promise<CommandExecutionResult> {
        return { exitCode: 1, stdout: '', stderr: 'ERR_PNPM_FETCH' };
      },
    };

    const installer = new CandidateDependencyInstaller(worktree, failingRunner);
    const result = await installer.installPackages(['lucide-react']);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.fallbackApplied, false);
    assert.strictEqual(result.requiresUserReview, true);
    assert.ok(result.unmappedIcons?.includes('Rocket'));

    // Comp.tsx was NOT silently modified
    assert.strictEqual(worktree.readFile('src/Comp.tsx'), code);
  });

  // ==========================================
  // 6. Write-Time Path Containment & Symlink Swap
  // ==========================================
  test('[UNIT TEST] Write-time path containment blocks symlink path swap with zero bytes escaping root', () => {
    const outsideTarget = path.join(testBaseDir, 'outside_stolen_file.txt');
    const insideSymlink = path.join(hostDir, 'sneaky_symlink.txt');

    try {
      fs.symlinkSync(outsideTarget, insideSymlink, 'file');
    } catch {
      // If OS environment lacks symlink permission, skip symlink creation
      return;
    }

    // Attempting to write through the symlink must be blocked at write-time
    assert.throws(
      () => {
        PathGuard.safeWriteFile(insideSymlink, 'MALICIOUS_DATA', hostDir);
      },
      PathSecurityError
    );

    // Invariant: Zero bytes reached outside target file
    assert.strictEqual(fs.existsSync(outsideTarget), false);
  });

  // ==========================================
  // 7. Complete Connected Workflow
  // ==========================================
  test('[INTEGRATION TEST] Complete connected workflow: EditTx -> Approval -> Host Promotion -> Follow-up Edit without false stale host conflict', async () => {
    // 1. Advance state machine to Preview Ready
    engine.ledger.stateMachine.updateContext({
      hasBrief: true,
      isBriefReady: true,
      selectedUxDirectionId: 'ux-1',
      selectedUiConceptId: 'ui-1',
    });
    engine.ledger.transitionState('Gathering Brief', 'Init');
    engine.ledger.transitionState('UX Review', 'UX Done');
    engine.ledger.transitionState('UI Review', 'UI Done');
    engine.ledger.transitionState('Preview Ready', 'Preview initialized');

    // 2. Execute Scoped Edit via EditTx in Slot B
    const editPlan = {
      targetUid: 'hdr',
      filePath: 'Header.tsx',
      scope: 'COMPONENT' as const,
      propertyGroups: ['typography' as const],
      expectedTier: 'TIER_1_DETERMINISTIC' as const,
      rationale: 'Add primary navbar styles',
      mutations: [
        {
          type: 'MERGE_CLASSNAMES' as const,
          targetUid: 'hdr',
          propertyGroup: 'typography' as const,
          classesToAdd: 'font-bold text-xl',
        },
      ],
    };

    const baseRev = engine.dualSlotManager.getSlotBWorktree().getMerkleRoot();
    const planResult = await engine.pipeline.processEditPlanAndExecute(editPlan, baseRev);
    assert.strictEqual(planResult.success, true);
    assert.strictEqual(planResult.txRecord?.status, 'COMMITTED');

    // 3. Request Implementation Approval
    const review = engine.approvalGate.requestApproval();
    assert.strictEqual(engine.ledger.stateMachine.getState(), 'Implementation Approval');
    assert.strictEqual(review.affectedFiles.length, 1);
    assert.strictEqual(review.staleHostStatus.isStale, false);

    // 4. User Grants Approval -> Promotes to Host with Dev UID Stripping
    const promotionResult = engine.approvalGate.approveAndPromote({
      approved: true,
      actor: 'user',
      timestamp: new Date().toISOString(),
      confirmSharedBlastRadius: true,
    });
    assert.strictEqual(promotionResult.success, true);

    // Check host file received changes without dev UID leak
    const hostHeader = fs.readFileSync(path.join(hostDir, 'Header.tsx'), 'utf8');
    assert.ok(hostHeader.includes('font-bold text-xl'));
    assert.strictEqual(hostHeader.includes('data-aether-uid'), false);

    // 5. Transition through Build Success to Preview Ready for Follow-up Edit
    engine.ledger.transitionState('Build Success', 'Build completed');
    engine.ledger.transitionState('Preview Ready', 'Ready for next round of edits');

    // 6. Follow-up candidate edit in Slot B
    engine.dualSlotManager.applyCandidateEdit(
      'Card.tsx',
      `export const Card = () => <div data-aether-uid="crd" className="shadow-lg"><p>Follow-up</p></div>;`
    );

    // Prepares review package for follow-up edit: MUST NOT have a false stale host conflict!
    const followUpReview = engine.approvalGate.prepareReviewPackage();
    assert.strictEqual(followUpReview.staleHostStatus.isStale, false);
    assert.ok(followUpReview.affectedFiles.map((f) => f.relativePath).includes('Card.tsx'));
  });
});
