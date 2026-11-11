import { ISqliteDatabase } from '../ledger/db';

export interface RevisionPointers {
  host_baseline_rev: string;
  verified_preview_rev: string;
  candidate_work_rev: string;
  updatedAt: string;
}

export class RevisionPointerRegistry {
  private pointers: RevisionPointers;
  private db?: ISqliteDatabase;

  constructor(initialBaseline = 'initial-empty', db?: ISqliteDatabase) {
    this.db = db;
    this.pointers = {
      host_baseline_rev: initialBaseline,
      verified_preview_rev: initialBaseline,
      candidate_work_rev: initialBaseline,
      updatedAt: new Date().toISOString(),
    };

    if (this.db) {
      this.initSchema();
      this.loadFromDb();
    }
  }

  private initSchema(): void {
    if (!this.db) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS revision_pointers (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        host_baseline_rev TEXT NOT NULL,
        verified_preview_rev TEXT NOT NULL,
        candidate_work_rev TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  private loadFromDb(): void {
    if (!this.db) return;
    const row = this.db.prepare('SELECT * FROM revision_pointers WHERE id = 1').get() as any;
    if (row) {
      this.pointers = {
        host_baseline_rev: row.host_baseline_rev,
        verified_preview_rev: row.verified_preview_rev,
        candidate_work_rev: row.candidate_work_rev,
        updatedAt: row.updated_at,
      };
    } else {
      this.saveToDb();
    }
  }

  private saveToDb(): void {
    if (!this.db) return;
    this.db.prepare(`
      INSERT INTO revision_pointers (id, host_baseline_rev, verified_preview_rev, candidate_work_rev, updated_at)
      VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        host_baseline_rev = excluded.host_baseline_rev,
        verified_preview_rev = excluded.verified_preview_rev,
        candidate_work_rev = excluded.candidate_work_rev,
        updated_at = excluded.updated_at
    `).run(
      this.pointers.host_baseline_rev,
      this.pointers.verified_preview_rev,
      this.pointers.candidate_work_rev,
      this.pointers.updatedAt
    );
  }

  public getPointers(): Readonly<RevisionPointers> {
    return { ...this.pointers };
  }

  /**
   * Advances candidate_work_rev (Slot B) when an edit is applied.
   * Host baseline and verified preview remain unchanged.
   */
  public advanceCandidateWork(rev: string): Readonly<RevisionPointers> {
    this.pointers.candidate_work_rev = rev;
    this.pointers.updatedAt = new Date().toISOString();
    this.saveToDb();
    return this.getPointers();
  }

  /**
   * Advances verified_preview_rev (Slot A) when a candidate preview passes validation.
   * Host baseline remains unchanged.
   */
  public advanceVerifiedPreview(rev: string): Readonly<RevisionPointers> {
    this.pointers.verified_preview_rev = rev;
    this.pointers.updatedAt = new Date().toISOString();
    this.saveToDb();
    return this.getPointers();
  }

  /**
   * Advances host_baseline_rev only when host promotion succeeds.
   */
  public advanceHostBaseline(rev: string): Readonly<RevisionPointers> {
    this.pointers.host_baseline_rev = rev;
    this.pointers.verified_preview_rev = rev;
    this.pointers.candidate_work_rev = rev;
    this.pointers.updatedAt = new Date().toISOString();
    this.saveToDb();
    return this.getPointers();
  }

  /**
   * Rolls back candidate_work_rev to match verified_preview_rev.
   */
  public rollbackCandidate(): Readonly<RevisionPointers> {
    this.pointers.candidate_work_rev = this.pointers.verified_preview_rev;
    this.pointers.updatedAt = new Date().toISOString();
    this.saveToDb();
    return this.getPointers();
  }
}
