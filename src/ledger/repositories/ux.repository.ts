import { ISqliteDatabase } from '../db';
import { UXDirection } from '../../models/ux.model';

export class UXRepository {
  constructor(private db: ISqliteDatabase) {}

  public save(direction: UXDirection): void {
    const stmt = this.db.prepare(`
      INSERT INTO ux_directions (
        id, brief_id, title, approach, user_task_fit, page_structure,
        interaction_flow, strengths, trade_offs, assumptions,
        recommendation_rationale, is_recommended, is_selected,
        user_notes, combined_from_ids, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        approach = excluded.approach,
        user_task_fit = excluded.user_task_fit,
        page_structure = excluded.page_structure,
        interaction_flow = excluded.interaction_flow,
        strengths = excluded.strengths,
        trade_offs = excluded.trade_offs,
        assumptions = excluded.assumptions,
        recommendation_rationale = excluded.recommendation_rationale,
        is_recommended = excluded.is_recommended,
        is_selected = excluded.is_selected,
        user_notes = excluded.user_notes,
        combined_from_ids = excluded.combined_from_ids,
        updated_at = excluded.updated_at
    `);

    stmt.run([
      direction.id,
      direction.briefId,
      direction.title,
      direction.approach,
      direction.userTaskFit,
      JSON.stringify(direction.pageStructure || []),
      JSON.stringify(direction.interactionFlow || []),
      JSON.stringify(direction.strengths || []),
      JSON.stringify(direction.tradeOffs || []),
      JSON.stringify(direction.assumptions || []),
      direction.recommendationRationale || null,
      direction.isRecommended ? 1 : 0,
      direction.isSelected ? 1 : 0,
      direction.userNotes || null,
      direction.combinedFromIds ? JSON.stringify(direction.combinedFromIds) : null,
      direction.createdAt,
      direction.updatedAt,
    ]);
  }

  public saveBatch(directions: UXDirection[]): void {
    const tx = this.db.transaction(() => {
      for (const dir of directions) {
        this.save(dir);
      }
    });
    tx();
  }

  public findById(id: string): UXDirection | null {
    const row = this.db.prepare('SELECT * FROM ux_directions WHERE id = ?').get(id);
    if (!row) return null;
    return this.mapRow(row);
  }

  public listByBriefId(briefId: string): UXDirection[] {
    const rows = this.db.prepare('SELECT * FROM ux_directions WHERE brief_id = ? ORDER BY created_at ASC').all(briefId);
    return rows.map((r) => this.mapRow(r));
  }

  public getSelected(briefId: string): UXDirection | null {
    const row = this.db.prepare('SELECT * FROM ux_directions WHERE brief_id = ? AND is_selected = 1 LIMIT 1').get(briefId);
    if (!row) return null;
    return this.mapRow(row);
  }

  /**
   * Sets the selected direction and clears previous selections for this brief.
   */
  public selectDirection(briefId: string, directionId: string, notes?: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE ux_directions SET is_selected = 0 WHERE brief_id = ?').run(briefId);
      const updateStmt = this.db.prepare(`
        UPDATE ux_directions
        SET is_selected = 1, user_notes = COALESCE(?, user_notes), updated_at = ?
        WHERE id = ? AND brief_id = ?
      `);
      updateStmt.run(notes || null, new Date().toISOString(), directionId, briefId);
    });
    tx();
  }

  public delete(id: string): boolean {
    const res = this.db.prepare('DELETE FROM ux_directions WHERE id = ?').run(id);
    return res.changes > 0;
  }

  private mapRow(row: any): UXDirection {
    return {
      id: row.id,
      briefId: row.brief_id,
      title: row.title,
      approach: row.approach,
      userTaskFit: row.user_task_fit,
      pageStructure: JSON.parse(row.page_structure),
      interactionFlow: JSON.parse(row.interaction_flow),
      strengths: JSON.parse(row.strengths),
      tradeOffs: JSON.parse(row.trade_offs),
      assumptions: JSON.parse(row.assumptions),
      recommendationRationale: row.recommendation_rationale || undefined,
      isRecommended: Boolean(row.is_recommended),
      isSelected: Boolean(row.is_selected),
      userNotes: row.user_notes || undefined,
      combinedFromIds: row.combined_from_ids ? JSON.parse(row.combined_from_ids) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
