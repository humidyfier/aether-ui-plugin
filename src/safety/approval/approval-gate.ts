import * as path from 'node:path';
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Project } from 'ts-morph';
import { DualSlotManager } from '../../sandbox/dual-slot-manager';
import { StateLedger } from '../../ledger/ledger';
import { CrgAnalyzer } from '../../edittx/crg-analyzer';
import { ManifestEngine } from '../../merkle/manifest';
import { sha256 } from '../../merkle/merkle-tree';
import { UidInjector } from '../../ast/uid-injector';
import { PathGuard } from '../security/path-guard';
import {
  AffectedFileDiff,
  ApprovalDecision,
  ApprovalReviewPackage,
  DependencyChange,
  PromotionResult,
  SharedComponentBlastRadius,
  StaleHostStatus,
} from './approval-models';
import {
  PromotionJournal,
  PromotionJournalManager,
  StagedFileEntry,
} from './promotion-journal';

export class StaleHostConflictError extends Error {
  constructor(public readonly divergentFiles: string[]) {
    super(
      `[APPROVAL BLOCKED] Host project has changed since candidate edit began. Divergent files: ${divergentFiles.join(', ')}. Review conflicts before proceeding.`
    );
    this.name = 'StaleHostConflictError';
  }
}

export class ElevatedConfirmationRequiredError extends Error {
  constructor(public readonly blastRadius: SharedComponentBlastRadius[]) {
    super(
      `[APPROVAL BLOCKED (BR-08)] Edit affects shared components with blast radius > 1 page. Explicit elevated confirmation is required.`
    );
    this.name = 'ElevatedConfirmationRequiredError';
  }
}

export class ApprovalDeniedError extends Error {
  constructor(reason?: string) {
    super(`[APPROVAL DENIED] User rejected candidate implementation: ${reason || 'No reason provided'}`);
    this.name = 'ApprovalDeniedError';
  }
}

export class HostBuildVerificationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`[HOST BUILD VERIFICATION FAILED] Staged files failed host build checks: ${errors.join('; ')}`);
    this.name = 'HostBuildVerificationError';
  }
}

export interface ApprovalGateConfig {
  hostRootDir: string;
  slotManager: DualSlotManager;
  ledger: StateLedger;
  baseHostMerkleRoot?: string;
  skipHostBuildVerification?: boolean;
}

export class ApprovalGate {
  private hostRootDir: string;
  private slotManager: DualSlotManager;
  private ledger: StateLedger;
  private crgAnalyzer: CrgAnalyzer;
  private baseHostMerkleRoot: string;
  private skipHostBuildVerification: boolean;

  constructor(config: ApprovalGateConfig) {
    this.hostRootDir = path.resolve(config.hostRootDir);
    this.slotManager = config.slotManager;
    this.ledger = config.ledger;
    this.crgAnalyzer = new CrgAnalyzer();
    this.skipHostBuildVerification = Boolean(config.skipHostBuildVerification);

    const currentHostManifest = ManifestEngine.buildManifestFromDirectory(this.hostRootDir);
    this.baseHostMerkleRoot = config.baseHostMerkleRoot || currentHostManifest.merkleRoot;

    // Initialize or sync revision pointers
    this.ledger.revisionPointers.advanceHostBaseline(this.baseHostMerkleRoot);
  }

  public getHostRootDir(): string {
    return this.hostRootDir;
  }

  public getBaseHostMerkleRoot(): string {
    return this.baseHostMerkleRoot;
  }

  /**
   * Prepares the comprehensive Implementation Review Package (FR-19 & BR-08).
   */
  public prepareReviewPackage(): ApprovalReviewPackage {
    const slotAWorktree = this.slotManager.getSlotAWorktree();
    const slotBWorktree = this.slotManager.getSlotBWorktree();

    const manifestA = slotAWorktree.getCurrentManifest();
    const manifestB = slotBWorktree.getCurrentManifest();

    // 1. Calculate affected file diffs
    const diff = ManifestEngine.diffManifests(manifestA, manifestB, 'slot-a', 'slot-b');
    const affectedFiles: AffectedFileDiff[] = [];

    for (const add of diff.addedFiles) {
      affectedFiles.push({
        relativePath: add.relativePath,
        changeType: 'added',
        newSize: add.byteSize,
        newSha256: add.sha256,
      });
    }

    for (const mod of diff.modifiedFiles) {
      affectedFiles.push({
        relativePath: mod.relativePath,
        changeType: 'modified',
        oldSize: mod.oldSize,
        newSize: mod.newSize,
        oldSha256: mod.oldSha256,
        newSha256: mod.newSha256,
      });
    }

    for (const del of diff.deletedFiles) {
      affectedFiles.push({
        relativePath: del.relativePath,
        changeType: 'deleted',
        oldSize: del.byteSize,
        oldSha256: del.sha256,
      });
    }

    // 2. Calculate dependency diff between Slot A and Slot B
    const dependencyChanges = this.computeDependencyChanges();

    // 3. Calculate shared component blast radius (BR-08)
    const blastRadius = this.computeBlastRadius(affectedFiles);
    const requiresElevatedConfirmation = blastRadius.some((b) => b.requiresElevatedConfirmation);

    // 4. Check for stale host state
    const staleHostStatus = this.checkStaleHost();

    return {
      reviewId: randomUUID(),
      timestamp: new Date().toISOString(),
      affectedFiles,
      dependencyChanges,
      blastRadius,
      requiresElevatedConfirmation,
      staleHostStatus,
      merkleRootCandidate: manifestB.merkleRoot,
      merkleRootBase: manifestA.merkleRoot,
    };
  }

  /**
   * Requests implementation approval by transitioning state to 'Implementation Approval'.
   */
  public requestApproval(): ApprovalReviewPackage {
    const review = this.prepareReviewPackage();

    // Transition state machine
    if (this.ledger.stateMachine.getState() === 'Preview Ready') {
      this.ledger.transitionState('Implementation Approval', 'Request implementation approval from user', 'agent', {
        reviewId: review.reviewId,
        affectedFilesCount: review.affectedFiles.length,
        requiresElevatedConfirmation: review.requiresElevatedConfirmation,
      });
    }

    return review;
  }

  /**
   * Rejects candidate promotion. Slot A and Host remain untouched.
   * Explicit revision pointer rule: leaves host_baseline_rev and verified_preview_rev unchanged.
   */
  public denyApproval(decision: ApprovalDecision, rollbackCandidate = false): void {
    if (this.ledger.stateMachine.getState() === 'Implementation Approval') {
      this.ledger.transitionState('Preview Ready', 'User denied implementation approval', 'user', {
        reason: decision.reason,
      });
    }

    if (rollbackCandidate) {
      this.slotManager.rollbackCandidate();
      this.ledger.revisionPointers.rollbackCandidate();
    }
  }

  /**
   * Transactional host promotion and rollback:
   * 1. Check for host drift against host baseline.
   * 2. Strip dev-time data-aether-uid attributes for zero production DOM leak.
   * 3. Create and durably record pre-promotion journal.
   * 4. Stage approved files using atomic temporary writes & rename.
   * 5. Run host build verification.
   * 6. Commit and advance host baseline only after build and checkpoint persistence succeed.
   * 7. On failure, roll back only files written by this promotion; preserve unrelated host edits!
   */
  public approveAndPromote(decision: ApprovalDecision): PromotionResult {
    if (!decision.approved) {
      throw new ApprovalDeniedError(decision.reason);
    }

    const review = this.prepareReviewPackage();

    // Invariant: Stale host check against baseline
    if (review.staleHostStatus.isStale && !decision.forceIfStaleHost) {
      throw new StaleHostConflictError(review.staleHostStatus.divergentFiles);
    }

    // Invariant (BR-08): Elevated confirmation required for shared component blast radius > 1
    if (review.requiresElevatedConfirmation && !decision.confirmSharedBlastRadius) {
      throw new ElevatedConfirmationRequiredError(
        review.blastRadius.filter((b) => b.requiresElevatedConfirmation)
      );
    }

    const slotBWorktree = this.slotManager.getSlotBWorktree();
    const candidateManifest = slotBWorktree.getCurrentManifest();

    // 1. Prepare Staged File Entries with Dev UID Stripping
    const stagedFiles: StagedFileEntry[] = [];

    for (const file of candidateManifest.files) {
      PathGuard.validatePath(file.relativePath, this.hostRootDir, {
        allowNonExistent: true,
        rejectSecrets: true,
      });

      const rawContent = slotBWorktree.readFile(file.relativePath);
      let postStripContent = rawContent;

      // Invariant (FR-11): Zero production DOM leak — strip data-aether-uid attributes on host write
      if (file.relativePath.endsWith('.tsx') || file.relativePath.endsWith('.jsx')) {
        postStripContent = UidInjector.stripDevUids(rawContent, file.relativePath);
        UidInjector.verifyZeroProductionLeak(postStripContent, file.relativePath);
      }

      const hostFilePath = path.join(this.hostRootDir, file.relativePath);
      let prePromotionContent: string | undefined;
      let prePromotionSha256: string | undefined;

      if (fs.existsSync(hostFilePath)) {
        prePromotionContent = fs.readFileSync(hostFilePath, 'utf8');
        prePromotionSha256 = sha256(prePromotionContent);
      }

      stagedFiles.push({
        relativePath: file.relativePath,
        prePromotionSha256,
        prePromotionContent,
        stagedPostStripSha256: sha256(postStripContent),
        stagedPostStripContent: postStripContent,
        writtenToHost: false,
      });
    }

    // 2. Durably create and record pre-promotion journal
    const journal: PromotionJournal = {
      journalId: randomUUID(),
      hostRootDir: this.hostRootDir,
      baseHostRev: this.baseHostMerkleRoot,
      status: 'STAGING',
      stagedFiles,
      writtenFiles: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    PromotionJournalManager.saveJournal(journal);

    // 3. Stage and apply approved files via atomic write & rename
    journal.status = 'APPLYING';
    PromotionJournalManager.saveJournal(journal);

    try {
      for (const entry of stagedFiles) {
        const targetPath = path.join(this.hostRootDir, entry.relativePath);
        PathGuard.safeWriteFile(targetPath, entry.stagedPostStripContent, this.hostRootDir);
        entry.writtenToHost = true;
        journal.writtenFiles.push(entry.relativePath);
        PromotionJournalManager.saveJournal(journal);
      }
    } catch (writeError: any) {
      // Partial write failure: roll back written files
      PromotionJournalManager.rollbackJournal(journal, `Partial write failure: ${writeError.message}`);
      throw writeError;
    }

    // 4. Run Host Build Verification
    journal.status = 'BUILD_VERIFYING';
    PromotionJournalManager.saveJournal(journal);

    if (!this.skipHostBuildVerification) {
      const buildErrors = this.verifyHostBuild(stagedFiles);
      if (buildErrors.length > 0) {
        // Rollback written files while preserving unrelated host edits
        const rollbackResult = PromotionJournalManager.rollbackJournal(
          journal,
          `Host build verification failed: ${buildErrors.join('; ')}`
        );
        throw new HostBuildVerificationError(buildErrors);
      }
    }

    // 5. Promote Candidate in DualSlotManager and persist verified checkpoint in SQLite
    let checkpoint: any;
    try {
      checkpoint = this.slotManager.promoteCandidateToVerified(
        `Approved implementation promotion: ${decision.reason || 'User confirmed candidate'}`
      );
    } catch (checkpointError: any) {
      PromotionJournalManager.rollbackJournal(
        journal,
        `Checkpoint persistence failed: ${checkpointError.message}`
      );
      throw checkpointError;
    }

    // 6. Finalize Promotion & Advance Revision Pointers
    const updatedHostManifest = ManifestEngine.buildManifestFromDirectory(this.hostRootDir);
    this.baseHostMerkleRoot = updatedHostManifest.merkleRoot;

    // Advance host baseline revision pointer
    this.ledger.revisionPointers.advanceHostBaseline(updatedHostManifest.merkleRoot);

    journal.status = 'COMMITTED';
    journal.updatedAt = new Date().toISOString();
    PromotionJournalManager.saveJournal(journal);
    PromotionJournalManager.removeJournal(this.hostRootDir);

    // 7. Transition state machine to Building
    this.ledger.stateMachine.updateContext({ isApprovedForImplementation: true });
    if (this.ledger.stateMachine.getState() === 'Implementation Approval') {
      this.ledger.transitionState('Building', 'Promoted approved candidate to host project', 'user', {
        checkpointId: checkpoint?.id,
        filesWrittenCount: stagedFiles.length,
      });
    }

    return {
      success: true,
      checkpointId: checkpoint?.id,
      filesWrittenCount: stagedFiles.length,
      promotedMerkleRoot: candidateManifest.merkleRoot,
      hostMerkleRoot: updatedHostManifest.merkleRoot,
    };
  }

  private verifyHostBuild(stagedFiles: StagedFileEntry[]): string[] {
    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        jsx: 4 /* ts.JsxEmit.ReactJSX */,
        allowJs: true,
        target: 99 /* ts.ScriptTarget.ESNext */,
        module: 99 /* ts.ModuleKind.ESNext */,
        noEmit: true,
      },
    });
    const errors: string[] = [];

    for (const f of stagedFiles) {
      if (f.relativePath.endsWith('.tsx') || f.relativePath.endsWith('.ts')) {
        const sf = project.createSourceFile(f.relativePath, f.stagedPostStripContent, { overwrite: true });

        // Report real syntax and structural errors while ignoring missing ambient external modules/declarations
        const ignoredCodes = new Set([2304, 2307, 2503, 2686, 2741, 2807, 7016, 7026]);
        const diags = sf.getPreEmitDiagnostics().filter((d) => {
          if (ignoredCodes.has(d.getCode())) return false;
          const raw = d.getMessageText();
          const msgText = typeof raw === 'string' ? raw : (raw as any)?.messageText || JSON.stringify(raw);
          if (
            msgText.includes('react/jsx-runtime') ||
            msgText.includes('JSX.IntrinsicElements') ||
            msgText.includes("requires 'React' to be in scope")
          ) {
            return false;
          }
          return d.getCategory() === 1 /* DiagnosticCategory.Error */;
        });

        for (const diag of diags) {
          errors.push(`${f.relativePath}: ${diag.getMessageText()}`);
        }
      }
    }

    return errors;
  }

  private computeDependencyChanges(): DependencyChange[] {
    const slotA = this.slotManager.getSlotAWorktree();
    const slotB = this.slotManager.getSlotBWorktree();

    let pkgA: any = {};
    let pkgB: any = {};

    try {
      if (slotA.existsFile('package.json')) {
        pkgA = JSON.parse(slotA.readFile('package.json'));
      }
    } catch {
      pkgA = {};
    }

    try {
      if (slotB.existsFile('package.json')) {
        pkgB = JSON.parse(slotB.readFile('package.json'));
      }
    } catch {
      pkgB = {};
    }

    const changes: DependencyChange[] = [];

    const depsA = pkgA.dependencies || {};
    const depsB = pkgB.dependencies || {};
    const allDepKeys = new Set([...Object.keys(depsA), ...Object.keys(depsB)]);

    for (const key of allDepKeys) {
      if (!(key in depsA) && key in depsB) {
        changes.push({ packageName: key, nextVersion: depsB[key], type: 'added', isDevDependency: false });
      } else if (key in depsA && !(key in depsB)) {
        changes.push({ packageName: key, previousVersion: depsA[key], type: 'removed', isDevDependency: false });
      } else if (depsA[key] !== depsB[key]) {
        changes.push({ packageName: key, previousVersion: depsA[key], nextVersion: depsB[key], type: 'updated', isDevDependency: false });
      }
    }

    const devA = pkgA.devDependencies || {};
    const devB = pkgB.devDependencies || {};
    const allDevKeys = new Set([...Object.keys(devA), ...Object.keys(devB)]);

    for (const key of allDevKeys) {
      if (!(key in devA) && key in devB) {
        changes.push({ packageName: key, nextVersion: devB[key], type: 'added', isDevDependency: true });
      } else if (key in devA && !(key in devB)) {
        changes.push({ packageName: key, previousVersion: devA[key], type: 'removed', isDevDependency: true });
      } else if (devA[key] !== devB[key]) {
        changes.push({ packageName: key, previousVersion: devA[key], nextVersion: devB[key], type: 'updated', isDevDependency: true });
      }
    }

    return changes;
  }

  private computeBlastRadius(affectedFiles: AffectedFileDiff[]): SharedComponentBlastRadius[] {
    const slotB = this.slotManager.getSlotBWorktree();
    const manifest = slotB.getCurrentManifest();

    const projectFiles: Array<{ filePath: string; content: string }> = [];
    for (const f of manifest.files) {
      if (f.relativePath.endsWith('.tsx') || f.relativePath.endsWith('.jsx')) {
        try {
          projectFiles.push({
            filePath: f.relativePath,
            content: slotB.readFile(f.relativePath),
          });
        } catch {
          // ignore unreadable
        }
      }
    }

    if (projectFiles.length === 0) return [];

    const crg = this.crgAnalyzer.buildComponentReferenceGraph(projectFiles);
    const blastRadiusList: SharedComponentBlastRadius[] = [];

    const affectedPathSet = new Set(
      affectedFiles.map((a) => a.relativePath.replace(/\\/g, '/').replace(/^\//, ''))
    );

    for (const node of crg.values()) {
      const normalizedSource = node.filePath.replace(/\\/g, '/').replace(/^\//, '');
      if (affectedPathSet.has(normalizedSource)) {
        const uniqueConsuming = Array.from(
          new Set(node.instantiatedIn.map((i) => i.filePath.replace(/\\/g, '/').replace(/^\//, '')))
        );
        const count = uniqueConsuming.length;

        blastRadiusList.push({
          componentName: node.componentName,
          sourceFile: node.filePath,
          consumingFiles: uniqueConsuming,
          consumingFilesCount: count,
          requiresElevatedConfirmation: count > 1, // BR-08: Blast radius > 1 page requires elevated confirmation
        });
      }
    }

    return blastRadiusList;
  }

  private checkStaleHost(): StaleHostStatus {
    const currentHostManifest = ManifestEngine.buildManifestFromDirectory(this.hostRootDir);
    const isStale = currentHostManifest.merkleRoot !== this.baseHostMerkleRoot;

    const divergentFiles: string[] = [];
    if (isStale) {
      for (const f of currentHostManifest.files) {
        divergentFiles.push(f.relativePath);
      }
    }

    return {
      isStale,
      baseHostMerkleRoot: this.baseHostMerkleRoot,
      currentHostMerkleRoot: currentHostManifest.merkleRoot,
      divergentFiles,
    };
  }
}
