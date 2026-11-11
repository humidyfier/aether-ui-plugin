import { ISqliteDatabase } from './db';

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_briefs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  product_context TEXT NOT NULL,
  target_audience TEXT NOT NULL,       -- JSON
  primary_tasks TEXT NOT NULL,         -- JSON
  pages_and_content TEXT NOT NULL,     -- JSON
  ux_preferences TEXT NOT NULL,        -- JSON
  visual_preferences TEXT NOT NULL,    -- JSON
  implementation_constraints TEXT NOT NULL, -- JSON
  practical_constraints TEXT NOT NULL, -- JSON
  assumptions TEXT NOT NULL,           -- JSON
  questions TEXT NOT NULL,             -- JSON
  readiness TEXT NOT NULL,             -- JSON
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ux_directions (
  id TEXT PRIMARY KEY,
  brief_id TEXT NOT NULL,
  title TEXT NOT NULL,
  approach TEXT NOT NULL,
  user_task_fit TEXT NOT NULL,
  page_structure TEXT NOT NULL,        -- JSON
  interaction_flow TEXT NOT NULL,      -- JSON
  strengths TEXT NOT NULL,             -- JSON
  trade_offs TEXT NOT NULL,            -- JSON
  assumptions TEXT NOT NULL,           -- JSON
  recommendation_rationale TEXT,
  is_recommended INTEGER NOT NULL DEFAULT 0,
  is_selected INTEGER NOT NULL DEFAULT 0,
  user_notes TEXT,
  combined_from_ids TEXT,              -- JSON
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (brief_id) REFERENCES project_briefs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ux_directions_brief_id ON ux_directions(brief_id);

CREATE TABLE IF NOT EXISTS ui_concepts (
  id TEXT PRIMARY KEY,
  brief_id TEXT NOT NULL,
  ux_direction_id TEXT NOT NULL,
  name TEXT NOT NULL,
  style_approach TEXT NOT NULL,
  typography TEXT NOT NULL,            -- JSON
  palette TEXT NOT NULL,               -- JSON
  density TEXT NOT NULL,               -- JSON
  design_tokens TEXT NOT NULL,         -- JSON
  component_styles TEXT NOT NULL,      -- JSON
  responsive_rules TEXT NOT NULL,      -- JSON
  sample_screens TEXT NOT NULL,        -- JSON
  attributed_references TEXT NOT NULL, -- JSON
  is_selected INTEGER NOT NULL DEFAULT 0,
  user_overrides TEXT,                 -- JSON
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (brief_id) REFERENCES project_briefs(id) ON DELETE CASCADE,
  FOREIGN KEY (ux_direction_id) REFERENCES ux_directions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ui_concepts_brief ON ui_concepts(brief_id);
CREATE INDEX IF NOT EXISTS idx_ui_concepts_ux ON ui_concepts(ux_direction_id);

CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  parent_checkpoint_id TEXT,
  timestamp TEXT NOT NULL,
  message TEXT NOT NULL,
  author TEXT NOT NULL,
  merkle_root TEXT NOT NULL,
  total_files INTEGER NOT NULL,
  total_bytes INTEGER NOT NULL,
  manifest_version INTEGER NOT NULL,
  state_snapshot TEXT NOT NULL         -- JSON
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_merkle ON checkpoints(merkle_root);
CREATE INDEX IF NOT EXISTS idx_checkpoints_parent ON checkpoints(parent_checkpoint_id);

CREATE TABLE IF NOT EXISTS checkpoint_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checkpoint_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  last_modified_ms INTEGER NOT NULL,
  FOREIGN KEY (checkpoint_id) REFERENCES checkpoints(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_checkpoint_files_chk ON checkpoint_files(checkpoint_id);
CREATE INDEX IF NOT EXISTS idx_checkpoint_files_path ON checkpoint_files(relative_path);

CREATE TABLE IF NOT EXISTS quarantined_duplicates (
  uid TEXT PRIMARY KEY,
  status TEXT NOT NULL,                -- ACTIVE | RESOLVED
  detected_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  occurrences TEXT NOT NULL            -- JSON
);

CREATE TABLE IF NOT EXISTS state_transitions (
  id TEXT PRIMARY KEY,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  checkpoint_id TEXT,
  payload TEXT,                        -- JSON
  timestamp TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_state_transitions_time ON state_transitions(timestamp);

CREATE TABLE IF NOT EXISTS session_records (
  session_id TEXT PRIMARY KEY,
  stage TEXT NOT NULL DEFAULT 'IDLE',
  ux_generations_json TEXT NOT NULL DEFAULT '[]',
  ui_generations_json TEXT NOT NULL DEFAULT '[]',
  selected_ux_json TEXT,
  selected_ui_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export function initializeDatabaseSchema(db: ISqliteDatabase): void {
  db.exec(SCHEMA_SQL);

  // Check and apply migrations
  const existingMigration = db.prepare('SELECT version FROM schema_migrations WHERE version = 1').get();
  if (!existingMigration) {
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
      1,
      new Date().toISOString()
    );
  }
}
