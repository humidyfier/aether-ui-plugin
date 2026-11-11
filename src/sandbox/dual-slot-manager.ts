import * as path from 'node:path';
import { ShadowWorktree, resolveDefaultSandboxDir } from './shadow-worktree';
import { ViteHarness, verifyHttpReachable } from './vite-harness';
import { SandboxSlotState, SlotComparisonReport, SlotId } from './models';
import { ManifestEngine } from '../merkle/manifest';
import { StateLedger } from '../ledger/ledger';
import { Checkpoint } from '../models/checkpoint.model';

export interface DualSlotConfig {
  baseHostDir: string;
  sandboxRootDir?: string;
  slotAPort?: number;
  slotBPort?: number;
  ledger?: StateLedger;
  mode?: 'mock_http' | 'live_vite';
}

export class DualSlotManager {
  private baseHostDir: string;
  private sandboxRootDir: string;
  private slotAWorktree: ShadowWorktree;
  private slotBWorktree: ShadowWorktree;
  private slotAHarness: ViteHarness;
  private slotBHarness: ViteHarness;
  private ledger?: StateLedger;

  private slotAState: SandboxSlotState;
  private slotBState: SandboxSlotState;

  constructor(config: DualSlotConfig) {
    this.baseHostDir = path.resolve(config.baseHostDir);
    this.sandboxRootDir = path.resolve(
      config.sandboxRootDir || resolveDefaultSandboxDir(this.baseHostDir)
    );
    this.ledger = config.ledger;

    const portA = config.slotAPort || 5173;
    const portB = config.slotBPort || 5174;

    // 1. Initialize Worktrees
    this.slotAWorktree = new ShadowWorktree(this.baseHostDir, this.sandboxRootDir, 'slot-a-verified');
    this.slotBWorktree = new ShadowWorktree(this.baseHostDir, this.sandboxRootDir, 'slot-b-candidate');

    // 2. Initialize Harnesses
    this.slotAHarness = new ViteHarness(this.slotAWorktree, { port: portA, mode: config.mode });
    this.slotBHarness = new ViteHarness(this.slotBWorktree, { port: portB, mode: config.mode });

    // 3. Initialize States
    this.slotAState = {
      slotId: 'SLOT_A',
      name: 'Last Verified Build',
      status: 'IDLE',
      worktreePath: this.slotAWorktree.getWorktreePath(),
      port: portA,
      previewUrl: this.slotAHarness.getPreviewUrl(),
      merkleRoot: this.slotAWorktree.getMerkleRoot(),
    };

    this.slotBState = {
      slotId: 'SLOT_B',
      name: 'Candidate Sandbox',
      status: 'IDLE',
      worktreePath: this.slotBWorktree.getWorktreePath(),
      port: portB,
      previewUrl: this.slotBHarness.getPreviewUrl(),
      merkleRoot: this.slotBWorktree.getMerkleRoot(),
    };
  }

  public getSlotState(slotId: SlotId): SandboxSlotState {
    const isA = slotId === 'SLOT_A';
    const worktree = isA ? this.slotAWorktree : this.slotBWorktree;
    const harness = isA ? this.slotAHarness : this.slotBHarness;
    const state = isA ? this.slotAState : this.slotBState;

    let computedStatus = state.status;
    if (harness.getStatus() !== 'RUNNING' && state.status !== 'APPLYING_EDIT' && state.status !== 'VERIFYING') {
      computedStatus = 'STOPPED';
    } else if (harness.getStatus() === 'RUNNING' && (state.status === 'STOPPED' || state.status === 'IDLE')) {
      computedStatus = 'READY';
    }

    return {
      ...state,
      merkleRoot: worktree.getMerkleRoot(),
      status: computedStatus,
    };
  }

  public getSlotAWorktree(): ShadowWorktree {
    return this.slotAWorktree;
  }

  public getSlotBWorktree(): ShadowWorktree {
    return this.slotBWorktree;
  }

  /**
   * Initializes both slots with an initial scaffold or mirrors from the host project.
   */
  public async initialize(scaffoldIfEmpty = true): Promise<void> {
    if (scaffoldIfEmpty) {
      this.slotAWorktree.populateSyntheticScaffold();
      // Mirror Slot A into Slot B as initial candidate baseline
      this.cloneWorktree(this.slotAWorktree, this.slotBWorktree);
    }

    this.slotAState.merkleRoot = this.slotAWorktree.getMerkleRoot();
    this.slotBState.merkleRoot = this.slotBWorktree.getMerkleRoot();
    this.slotAState.status = 'STOPPED';
    this.slotBState.status = 'STOPPED';
  }

  /**
   * Starts Vite preview servers for Slot A, Slot B, or both and verifies real reachability.
   */
  public async startPreviews(): Promise<{ slotAUrl: string; slotBUrl: string; reachableA: boolean; reachableB: boolean }> {
    const slotAUrl = await this.slotAHarness.start();
    const slotBUrl = await this.slotBHarness.start();

    const [reachA, reachB] = await Promise.all([
      verifyHttpReachable(slotAUrl),
      verifyHttpReachable(slotBUrl),
    ]);

    this.slotAState.status = reachA.ok ? 'READY' : 'UNREACHABLE';
    this.slotBState.status = reachB.ok ? 'READY' : 'UNREACHABLE';

    return {
      slotAUrl,
      slotBUrl,
      reachableA: reachA.ok,
      reachableB: reachB.ok,
    };
  }

  public async verifySlotsReachable(): Promise<{ slotA: boolean; slotB: boolean; detailsA: any; detailsB: any }> {
    const [detailsA, detailsB] = await Promise.all([
      verifyHttpReachable(this.slotAState.previewUrl),
      verifyHttpReachable(this.slotBState.previewUrl),
    ]);
    this.slotAState.status = detailsA.ok ? 'READY' : (this.slotAHarness.isServerRunning() ? 'UNREACHABLE' : 'STOPPED');
    this.slotBState.status = detailsB.ok ? 'READY' : (this.slotBHarness.isServerRunning() ? 'UNREACHABLE' : 'STOPPED');
    return {
      slotA: detailsA.ok,
      slotB: detailsB.ok,
      detailsA,
      detailsB,
    };
  }

  /**
   * Applies candidate edit to Slot B ONLY. Slot A remains untouched.
   */
  public applyCandidateEdit(relativePath: string, content: string | Buffer): void {
    this.slotBState.status = 'APPLYING_EDIT';
    this.slotBWorktree.writeCandidateFile(relativePath, content);
    this.slotBState.merkleRoot = this.slotBWorktree.getMerkleRoot();
    this.slotBState.status = 'READY';
  }

  /**
   * Compares Slot A (verified build) and Slot B (candidate sandbox).
   */
  public getSlotComparison(): SlotComparisonReport {
    const manifestA = this.slotAWorktree.getCurrentManifest();
    const manifestB = this.slotBWorktree.getCurrentManifest();

    const diff = ManifestEngine.diffManifests(manifestA, manifestB, 'slot-a', 'slot-b');
    const hasDivergence = manifestA.merkleRoot !== manifestB.merkleRoot;

    return {
      slotA: this.getSlotState('SLOT_A'),
      slotB: this.getSlotState('SLOT_B'),
      hasDivergence,
      divergentFilesCount: diff.addedFiles.length + diff.modifiedFiles.length + diff.deletedFiles.length,
      addedFiles: diff.addedFiles.map((f) => f.relativePath),
      modifiedFiles: diff.modifiedFiles.map((f) => f.relativePath),
      deletedFiles: diff.deletedFiles.map((f) => f.relativePath),
    };
  }

  /**
   * Promotes Candidate (Slot B) to Verified Build (Slot A) upon user implementation approval (FR-19).
   */
  public promoteCandidateToVerified(checkpointMessage = 'Promoted candidate build'): Checkpoint | null {
    // 1. Copy Slot B state into Slot A
    this.cloneWorktree(this.slotBWorktree, this.slotAWorktree);

    this.slotAState.merkleRoot = this.slotAWorktree.getMerkleRoot();
    this.slotAState.lastVerifiedAt = new Date().toISOString();

    // 2. If ledger is attached, create verified checkpoint
    if (this.ledger) {
      const manifest = this.slotAWorktree.getCurrentManifest();
      const checkpoint = this.ledger.createCheckpoint({
        message: checkpointMessage,
        author: 'user',
        files: manifest.files.map((f) => ({
          relativePath: f.relativePath,
          content: this.slotAWorktree.readFile(f.relativePath),
        })),
        stateSnapshot: {
          lifecycleState: 'Implementation Approval',
        },
      });

      this.slotAState.checkpointId = checkpoint.id;
      return checkpoint;
    }

    return null;
  }

  /**
   * Reverts Slot B (candidate) to match Slot A (verified build) exactly.
   */
  public rollbackCandidate(): void {
    this.cloneWorktree(this.slotAWorktree, this.slotBWorktree);
    this.slotBState.merkleRoot = this.slotBWorktree.getMerkleRoot();
    this.slotBState.status = 'READY';
  }

  public async stopAll(): Promise<void> {
    await Promise.all([this.slotAHarness.stop(), this.slotBHarness.stop()]);
    this.slotAState.status = 'IDLE';
    this.slotBState.status = 'IDLE';
  }

  private cloneWorktree(source: ShadowWorktree, target: ShadowWorktree): void {
    target.reset();
    const sourceManifest = source.getCurrentManifest();

    for (const file of sourceManifest.files) {
      const content = source.readFile(file.relativePath);
      target.writeCandidateFile(file.relativePath, content);
    }
  }
}
