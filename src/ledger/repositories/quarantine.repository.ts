import { ISqliteDatabase } from '../db';
import { QuarantinedDuplicateRecord } from '../../models/ast.model';

export class QuarantineRepository {
  constructor(private db: ISqliteDatabase) {}

  public save(record: QuarantinedDuplicateRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO quarantined_duplicates (uid, status, detected_at, reason, occurrences)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(uid) DO UPDATE SET
        status = excluded.status,
        occurrences = excluded.occurrences,
        reason = excluded.reason
    `);

    stmt.run([
      record.uid,
      record.status,
      record.detectedAt,
      record.reason,
      JSON.stringify(record.occurrences),
    ]);
  }

  public findByUid(uid: string): QuarantinedDuplicateRecord | null {
    const row = this.db.prepare('SELECT * FROM quarantined_duplicates WHERE uid = ?').get(uid);
    if (!row) return null;
    return this.mapRow(row);
  }

  public listActive(): QuarantinedDuplicateRecord[] {
    const rows = this.db.prepare("SELECT * FROM quarantined_duplicates WHERE status = 'ACTIVE' ORDER BY detected_at DESC").all();
    return rows.map((r) => this.mapRow(r));
  }

  public listAll(): QuarantinedDuplicateRecord[] {
    const rows = this.db.prepare('SELECT * FROM quarantined_duplicates ORDER BY detected_at DESC').all();
    return rows.map((r) => this.mapRow(r));
  }

  public updateStatus(uid: string, status: 'ACTIVE' | 'RESOLVED'): void {
    this.db.prepare('UPDATE quarantined_duplicates SET status = ? WHERE uid = ?').run(status, uid);
  }

  private mapRow(row: any): QuarantinedDuplicateRecord {
    return {
      uid: row.uid,
      status: row.status,
      detectedAt: row.detected_at,
      reason: row.reason,
      occurrences: JSON.parse(row.occurrences),
    };
  }
}
