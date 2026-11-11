import * as path from 'node:path';
import * as fs from 'node:fs';
import { StateLedger } from '../ledger/ledger';
import { DualSlotManager } from '../sandbox/dual-slot-manager';
import { EditTransactionManager } from '../edittx/transaction-manager';
import { MultiStagePipelineOrchestrator } from '../pipeline/orchestrator/stage-orchestrator';
import { ApprovalGate } from '../safety/approval/approval-gate';
import { DualLevelRecoveryManager } from '../safety/recovery/dual-level-recovery';
import { CandidateDependencyInstaller } from '../safety/dependencies/dependency-installer';
import { PromotionJournalManager } from '../safety/approval/promotion-journal';
import { ManifestEngine } from '../merkle/manifest';

export interface AetherEngineConfig {
  hostRootDir: string;
  sandboxRootDir?: string;
  dbPath?: string;
  slotAPort?: number;
  slotBPort?: number;
  mode?: 'mock_http' | 'live_vite';
}

export class AetherEngine {
  public readonly hostRootDir: string;
  public readonly sandboxRootDir: string;
  public readonly ledger: StateLedger;
  public readonly dualSlotManager: DualSlotManager;
  public readonly editTxManager: EditTransactionManager;
  public readonly pipeline: MultiStagePipelineOrchestrator;
  public readonly approvalGate: ApprovalGate;
  public readonly recovery: DualLevelRecoveryManager;
  public readonly dependencyInstaller: CandidateDependencyInstaller;

  constructor(config: AetherEngineConfig) {
    this.hostRootDir = path.resolve(config.hostRootDir);
    this.sandboxRootDir = path.resolve(
      config.sandboxRootDir || path.join(this.hostRootDir, '.aether', 'sandbox')
    );

    // 1. Module 1: State Ledger & Machine with persistent disk default
    let resolvedDbPath = config.dbPath;
    if (!resolvedDbPath) {
      if (process.env.AETHER_IN_MEMORY_DB === '1' || process.env.NODE_ENV === 'test') {
        resolvedDbPath = ':memory:';
      } else {
        const defaultDbDir = process.env.AETHER_DATA_DIR || path.join(this.hostRootDir, '.aether');
        try {
          fs.mkdirSync(defaultDbDir, { recursive: true });
          resolvedDbPath = path.join(defaultDbDir, 'aether-state.db');
        } catch {
          resolvedDbPath = ':memory:';
        }
      }
    }
    this.ledger = new StateLedger(resolvedDbPath);

    // 2. Module 2: Dual Slot Preview Manager
    this.dualSlotManager = new DualSlotManager({
      baseHostDir: this.hostRootDir,
      sandboxRootDir: this.sandboxRootDir,
      slotAPort: config.slotAPort || 5173,
      slotBPort: config.slotBPort || 5174,
      ledger: this.ledger,
      mode: config.mode,
    });

    // 3. Module 3: EditTx Engine
    this.editTxManager = new EditTransactionManager({
      dualSlotManager: this.dualSlotManager,
      ledger: this.ledger,
    });

    // 4. Module 4: Multi-Stage Pipeline Orchestrator
    this.pipeline = new MultiStagePipelineOrchestrator({
      ledger: this.ledger,
      editTxManager: this.editTxManager,
    });

    // 5. Module 5: Safety, Recovery & Approval
    const hostManifest = ManifestEngine.buildManifestFromDirectory(this.hostRootDir);
    this.approvalGate = new ApprovalGate({
      hostRootDir: this.hostRootDir,
      slotManager: this.dualSlotManager,
      ledger: this.ledger,
      baseHostMerkleRoot: hostManifest.merkleRoot,
    });

    this.recovery = new DualLevelRecoveryManager(this.hostRootDir, this.ledger);
    this.dependencyInstaller = new CandidateDependencyInstaller(
      this.dualSlotManager.getSlotBWorktree()
    );
  }

  /**
   * Initializes the engine, checks for interrupted promotion journals,
   * mirrors host or populates scaffold into dual slots.
   */
  public async initialize(scaffoldIfEmpty = true, autoStartPreviews = false): Promise<void> {
    // 1. Crash recovery check for interrupted promotions
    PromotionJournalManager.recoverInterruptedJournal(this.hostRootDir);

    // 2. Initialize slots
    await this.dualSlotManager.initialize(scaffoldIfEmpty);

    // 3. Auto-start previews if requested
    if (autoStartPreviews) {
      await this.dualSlotManager.startPreviews();
    }

    // 4. Sync initial revision pointers
    const hostManifest = ManifestEngine.buildManifestFromDirectory(this.hostRootDir);
    this.ledger.revisionPointers.advanceHostBaseline(hostManifest.merkleRoot);
  }

  public async stop(): Promise<void> {
    await this.dualSlotManager.stopAll();
    this.ledger.close();
  }
}
