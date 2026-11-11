import { VersionManifest } from '../models/checkpoint.model';

export type SlotId = 'SLOT_A' | 'SLOT_B';

export type SlotStatus =
  | 'IDLE'
  | 'BOOTING'
  | 'READY'
  | 'APPLYING_EDIT'
  | 'VERIFYING'
  | 'STALE'
  | 'ERROR'
  | 'UNREACHABLE'
  | 'STOPPED';

export interface SandboxSlotState {
  slotId: SlotId;
  name: string; // Slot A: "Last Verified Build" | Slot B: "Candidate Sandbox"
  status: SlotStatus;
  worktreePath: string;
  port: number;
  previewUrl: string;
  merkleRoot: string;
  checkpointId?: string;
  lastVerifiedAt?: string;
  errorMessage?: string;
}

export interface ShadowWorktreeConfig {
  baseHostDir: string;
  sandboxRootDir: string; // e.g. .aether/sandbox
  slotAWorktreeName?: string;
  slotBWorktreeName?: string;
  excludedPatterns?: RegExp[];
}

export interface CandidateWriteResult {
  filePath: string;
  byteSize: number;
  sha256: string;
  previousSha256?: string;
  merkleRootBefore: string;
  merkleRootAfter: string;
  timestamp: string;
}

export interface SlotComparisonReport {
  slotA: SandboxSlotState;
  slotB: SandboxSlotState;
  hasDivergence: boolean;
  divergentFilesCount: number;
  addedFiles: string[];
  modifiedFiles: string[];
  deletedFiles: string[];
}
