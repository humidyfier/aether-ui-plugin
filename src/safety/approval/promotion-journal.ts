import * as path from 'node:path';
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { sha256 } from '../../merkle/merkle-tree';
import { PathGuard } from '../security/path-guard';

export interface StagedFileEntry {
  relativePath: string;
  prePromotionSha256?: string;     // Hash of host file prior to promotion
  prePromotionContent?: string;    // Full backup of host file content prior to promotion
  stagedPostStripSha256: string;   // Expected hash of post-stripped file written to host
  stagedPostStripContent: string;  // Post-stripped content written to host
  writtenToHost: boolean;
}

export type JournalStatus =
  | 'RECORDED'
  | 'STAGING'
  | 'APPLYING'
  | 'BUILD_VERIFYING'
  | 'COMMITTED'
  | 'ROLLED_BACK'
  | 'CONFLICT';

export interface PromotionJournal {
  journalId: string;
  hostRootDir: string;
  baseHostRev: string;
  status: JournalStatus;
  stagedFiles: StagedFileEntry[];
  writtenFiles: string[];
  createdAt: string;
  updatedAt: string;
  error?: string;
  conflictedFiles?: string[];
}

export interface RollbackResult {
  success: boolean;
  restoredFiles: string[];
  conflictedFiles: string[];
  abortedBecauseOfConflict: boolean;
}

export class PromotionJournalManager {
  public static getJournalPath(hostRootDir: string): string {
    return path.join(hostRootDir, '.aether', 'promotion-journal.json');
  }

  public static saveJournal(journal: PromotionJournal): void {
    const journalPath = this.getJournalPath(journal.hostRootDir);
    PathGuard.safeWriteFile(
      journalPath,
      JSON.stringify(journal, null, 2),
      journal.hostRootDir
    );
  }

  public static loadActiveJournal(hostRootDir: string): PromotionJournal | null {
    const journalPath = this.getJournalPath(hostRootDir);
    if (!fs.existsSync(journalPath)) {
      return null;
    }
    try {
      const content = fs.readFileSync(journalPath, 'utf8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  public static removeJournal(hostRootDir: string): void {
    const journalPath = this.getJournalPath(hostRootDir);
    if (fs.existsSync(journalPath)) {
      try {
        fs.unlinkSync(journalPath);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Rolls back promotion writes while strictly preserving unrelated host edits.
   * If a file was changed after staging, automatic rollback is stopped for that file,
   * its current contents are preserved, and a recovery conflict is reported.
   */
  public static rollbackJournal(
    journal: PromotionJournal,
    reason: string
  ): RollbackResult {
    const restoredFiles: string[] = [];
    const conflictedFiles: string[] = [];

    for (const fileEntry of journal.stagedFiles) {
      if (!fileEntry.writtenToHost) {
        continue;
      }

      const hostFilePath = path.join(journal.hostRootDir, fileEntry.relativePath);

      if (!fs.existsSync(hostFilePath)) {
        // File was deleted in host
        continue;
      }

      const currentContent = fs.readFileSync(hostFilePath, 'utf8');
      const currentHash = sha256(currentContent);

      // Invariant: Compare host file with the exact post-promotion bytes recorded in journal.
      // If user or process changed this file after staging, preserve its current contents!
      if (currentHash !== fileEntry.stagedPostStripSha256) {
        conflictedFiles.push(fileEntry.relativePath);
        continue; // DO NOT OVERWRITE concurrent user edits!
      }

      // File matches our staged write: safely restore backup
      if (fileEntry.prePromotionContent !== undefined) {
        PathGuard.safeWriteFile(hostFilePath, fileEntry.prePromotionContent, journal.hostRootDir);
        restoredFiles.push(fileEntry.relativePath);
      } else {
        // File did not exist before promotion -> unlink it
        try {
          fs.unlinkSync(hostFilePath);
          restoredFiles.push(fileEntry.relativePath);
        } catch {
          // ignore
        }
      }
    }

    journal.status = conflictedFiles.length > 0 ? 'CONFLICT' : 'ROLLED_BACK';
    journal.error = reason;
    journal.conflictedFiles = conflictedFiles;
    journal.updatedAt = new Date().toISOString();
    this.saveJournal(journal);

    return {
      success: conflictedFiles.length === 0,
      restoredFiles,
      conflictedFiles,
      abortedBecauseOfConflict: conflictedFiles.length > 0,
    };
  }

  /**
   * Recovers from an interrupted promotion on agent startup.
   */
  public static recoverInterruptedJournal(hostRootDir: string): {
    recovered: boolean;
    journal?: PromotionJournal;
    rollbackResult?: RollbackResult;
  } {
    const journal = this.loadActiveJournal(hostRootDir);
    if (!journal) {
      return { recovered: false };
    }

    if (journal.status === 'APPLYING' || journal.status === 'BUILD_VERIFYING' || journal.status === 'STAGING') {
      const rollbackResult = this.rollbackJournal(
        journal,
        'Recovered from crashed/interrupted promotion journal detected on startup.'
      );
      return {
        recovered: true,
        journal,
        rollbackResult,
      };
    }

    return { recovered: false, journal };
  }
}
