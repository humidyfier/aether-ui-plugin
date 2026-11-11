export interface DependencyChange {
  packageName: string;
  previousVersion?: string;
  nextVersion?: string;
  type: 'added' | 'removed' | 'updated';
  isDevDependency: boolean;
}

export interface SharedComponentBlastRadius {
  componentName: string;
  sourceFile: string;
  consumingFiles: string[];
  consumingFilesCount: number;
  requiresElevatedConfirmation: boolean; // BR-08: true if consumingFilesCount > 1
}

export interface AffectedFileDiff {
  relativePath: string;
  changeType: 'added' | 'modified' | 'deleted';
  oldSize?: number;
  newSize?: number;
  oldSha256?: string;
  newSha256?: string;
}

export interface StaleHostStatus {
  isStale: boolean;
  baseHostMerkleRoot: string;
  currentHostMerkleRoot: string;
  divergentFiles: string[];
}

export interface ApprovalReviewPackage {
  reviewId: string;
  timestamp: string;
  affectedFiles: AffectedFileDiff[];
  dependencyChanges: DependencyChange[];
  blastRadius: SharedComponentBlastRadius[];
  requiresElevatedConfirmation: boolean;
  staleHostStatus: StaleHostStatus;
  merkleRootCandidate: string;
  merkleRootBase: string;
}

export interface ApprovalDecision {
  approved: boolean;
  actor: string;
  timestamp: string;
  reason?: string;
  confirmSharedBlastRadius?: boolean;
  forceIfStaleHost?: boolean;
}

export interface PromotionResult {
  success: boolean;
  checkpointId?: string;
  filesWrittenCount: number;
  promotedMerkleRoot: string;
  hostMerkleRoot: string;
  error?: string;
}
