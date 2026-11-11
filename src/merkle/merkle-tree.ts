import { createHash } from 'node:crypto';
import { ManifestFileEntry, MerkleNode } from '../models/checkpoint.model';

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export interface MerkleProofStep {
  position: 'left' | 'right';
  hash: string;
}

export interface MerkleProof {
  leafHash: string;
  path: string;
  steps: MerkleProofStep[];
}

export class MerkleTree {
  private leaves: MerkleNode[] = [];
  private rootNode: MerkleNode | null = null;
  private fileEntries: ManifestFileEntry[] = [];

  constructor(files: ManifestFileEntry[]) {
    // Sort files deterministically by relative path (normalized to forward slashes)
    this.fileEntries = [...files].sort((a, b) =>
      a.relativePath.localeCompare(b.relativePath)
    );
    this.buildTree();
  }

  private hashLeaf(file: ManifestFileEntry): string {
    return sha256(`leaf:${file.relativePath}:${file.sha256}`);
  }

  private hashInternal(left: string, right: string): string {
    return sha256(`node:${left}:${right}`);
  }

  private buildTree(): void {
    if (this.fileEntries.length === 0) {
      // Empty tree has deterministic zero-root
      const emptyHash = sha256('empty_tree');
      this.rootNode = { hash: emptyHash };
      this.leaves = [];
      return;
    }

    // 1. Create leaves
    this.leaves = this.fileEntries.map((file) => ({
      hash: this.hashLeaf(file),
      path: file.relativePath,
    }));

    // 2. Build bottom-up
    let currentLevel: MerkleNode[] = [...this.leaves];

    while (currentLevel.length > 1) {
      const nextLevel: MerkleNode[] = [];

      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        // If odd element, duplicate the last node to keep tree balanced
        const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : currentLevel[i];

        const parentNode: MerkleNode = {
          hash: this.hashInternal(left.hash, right.hash),
          left,
          right,
        };
        nextLevel.push(parentNode);
      }

      currentLevel = nextLevel;
    }

    this.rootNode = currentLevel[0];
  }

  public getRootHash(): string {
    return this.rootNode ? this.rootNode.hash : sha256('empty_tree');
  }

  public getRootNode(): MerkleNode | null {
    return this.rootNode;
  }

  public getLeaves(): MerkleNode[] {
    return this.leaves;
  }

  /**
   * Generates a Merkle audit proof for a given relative file path.
   */
  public getProof(relativePath: string): MerkleProof | null {
    const leafIndex = this.fileEntries.findIndex((f) => f.relativePath === relativePath);
    if (leafIndex === -1) {
      return null;
    }

    const leafHash = this.leaves[leafIndex].hash;
    const steps: MerkleProofStep[] = [];

    let currentLevelHashes = this.leaves.map((l) => l.hash);
    let indexInLevel = leafIndex;

    while (currentLevelHashes.length > 1) {
      const nextLevelHashes: string[] = [];
      const isOdd = indexInLevel % 2 !== 0;
      const siblingIndex = isOdd ? indexInLevel - 1 : indexInLevel + 1;

      if (siblingIndex < currentLevelHashes.length) {
        steps.push({
          position: isOdd ? 'left' : 'right',
          hash: currentLevelHashes[siblingIndex],
        });
      } else {
        // Duplicated self when odd number of nodes
        steps.push({
          position: 'right',
          hash: currentLevelHashes[indexInLevel],
        });
      }

      for (let i = 0; i < currentLevelHashes.length; i += 2) {
        const left = currentLevelHashes[i];
        const right = i + 1 < currentLevelHashes.length ? currentLevelHashes[i + 1] : left;
        nextLevelHashes.push(this.hashInternal(left, right));
      }

      currentLevelHashes = nextLevelHashes;
      indexInLevel = Math.floor(indexInLevel / 2);
    }

    return {
      leafHash,
      path: relativePath,
      steps,
    };
  }

  /**
   * Verifies that a Merkle proof reconstructs the expected root hash.
   */
  public static verifyProof(proof: MerkleProof, expectedRootHash: string): boolean {
    let currentHash = proof.leafHash;

    for (const step of proof.steps) {
      if (step.position === 'left') {
        currentHash = sha256(`node:${step.hash}:${currentHash}`);
      } else {
        currentHash = sha256(`node:${currentHash}:${step.hash}`);
      }
    }

    return currentHash === expectedRootHash;
  }
}
