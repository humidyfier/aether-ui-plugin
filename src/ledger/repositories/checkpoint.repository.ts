import { ISqliteDatabase } from '../db';
import { Checkpoint, ManifestFileEntry, VersionManifest } from '../../models/checkpoint.model';

export class CheckpointRepository {
  constructor(private db: ISqliteDatabase) {}

  public save(checkpoint: Checkpoint): void {
    const tx = this.db.transaction(() => {
      // 1. Insert checkpoint header
      const stmt = this.db.prepare(`
        INSERT INTO checkpoints (
          id, parent_checkpoint_id, timestamp, message, author,
          merkle_root, total_files, total_bytes, manifest_version, state_snapshot
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run([
        checkpoint.id,
        checkpoint.parentCheckpointId || null,
        checkpoint.timestamp,
        checkpoint.message,
        checkpoint.author,
        checkpoint.merkleRoot,
        checkpoint.manifest.totalFiles,
        checkpoint.manifest.totalBytes,
        checkpoint.manifest.version,
        JSON.stringify(checkpoint.stateSnapshot),
      ]);

      // 2. Insert manifest file entries
      const fileStmt = this.db.prepare(`
        INSERT INTO checkpoint_files (
          checkpoint_id, relative_path, sha256, byte_size, last_modified_ms
        ) VALUES (?, ?, ?, ?, ?)
      `);

      for (const f of checkpoint.manifest.files) {
        fileStmt.run([
          checkpoint.id,
          f.relativePath,
          f.sha256,
          f.byteSize,
          f.lastModifiedMs,
        ]);
      }
    });

    tx();
  }

  public findById(id: string): Checkpoint | null {
    const row = this.db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(id);
    if (!row) return null;

    const fileRows = this.db.prepare(`
      SELECT relative_path, sha256, byte_size, last_modified_ms
      FROM checkpoint_files
      WHERE checkpoint_id = ?
      ORDER BY relative_path ASC
    `).all(id);

    const files: ManifestFileEntry[] = fileRows.map((r: any) => ({
      relativePath: r.relative_path,
      sha256: r.sha256,
      byteSize: Number(r.byte_size),
      lastModifiedMs: Number(r.last_modified_ms),
    }));

    const manifest: VersionManifest = {
      version: Number(row.manifest_version),
      merkleRoot: row.merkle_root,
      timestamp: row.timestamp,
      totalFiles: Number(row.total_files),
      totalBytes: Number(row.total_bytes),
      files,
    };

    return {
      id: row.id,
      parentCheckpointId: row.parent_checkpoint_id || null,
      timestamp: row.timestamp,
      message: row.message,
      author: row.author,
      stateSnapshot: JSON.parse(row.state_snapshot),
      manifest,
      merkleRoot: row.merkle_root,
    };
  }

  public getLatest(): Checkpoint | null {
    const row = this.db.prepare('SELECT id FROM checkpoints ORDER BY timestamp DESC LIMIT 1').get();
    if (!row) return null;
    return this.findById(row.id);
  }

  public listHistory(): Array<Omit<Checkpoint, 'manifest'> & { totalFiles: number; totalBytes: number }> {
    const rows = this.db.prepare('SELECT * FROM checkpoints ORDER BY timestamp DESC').all();
    return rows.map((r: any) => ({
      id: r.id,
      parentCheckpointId: r.parent_checkpoint_id || null,
      timestamp: r.timestamp,
      message: r.message,
      author: r.author,
      stateSnapshot: JSON.parse(r.state_snapshot),
      merkleRoot: r.merkle_root,
      totalFiles: Number(r.total_files),
      totalBytes: Number(r.total_bytes),
    }));
  }

  public delete(id: string): boolean {
    const res = this.db.prepare('DELETE FROM checkpoints WHERE id = ?').run(id);
    return res.changes > 0;
  }
}
