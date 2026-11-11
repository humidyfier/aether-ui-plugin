import { ISqliteDatabase } from '../db';
import { ProjectBrief } from '../../models/brief.model';

export class BriefRepository {
  constructor(private db: ISqliteDatabase) {}

  public save(brief: ProjectBrief): void {
    const stmt = this.db.prepare(`
      INSERT INTO project_briefs (
        id, name, product_context, target_audience, primary_tasks,
        pages_and_content, ux_preferences, visual_preferences,
        implementation_constraints, practical_constraints,
        assumptions, questions, readiness, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        product_context = excluded.product_context,
        target_audience = excluded.target_audience,
        primary_tasks = excluded.primary_tasks,
        pages_and_content = excluded.pages_and_content,
        ux_preferences = excluded.ux_preferences,
        visual_preferences = excluded.visual_preferences,
        implementation_constraints = excluded.implementation_constraints,
        practical_constraints = excluded.practical_constraints,
        assumptions = excluded.assumptions,
        questions = excluded.questions,
        readiness = excluded.readiness,
        version = excluded.version,
        updated_at = excluded.updated_at
    `);

    stmt.run([
      brief.id,
      brief.name,
      brief.productContext,
      JSON.stringify(brief.targetAudience || []),
      JSON.stringify(brief.primaryTasks || []),
      JSON.stringify(brief.pagesAndContent || []),
      JSON.stringify(brief.uxPreferences || {}),
      JSON.stringify(brief.visualPreferences || {}),
      JSON.stringify(brief.implementationConstraints || {}),
      JSON.stringify(brief.practicalConstraints || {}),
      JSON.stringify(brief.assumptions || []),
      JSON.stringify(brief.questions || []),
      JSON.stringify(brief.readiness || {}),
      brief.version,
      brief.createdAt,
      brief.updatedAt,
    ]);
  }

  public findById(id: string): ProjectBrief | null {
    const row = this.db.prepare('SELECT * FROM project_briefs WHERE id = ?').get(id);
    if (!row) return null;
    return this.mapRow(row);
  }

  public getLatest(): ProjectBrief | null {
    const row = this.db.prepare('SELECT * FROM project_briefs ORDER BY updated_at DESC LIMIT 1').get();
    if (!row) return null;
    return this.mapRow(row);
  }

  public listAll(): ProjectBrief[] {
    const rows = this.db.prepare('SELECT * FROM project_briefs ORDER BY updated_at DESC').all();
    return rows.map((r) => this.mapRow(r));
  }

  public delete(id: string): boolean {
    const res = this.db.prepare('DELETE FROM project_briefs WHERE id = ?').run(id);
    return res.changes > 0;
  }

  private mapRow(row: any): ProjectBrief {
    return {
      id: row.id,
      name: row.name,
      productContext: row.product_context,
      targetAudience: JSON.parse(row.target_audience),
      primaryTasks: JSON.parse(row.primary_tasks),
      pagesAndContent: JSON.parse(row.pages_and_content),
      uxPreferences: JSON.parse(row.ux_preferences),
      visualPreferences: JSON.parse(row.visual_preferences),
      implementationConstraints: JSON.parse(row.implementation_constraints),
      practicalConstraints: JSON.parse(row.practical_constraints),
      assumptions: JSON.parse(row.assumptions),
      questions: JSON.parse(row.questions),
      readiness: JSON.parse(row.readiness),
      version: Number(row.version),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
