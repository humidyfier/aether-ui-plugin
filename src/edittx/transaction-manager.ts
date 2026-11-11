import { randomUUID } from 'node:crypto';
import { DualSlotManager } from '../sandbox/dual-slot-manager';
import { QuarantineRegistry } from '../ast/quarantine';
import { AstIndexer } from '../ast/indexer';
import { FiberBridgeServer } from '../bridge/fiber-bridge-server';
import { UserLockRegistry } from './lock-registry';
import { SemanticRebaseEngine } from './rebase-engine';
import { AstSurgeon } from './ast-surgeon';
import { TieredValidator } from './tiered-validator';
import {
  EditScope,
  EditTier,
  EditTxMutation,
  EditTxRecord,
  EditTxStatus,
  RevisionContext,
} from './models';
import { StateLedger } from '../ledger/ledger';

export interface ExecuteTxOptions {
  targetUid: string;
  filePath: string;
  mutations: EditTxMutation[];
  scope?: EditScope;
  baseRevision: string; // Exact source revision read when formulating the candidate edit
  allowExplicitLockOverride?: boolean;
  awaitHmrAck?: boolean;
  elementLayoutMetrics?: Array<{
    uid: string;
    tagName: string;
    width: number;
    height: number;
    scrollWidth?: number;
    clientWidth?: number;
    isInteractive?: boolean;
  }>;
  styleNodeInspections?: Array<{
    uid?: string;
    tagName: string;
    color?: string;
    backgroundColor?: string;
    hasAnimation?: boolean;
    hasReducedMotionQuery?: boolean;
  }>;
}

export class EditTransactionManager {
  private dualSlotManager: DualSlotManager;
  private quarantineRegistry: QuarantineRegistry;
  private astIndexer: AstIndexer;
  private lockRegistry: UserLockRegistry;
  private rebaseEngine: SemanticRebaseEngine;
  private astSurgeon: AstSurgeon;
  private validator: TieredValidator;
  private bridgeServer?: FiberBridgeServer;
  private ledger?: StateLedger;
  private transactions: Map<string, EditTxRecord> = new Map();

  constructor(options: {
    dualSlotManager: DualSlotManager;
    quarantineRegistry?: QuarantineRegistry;
    astIndexer?: AstIndexer;
    lockRegistry?: UserLockRegistry;
    bridgeServer?: FiberBridgeServer;
    ledger?: StateLedger;
  }) {
    this.dualSlotManager = options.dualSlotManager;
    this.quarantineRegistry = options.quarantineRegistry || new QuarantineRegistry();
    this.astIndexer = options.astIndexer || new AstIndexer(this.quarantineRegistry);
    this.lockRegistry = options.lockRegistry || new UserLockRegistry();
    this.rebaseEngine = new SemanticRebaseEngine(this.astIndexer);
    this.astSurgeon = new AstSurgeon();
    this.validator = new TieredValidator();
    this.bridgeServer = options.bridgeServer;
    this.ledger = options.ledger;
  }

  public getLockRegistry(): UserLockRegistry {
    return this.lockRegistry;
  }

  public getTransaction(txId: string): EditTxRecord | undefined {
    return this.transactions.get(txId);
  }

  public getAllTransactions(): EditTxRecord[] {
    return Array.from(this.transactions.values());
  }

  /**
   * Executes an atomic Edit Transaction (EditTx) on Slot B (Candidate Sandbox).
   * Host files and Slot A (Last Verified Build) are NEVER mutated or promoted by an edit transaction!
   */
  public async executeTransaction(options: ExecuteTxOptions): Promise<EditTxRecord> {
    const txId = randomUUID();
    const {
      targetUid,
      filePath,
      mutations,
      scope = 'ELEMENT',
      baseRevision,
      allowExplicitLockOverride = false,
      awaitHmrAck = false,
      elementLayoutMetrics,
      styleNodeInspections,
    } = options;

    const slotBWorktree = this.dualSlotManager.getSlotBWorktree();
    const slotAWorktree = this.dualSlotManager.getSlotAWorktree();

    // 1. Separate Revision Tracking
    const currentSlotBRevision = slotBWorktree.getMerkleRoot();
    const currentHostRevision = slotAWorktree.getMerkleRoot(); // Slot A represents baseline verified host state

    const revisions: RevisionContext = {
      baseRevision,
      currentSlotBRevision,
      currentHostRevision,
    };

    // Determine initial tier
    const primaryMutation = mutations[0];
    const tier = this.validator.classifyTier(primaryMutation, scope);
    const propertyGroups = Array.from(new Set(mutations.map((m) => m.propertyGroup)));

    const txRecord: EditTxRecord = {
      id: txId,
      tier,
      targetUid,
      filePath,
      scope,
      propertyGroups,
      revisions,
      mutations,
      exactDiff: '',
      validation: { passed: false, tier, errors: [] },
      status: 'PREPARED',
      createdAt: new Date().toISOString(),
    };
    this.transactions.set(txId, txRecord);

    // Invariant: Reject quarantined or ambiguous UIDs immediately (zero auto-resolution)
    if (this.quarantineRegistry.isQuarantined(targetUid)) {
      txRecord.status = 'REJECTED';
      txRecord.error = `Target UID "${targetUid}" is quarantined due to ambiguous collision. Auto-resolution forbidden.`;
      txRecord.validation.errors.push(txRecord.error);
      return txRecord;
    }

    // Invariant: Read original file from Slot B
    if (!slotBWorktree.existsFile(filePath)) {
      txRecord.status = 'REJECTED';
      txRecord.error = `Target file "${filePath}" does not exist in candidate worktree.`;
      txRecord.validation.errors.push(txRecord.error);
      return txRecord;
    }

    const originalSlotBCode = slotBWorktree.readFile(filePath);
    const indexResult = this.astIndexer.indexSource(originalSlotBCode, filePath);
    const targetEl = indexResult.jsxElements.find((e) => e.uid === targetUid);

    if (!targetEl) {
      txRecord.status = 'REJECTED';
      txRecord.error = `Target UID "${targetUid}" not found in candidate file "${filePath}".`;
      txRecord.validation.errors.push(txRecord.error);
      return txRecord;
    }

    // 2. USER_LOCKED Property Enforcement (Semantic comparison, formatting immunity)
    for (const mutation of mutations) {
      if (this.lockRegistry.isLocked(targetUid, mutation.propertyGroup)) {
        try {
          const oldValueSnippet = targetEl.props[mutation.propName || ''] || '';
          const newValueSnippet = mutation.propValue || mutation.classesToAdd || mutation.newText || '';
          this.lockRegistry.assertCompliance(
            targetUid,
            mutation.propertyGroup,
            oldValueSnippet,
            newValueSnippet,
            allowExplicitLockOverride
          );
        } catch (err: any) {
          txRecord.status = 'REJECTED';
          txRecord.error = err.message;
          txRecord.validation.errors.push(err.message);
          return txRecord;
        }
      }
    }

    // 3. Stale Revisions & Semantic Rebase Engine
    let workingBaseCode = originalSlotBCode;

    // Check if host revision differs from the exact base revision read by caller
    if (currentHostRevision !== baseRevision) {
      const hostCode = slotAWorktree.existsFile(filePath)
        ? slotAWorktree.readFile(filePath)
        : originalSlotBCode;

      const rebaseResult = this.rebaseEngine.analyzeAndRebase({
        targetUid,
        targetFilePath: filePath,
        mutation: primaryMutation,
        revisions,
        baseContent: originalSlotBCode,
        currentSlotBContent: originalSlotBCode,
        currentHostContent: hostCode,
      });

      if (!rebaseResult.canAutoRebase) {
        txRecord.status = 'CONFLICT';
        txRecord.error = `Concurrent host change detected. Auto-rebase aborted: ${rebaseResult.reason}`;
        txRecord.validation.errors.push(txRecord.error);

        // Update state machine if ledger is present
        if (this.ledger) {
          try {
            this.ledger.transitionState('Conflict', `Rebase conflict on ${filePath}`, 'system', {
              txId,
              targetUid,
              conflictingDimensions: rebaseResult.conflictingDimensions,
            });
          } catch {
            // ignore if state machine already in conflict
          }
        }

        return txRecord;
      }

      workingBaseCode = rebaseResult.rebasedCode || workingBaseCode;
    }

    // 4. Tier 3 Handling: Reviewable Proposed Diff without Slot B application
    if (tier === 'TIER_3_PROPOSED_DIFF') {
      let candidateDraftCode = workingBaseCode;
      try {
        for (const mutation of mutations) {
          candidateDraftCode = this.astSurgeon.applyMutation(candidateDraftCode, mutation, filePath);
        }
      } catch (e: any) {
        // syntax or AST error
        txRecord.status = 'REJECTED';
        txRecord.error = `Tier 3 draft failed AST parse: ${e.message}`;
        return txRecord;
      }

      const proposed = this.validator.generateProposedDiff(
        txId,
        targetUid,
        filePath,
        workingBaseCode,
        candidateDraftCode,
        scope,
        [targetEl.componentScopeName],
        [filePath]
      );

      txRecord.proposedDiff = proposed;
      txRecord.exactDiff = proposed.unifiedDiff;
      txRecord.status = 'PREPARED';
      txRecord.validation.passed = true;
      return txRecord;
    }

    // 5. Apply Atomic AST Surgery (Tiers 1 & 2)
    txRecord.status = 'APPLYING';
    let candidateCode = workingBaseCode;

    try {
      for (const mutation of mutations) {
        candidateCode = this.astSurgeon.applyMutation(candidateCode, mutation, filePath);
      }
    } catch (err: any) {
      txRecord.status = 'REJECTED';
      txRecord.error = `AST surgery failed: ${err.message}`;
      txRecord.validation.errors.push(txRecord.error);
      return txRecord;
    }

    // 6. Write Candidate to Slot B (Atomic snapshot before writing)
    const slotBBackupContent = originalSlotBCode;
    slotBWorktree.writeCandidateFile(filePath, candidateCode);

    // If bridge is connected, register pending write for HMR ACK
    if (this.bridgeServer && awaitHmrAck) {
      this.bridgeServer.registerPendingWrite({
        txId,
        targetUid,
        expectedTag: targetEl.tagName,
        expectedText: primaryMutation.newText,
        expectedProps: primaryMutation.propName && primaryMutation.propValue ? { [primaryMutation.propName]: primaryMutation.propValue } : undefined,
        timestamp: new Date().toISOString(),
      });
    }

    // 7. Validate Candidate (TS diagnostics, Viewport Probe, Accessibility, HMR)
    txRecord.status = 'VALIDATING';
    const validation = await this.validator.validateCandidate({
      tier,
      txId,
      filePath,
      candidateCode,
      targetUid,
      bridgeServer: this.bridgeServer,
      awaitHmrAck,
      elementLayoutMetrics,
      styleNodeInspections,
    });

    txRecord.validation = validation;

    // 8. Commit or Atomic Rollback
    if (!validation.passed) {
      // Invariant: Atomic rollback on validation failure. Slot A & host are untouched.
      slotBWorktree.writeCandidateFile(filePath, slotBBackupContent);
      txRecord.status = 'ROLLED_BACK';
      txRecord.error = `Transaction validation failed: ${validation.errors.join('; ')}`;
      txRecord.completedAt = new Date().toISOString();
      return txRecord;
    }

    // Success: Commit to Slot B
    txRecord.status = 'COMMITTED';
    txRecord.completedAt = new Date().toISOString();
    txRecord.revisions.currentSlotBRevision = slotBWorktree.getMerkleRoot();

    return txRecord;
  }
}
