import { ISqliteDatabase } from '../db';
import { UIConcept } from '../../models/ui.model';

export class UIRepository {
  constructor(private db: ISqliteDatabase) {}

  public save(concept: UIConcept): void {
    const stmt = this.db.prepare(`
      INSERT INTO ui_concepts (
        id, brief_id, ux_direction_id, name, style_approach,
        typography, palette, density, design_tokens,
        component_styles, responsive_rules, sample_screens,
        attributed_references, is_selected, user_overrides,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        style_approach = excluded.style_approach,
        typography = excluded.typography,
        palette = excluded.palette,
        density = excluded.density,
        design_tokens = excluded.design_tokens,
        component_styles = excluded.component_styles,
        responsive_rules = excluded.responsive_rules,
        sample_screens = excluded.sample_screens,
        attributed_references = excluded.attributed_references,
        is_selected = excluded.is_selected,
        user_overrides = excluded.user_overrides,
        updated_at = excluded.updated_at
    `);

    stmt.run([
      concept.id,
      concept.briefId,
      concept.uxDirectionId,
      concept.name,
      concept.styleApproach,
      JSON.stringify(concept.typography || {}),
      JSON.stringify(concept.palette || {}),
      JSON.stringify(concept.density || {}),
      JSON.stringify(concept.designTokens || {}),
      JSON.stringify(concept.componentStyles || {}),
      JSON.stringify(concept.responsiveRules || []),
      JSON.stringify(concept.sampleScreens || []),
      JSON.stringify(concept.attributedReferences || []),
      concept.isSelected ? 1 : 0,
      concept.userOverrides ? JSON.stringify(concept.userOverrides) : null,
      concept.createdAt,
      concept.updatedAt,
    ]);
  }

  public saveBatch(concepts: UIConcept[]): void {
    const tx = this.db.transaction(() => {
      for (const c of concepts) {
        this.save(c);
      }
    });
    tx();
  }

  public findById(id: string): UIConcept | null {
    const row = this.db.prepare('SELECT * FROM ui_concepts WHERE id = ?').get(id);
    if (!row) return null;
    return this.mapRow(row);
  }

  public listByBriefId(briefId: string): UIConcept[] {
    const rows = this.db.prepare('SELECT * FROM ui_concepts WHERE brief_id = ? ORDER BY created_at ASC').all(briefId);
    return rows.map((r) => this.mapRow(r));
  }

  public listByUXDirectionId(uxDirectionId: string): UIConcept[] {
    const rows = this.db.prepare('SELECT * FROM ui_concepts WHERE ux_direction_id = ? ORDER BY created_at ASC').all(uxDirectionId);
    return rows.map((r) => this.mapRow(r));
  }

  public getSelected(briefId: string): UIConcept | null {
    const row = this.db.prepare('SELECT * FROM ui_concepts WHERE brief_id = ? AND is_selected = 1 LIMIT 1').get(briefId);
    if (!row) return null;
    return this.mapRow(row);
  }

  public selectConcept(briefId: string, conceptId: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE ui_concepts SET is_selected = 0 WHERE brief_id = ?').run(briefId);
      this.db.prepare('UPDATE ui_concepts SET is_selected = 1, updated_at = ? WHERE id = ? AND brief_id = ?').run(
        new Date().toISOString(),
        conceptId,
        briefId
      );
    });
    tx();
  }

  public delete(id: string): boolean {
    const res = this.db.prepare('DELETE FROM ui_concepts WHERE id = ?').run(id);
    return res.changes > 0;
  }

  private mapRow(row: any): UIConcept {
    return {
      id: row.id,
      briefId: row.brief_id,
      uxDirectionId: row.ux_direction_id,
      name: row.name,
      styleApproach: row.style_approach,
      typography: JSON.parse(row.typography),
      palette: JSON.parse(row.palette),
      density: JSON.parse(row.density),
      designTokens: JSON.parse(row.design_tokens),
      componentStyles: JSON.parse(row.component_styles),
      responsiveRules: JSON.parse(row.responsive_rules),
      sampleScreens: JSON.parse(row.sample_screens),
      attributedReferences: JSON.parse(row.attributed_references),
      isSelected: Boolean(row.is_selected),
      userOverrides: row.user_overrides ? JSON.parse(row.user_overrides) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
