/**
 * FR-18: Checkpoint Ledger & Merkle Tree Data Models
 * Supports version manifests, file metadata, Merkle tree SHA-256 node calculations,
 * and checkpoint restore/diff capabilities.
 */

export interface ManifestFileEntry {
  relativePath: string;
  sha256: string;
  byteSize: number;
  lastModifiedMs: number;
}

export interface MerkleNode {
  hash: string;
  left?: MerkleNode;
  right?: MerkleNode;
  path?: string; // set for leaf nodes
}

export interface VersionManifest {
  version: number;
  merkleRoot: string;
  timestamp: string;
  totalFiles: number;
  totalBytes: number;
  files: ManifestFileEntry[];
}

export interface CheckpointSnapshotState {
  briefId?: string;
  selectedUxDirectionId?: string;
  selectedUiConceptId?: string;
  lifecycleState: string;
  userPrompt?: string;
  activeRoute?: string;
  activeSelectionUid?: string;
}

export interface Checkpoint {
  id: string;
  parentCheckpointId: string | null;
  timestamp: string;
  message: string;
  author: 'user' | 'agent' | 'system';
  stateSnapshot: CheckpointSnapshotState;
  manifest: VersionManifest;
  merkleRoot: string;
}

export interface CheckpointDiff {
  baseCheckpointId: string;
  targetCheckpointId: string;
  baseMerkleRoot: string;
  targetMerkleRoot: string;
  addedFiles: ManifestFileEntry[];
  modifiedFiles: {
    relativePath: string;
    oldSha256: string;
    newSha256: string;
    oldSize: number;
    newSize: number;
  }[];
  deletedFiles: ManifestFileEntry[];
  unchangedFilesCount: number;
}
