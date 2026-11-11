import { ISqliteDatabase } from '../db';
import { StateTransitionEvent } from '../../models/state.model';

export class StateRepository {
  constructor(private db: ISqliteDatabase) {}

  public recordTransition(event: StateTransitionEvent): void {
    const stmt = this.db.prepare(`
      INSERT INTO state_transitions (id, from_state, to_state, action, actor, checkpoint_id, payload, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run([
      event.id,
      event.fromState,
      event.toState,
      event.action,
      event.actor,
      event.checkpointId || null,
      event.payload ? JSON.stringify(event.payload) : null,
      event.timestamp,
    ]);
  }

  public listRecent(limit = 100): StateTransitionEvent[] {
    const rows = this.db.prepare('SELECT * FROM state_transitions ORDER BY timestamp DESC LIMIT ?').all(limit);
    return rows.map((r: any) => ({
      id: r.id,
      fromState: r.from_state,
      toState: r.to_state,
      action: r.action,
      actor: r.actor,
      checkpointId: r.checkpoint_id || undefined,
      payload: r.payload ? JSON.parse(r.payload) : undefined,
      timestamp: r.timestamp,
    }));
  }

  public getLatest(): StateTransitionEvent | null {
    const row = this.db.prepare('SELECT * FROM state_transitions ORDER BY timestamp DESC LIMIT 1').get();
    if (!row) return null;
    return {
      id: row.id,
      fromState: row.from_state,
      toState: row.to_state,
      action: row.action,
      actor: row.actor,
      checkpointId: row.checkpoint_id || undefined,
      payload: row.payload ? JSON.parse(row.payload) : undefined,
      timestamp: row.timestamp,
    };
  }
}
