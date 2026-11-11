import * as path from 'node:path';
import * as fs from 'node:fs';
import { Checkpoint, VersionManifest } from '../../models/checkpoint.model';
import { StateLedger } from '../../ledger/ledger';
import { ManifestEngine } from '../../merkle/manifest';
import { sha256 } from '../../merkle/merkle-tree';
import { PathGuard } from '../security/path-guard';
import { ShadowWorktree } from '../../sandbox/shadow-worktree';

export class CorruptedCheckpointError extends Error {
  constructor(public readonly checkpointId: string, public readonly details: string) {
    super(
      `[INTEGRITY VIOLATION] Corrupted checkpoint detected for ID "${checkpointId}". Merkle integrity check failed: ${details}`
    );
    this.name = 'CorruptedCheckpointError';
  }
}

export interface VisualSnapshot {
  checkpointId: string;
  timestamp: string;
  indexHtml: string;
  stylesCss: string;
  domStructureSnippet?: string;
  metadata?: Record<string, unknown>;
  snapshotDir: string;
}

export interface RunnableRecoveryResult {
  checkpointId: string;
  merkleRoot: string;
  filesRestoredCount: number;
  targetDir: string;
  verifiedIntegrity: boolean;
  restoredAt: string;
}

export class DualLevelRecoveryManager {
  private baseDir: string;
  private recoveryDir: string;
  private snapshotsDir: string;
  private ledger: StateLedger;

  constructor(baseDir: string, ledger: StateLedger) {
    this.baseDir = path.resolve(baseDir);
    this.recoveryDir = path.join(this.baseDir, '.aether', 'recovery');
    this.snapshotsDir = path.join(this.recoveryDir, 'snapshots');
    this.ledger = ledger;

    if (!fs.existsSync(this.snapshotsDir)) {
      fs.mkdirSync(this.snapshotsDir, { recursive: true });
    }
  }

  // ==========================================
  // LEVEL 1: Visual Recovery (Static Snapshot)
  // ==========================================

  /**
   * Captures a static HTML/CSS dist_snapshot/ for instant visual verification
   * without requiring code execution or package installation.
   */
  public captureVisualSnapshot(
    checkpointId: string,
    snapshotData: {
      indexHtml: string;
      stylesCss: string;
      domStructureSnippet?: string;
      metadata?: Record<string, unknown>;
    }
  ): VisualSnapshot {
    const checkpointDir = path.join(this.snapshotsDir, checkpointId, 'dist_snapshot');
    if (!fs.existsSync(checkpointDir)) {
      fs.mkdirSync(checkpointDir, { recursive: true });
    }

    const htmlPath = path.join(checkpointDir, 'index.html');
    const cssPath = path.join(checkpointDir, 'styles.css');
    const metaPath = path.join(checkpointDir, 'metadata.json');

    fs.writeFileSync(htmlPath, snapshotData.indexHtml, 'utf8');
    fs.writeFileSync(cssPath, snapshotData.stylesCss, 'utf8');
    fs.writeFileSync(
      metaPath,
      JSON.stringify(
        {
          checkpointId,
          timestamp: new Date().toISOString(),
          domStructureSnippet: snapshotData.domStructureSnippet,
          metadata: snapshotData.metadata,
        },
        null,
        2
      ),
      'utf8'
    );

    return {
      checkpointId,
      timestamp: new Date().toISOString(),
      indexHtml: snapshotData.indexHtml,
      stylesCss: snapshotData.stylesCss,
      domStructureSnippet: snapshotData.domStructureSnippet,
      metadata: snapshotData.metadata,
      snapshotDir: checkpointDir,
    };
  }

  /**
   * Retrieves visual snapshot for static preview rendering.
   */
  public recoverVisualSnapshot(checkpointId: string): VisualSnapshot {
    const checkpointDir = path.join(this.snapshotsDir, checkpointId, 'dist_snapshot');
    const htmlPath = path.join(checkpointDir, 'index.html');
    const cssPath = path.join(checkpointDir, 'styles.css');
    const metaPath = path.join(checkpointDir, 'metadata.json');

    if (!fs.existsSync(htmlPath)) {
      throw new Error(`Visual snapshot for checkpoint "${checkpointId}" does not exist at "${checkpointDir}"`);
    }

    const indexHtml = fs.readFileSync(htmlPath, 'utf8');
    const stylesCss = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';
    let metadata: any = {};
    if (fs.existsSync(metaPath)) {
      try {
        metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      } catch {
        metadata = {};
      }
    }

    return {
      checkpointId,
      timestamp: metadata.timestamp || new Date().toISOString(),
      indexHtml,
      stylesCss,
      domStructureSnippet: metadata.domStructureSnippet,
      metadata: metadata.metadata,
      snapshotDir: checkpointDir,
    };
  }

  // ==========================================
  // LEVEL 2: Runnable Code Recovery (Verified Checkout)
  // ==========================================

  /**
   * Stores source tree files for a given checkpoint in the content archive.
   */
  public persistSourceFiles(
    checkpointId: string,
    files: Array<{ relativePath: string; content: string | Buffer }>
  ): void {
    const sourceDir = path.join(this.recoveryDir, 'sources', checkpointId);
    if (!fs.existsSync(sourceDir)) {
      fs.mkdirSync(sourceDir, { recursive: true });
    }

    for (const file of files) {
      const targetPath = path.join(sourceDir, file.relativePath);
      PathGuard.validatePath(targetPath, sourceDir, { allowNonExistent: true, rejectSecrets: false });
      const dir = path.dirname(targetPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(targetPath, file.content);
    }
  }

  /**
   * Recovers a runnable verified source tree from checkpoint storage.
   * Enforces strict Merkle tree integrity verification before checkout.
   */
  public recoverRunnableSourceTree(
    checkpointId: string,
    target: ShadowWorktree | string
  ): RunnableRecoveryResult {
    const checkpoint = this.ledger.checkpoints.findById(checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint with ID "${checkpointId}" not found in StateLedger`);
    }

    const sourceDir = path.join(this.recoveryDir, 'sources', checkpointId);
    if (!fs.existsSync(sourceDir)) {
      throw new Error(`Source archive for checkpoint "${checkpointId}" not found at "${sourceDir}"`);
    }

    const targetDir = typeof target === 'string' ? path.resolve(target) : target.getWorktreePath();

    // 1. Rigorous Merkle tree and SHA-256 verification of stored source files
    const manifest = checkpoint.manifest;
    const computedEntries = [];

    for (const expectedFile of manifest.files) {
      const sourceFilePath = path.join(sourceDir, expectedFile.relativePath);
      if (!fs.existsSync(sourceFilePath)) {
        throw new CorruptedCheckpointError(
          checkpointId,
          `Missing expected manifest file "${expectedFile.relativePath}"`
        );
      }

      const fileContent = fs.readFileSync(sourceFilePath);
      const computedHash = sha256(fileContent);

      if (computedHash !== expectedFile.sha256) {
        throw new CorruptedCheckpointError(
          checkpointId,
          `File hash mismatch for "${expectedFile.relativePath}". Expected ${expectedFile.sha256}, got ${computedHash}`
        );
      }

      computedEntries.push(ManifestEngine.hashContent(fileContent, expectedFile.relativePath));
    }

    // Verify computed Merkle Root
    const computedManifest = ManifestEngine.createManifest(computedEntries, manifest.version);
    if (computedManifest.merkleRoot !== checkpoint.merkleRoot) {
      throw new CorruptedCheckpointError(
        checkpointId,
        `Merkle root mismatch! Expected ${checkpoint.merkleRoot}, got computed root ${computedManifest.merkleRoot}`
      );
    }

    // 2. Verified clean checkout into target worktree
    let filesRestoredCount = 0;
    for (const expectedFile of manifest.files) {
      const sourceFilePath = path.join(sourceDir, expectedFile.relativePath);
      const content = fs.readFileSync(sourceFilePath);

      if (typeof target === 'string') {
        const destPath = path.join(targetDir, expectedFile.relativePath);
        PathGuard.validatePath(destPath, targetDir, { allowNonExistent: true, rejectSecrets: false });
        PathGuard.safeWriteFile(destPath, content, targetDir);
      } else {
        target.writeCandidateFile(expectedFile.relativePath, content);
      }
      filesRestoredCount++;
    }

    if (typeof target !== 'string') {
      target.refreshManifest();
    }

    return {
      checkpointId,
      merkleRoot: checkpoint.merkleRoot,
      filesRestoredCount,
      targetDir,
      verifiedIntegrity: true,
      restoredAt: new Date().toISOString(),
    };
  }
}
