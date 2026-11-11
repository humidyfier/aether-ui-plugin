import * as fs from 'node:fs';
import * as path from 'node:path';
import { ManifestFileEntry, VersionManifest, CheckpointDiff } from '../models/checkpoint.model';
import { MerkleTree, sha256 } from './merkle-tree';

export interface ScanOptions {
  ignorePatterns?: RegExp[];
  maxFileSize?: number;
}

const DEFAULT_IGNORE: RegExp[] = [
  /[\\/]\.git([\\/]|$)/,
  /[\\/]node_modules([\\/]|$)/,
  /[\\/]\.aether([\\/]|$)/,
  /[\\/]dist([\\/]|$)/,
  /[\\/]\.DS_Store$/,
];

export class ManifestEngine {
  /**
   * Hashes a file on disk using SHA-256.
   */
  public static hashFile(filePath: string): { sha256: string; byteSize: number; lastModifiedMs: number } {
    const stats = fs.statSync(filePath);
    const content = fs.readFileSync(filePath);
    return {
      sha256: sha256(content),
      byteSize: stats.size,
      lastModifiedMs: stats.mtimeMs,
    };
  }

  /**
   * Hashes an in-memory buffer or string.
   */
  public static hashContent(content: string | Buffer, relativePath: string): ManifestFileEntry {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    return {
      relativePath: relativePath.replace(/\\/g, '/'),
      sha256: sha256(buf),
      byteSize: buf.length,
      lastModifiedMs: Date.now(),
    };
  }

  /**
   * Recursively scans a directory and builds a deterministic VersionManifest.
   */
  public static buildManifestFromDirectory(
    rootDir: string,
    versionNumber = 1,
    options: ScanOptions = {}
  ): VersionManifest {
    const ignores = options.ignorePatterns || DEFAULT_IGNORE;
    const entries: ManifestFileEntry[] = [];

    function walk(currentDir: string) {
      if (!fs.existsSync(currentDir)) return;
      const items = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const item of items) {
        const fullPath = path.join(currentDir, item.name);
        const rel = path.relative(rootDir, fullPath).replace(/\\/g, '/');
        const normalizedRel = '/' + rel;

        // Check ignores relative to root
        if (ignores.some((pattern) => pattern.test(normalizedRel))) {
          continue;
        }

        if (item.isDirectory()) {
          walk(fullPath);
        } else if (item.isFile()) {
          try {
            const fileInfo = ManifestEngine.hashFile(fullPath);
            entries.push({
              relativePath: rel,
              sha256: fileInfo.sha256,
              byteSize: fileInfo.byteSize,
              lastModifiedMs: fileInfo.lastModifiedMs,
            });
          } catch (err) {
            // Ignore unreadable or locked transient files
          }
        }
      }
    }

    walk(rootDir);

    return ManifestEngine.createManifest(entries, versionNumber);
  }

  /**
   * Creates a VersionManifest from explicit file entries.
   */
  public static createManifest(entries: ManifestFileEntry[], versionNumber = 1): VersionManifest {
    const sortedEntries = [...entries].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    const merkleTree = new MerkleTree(sortedEntries);
    const merkleRoot = merkleTree.getRootHash();

    const totalBytes = sortedEntries.reduce((sum, f) => sum + f.byteSize, 0);

    return {
      version: versionNumber,
      merkleRoot,
      timestamp: new Date().toISOString(),
      totalFiles: sortedEntries.length,
      totalBytes,
      files: sortedEntries,
    };
  }

  /**
   * Computes exact file diff between two version manifests.
   */
  public static diffManifests(
    baseManifest: VersionManifest,
    targetManifest: VersionManifest,
    baseCheckpointId = 'base',
    targetCheckpointId = 'target'
  ): CheckpointDiff {
    const baseMap = new Map<string, ManifestFileEntry>();
    for (const f of baseManifest.files) {
      baseMap.set(f.relativePath, f);
    }

    const targetMap = new Map<string, ManifestFileEntry>();
    for (const f of targetManifest.files) {
      targetMap.set(f.relativePath, f);
    }

    const addedFiles: ManifestFileEntry[] = [];
    const modifiedFiles: CheckpointDiff['modifiedFiles'] = [];
    const deletedFiles: ManifestFileEntry[] = [];
    let unchangedFilesCount = 0;

    for (const [pathKey, targetFile] of targetMap.entries()) {
      const baseFile = baseMap.get(pathKey);
      if (!baseFile) {
        addedFiles.push(targetFile);
      } else if (baseFile.sha256 !== targetFile.sha256) {
        modifiedFiles.push({
          relativePath: pathKey,
          oldSha256: baseFile.sha256,
          newSha256: targetFile.sha256,
          oldSize: baseFile.byteSize,
          newSize: targetFile.byteSize,
        });
      } else {
        unchangedFilesCount++;
      }
    }

    for (const [pathKey, baseFile] of baseMap.entries()) {
      if (!targetMap.has(pathKey)) {
        deletedFiles.push(baseFile);
      }
    }

    return {
      baseCheckpointId,
      targetCheckpointId,
      baseMerkleRoot: baseManifest.merkleRoot,
      targetMerkleRoot: targetManifest.merkleRoot,
      addedFiles,
      modifiedFiles,
      deletedFiles,
      unchangedFilesCount,
    };
  }
}
