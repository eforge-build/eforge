// --- eforge:region schema-v1 ---
export const INITIAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS backlog_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  user_status TEXT NOT NULL CHECK (user_status IN ('candidate','planned','active','shipped','stale','superseded')),
  priority TEXT,
  source TEXT,
  created_at TEXT,
  updated_at TEXT,
  last_checked_at TEXT,
  stale_after TEXT,
  epic_ref TEXT,
  epic_id TEXT REFERENCES epics(id) ON DELETE SET NULL,
  frontmatter_json TEXT NOT NULL DEFAULT '{}',
  body_sha256 TEXT,
  record_sha256 TEXT,
  import_origin TEXT,
  import_path TEXT
);
CREATE INDEX IF NOT EXISTS idx_backlog_items_status ON backlog_items(user_status);
CREATE INDEX IF NOT EXISTS idx_backlog_items_updated ON backlog_items(updated_at);
CREATE INDEX IF NOT EXISTS idx_backlog_items_epic_ref ON backlog_items(epic_ref);
CREATE INDEX IF NOT EXISTS idx_backlog_items_epic_id ON backlog_items(epic_id);

CREATE TABLE IF NOT EXISTS backlog_item_tags (
  item_id TEXT NOT NULL REFERENCES backlog_items(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (item_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_backlog_item_tags_tag ON backlog_item_tags(tag);

CREATE TABLE IF NOT EXISTS backlog_item_sections (
  item_id TEXT NOT NULL REFERENCES backlog_items(id) ON DELETE CASCADE,
  section_name TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  content_sha256 TEXT,
  PRIMARY KEY (item_id, section_name)
);

CREATE TABLE IF NOT EXISTS epics (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  user_status TEXT NOT NULL CHECK (user_status IN ('candidate','planned','active','shipped','stale','superseded')),
  priority TEXT,
  source TEXT,
  created_at TEXT,
  updated_at TEXT,
  last_checked_at TEXT,
  stale_after TEXT,
  frontmatter_json TEXT NOT NULL DEFAULT '{}',
  body_sha256 TEXT,
  record_sha256 TEXT,
  import_origin TEXT,
  import_path TEXT
);
CREATE INDEX IF NOT EXISTS idx_epics_status ON epics(user_status);
CREATE INDEX IF NOT EXISTS idx_epics_updated ON epics(updated_at);

CREATE TABLE IF NOT EXISTS epic_tags (
  epic_id TEXT NOT NULL REFERENCES epics(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (epic_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_epic_tags_tag ON epic_tags(tag);

CREATE TABLE IF NOT EXISTS epic_sections (
  epic_id TEXT NOT NULL REFERENCES epics(id) ON DELETE CASCADE,
  section_name TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  content_sha256 TEXT,
  PRIMARY KEY (epic_id, section_name)
);

CREATE TABLE IF NOT EXISTS item_dependencies (
  item_id TEXT NOT NULL REFERENCES backlog_items(id) ON DELETE CASCADE,
  dependency_ref TEXT NOT NULL,
  dependency_kind TEXT NOT NULL DEFAULT 'depends-on',
  dependency_status TEXT NOT NULL DEFAULT 'unknown' CHECK (dependency_status IN ('unknown','open','closed','external','missing')),
  resolved_dependency_item_id TEXT REFERENCES backlog_items(id) ON DELETE SET NULL,
  source_path TEXT,
  diagnostic_json TEXT,
  PRIMARY KEY (item_id, dependency_ref)
);
CREATE INDEX IF NOT EXISTS idx_item_dependencies_ref ON item_dependencies(dependency_ref);
CREATE INDEX IF NOT EXISTS idx_item_dependencies_resolved ON item_dependencies(resolved_dependency_item_id);

CREATE TABLE IF NOT EXISTS recommendation_runs (
  run_id TEXT PRIMARY KEY,
  source_fingerprint TEXT,
  created_at TEXT,
  applied_at TEXT,
  last_refreshed_by TEXT,
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0,1)),
  raw_model_json TEXT,
  summary_json TEXT,
  freshness_json TEXT,
  import_origin TEXT,
  import_path TEXT
);
CREATE INDEX IF NOT EXISTS idx_recommendation_runs_current ON recommendation_runs(is_current);

CREATE TABLE IF NOT EXISTS recommendation_lanes (
  lane_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES recommendation_runs(run_id) ON DELETE CASCADE,
  lane_kind TEXT NOT NULL CHECK (lane_kind IN ('activeWork','readyCandidates','recommendedNextSequence','safeParallelizableGroup','blockedChain')),
  lane_ref TEXT NOT NULL DEFAULT '',
  title TEXT,
  sequence INTEGER NOT NULL DEFAULT 0,
  profile TEXT,
  rationale TEXT,
  UNIQUE (run_id, lane_kind, lane_ref)
);
CREATE INDEX IF NOT EXISTS idx_recommendation_lanes_run_kind ON recommendation_lanes(run_id, lane_kind);

CREATE TABLE IF NOT EXISTS recommendation_lane_items (
  lane_id TEXT NOT NULL REFERENCES recommendation_lanes(lane_id) ON DELETE CASCADE,
  item_ref TEXT NOT NULL,
  item_id TEXT REFERENCES backlog_items(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('member','blocked','blocker')),
  sequence INTEGER,
  rationale TEXT,
  confidence REAL,
  PRIMARY KEY (lane_id, item_ref, role)
);
CREATE INDEX IF NOT EXISTS idx_recommendation_lane_items_ref ON recommendation_lane_items(item_ref);
CREATE INDEX IF NOT EXISTS idx_recommendation_lane_items_item ON recommendation_lane_items(item_id);

CREATE TABLE IF NOT EXISTS planning_tasks (
  task_id TEXT PRIMARY KEY,
  purpose TEXT,
  status_snapshot TEXT,
  source_fingerprint TEXT,
  requested_sections_json TEXT,
  selection_summary_json TEXT,
  compact_result_summary_json TEXT,
  raw_request_json TEXT,
  raw_result_json TEXT,
  raw_payload_prunable INTEGER NOT NULL DEFAULT 1 CHECK (raw_payload_prunable IN (0,1)),
  created_at TEXT,
  updated_at TEXT,
  applied_at TEXT,
  parent_task_id TEXT REFERENCES planning_tasks(task_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_planning_tasks_purpose ON planning_tasks(purpose);
CREATE INDEX IF NOT EXISTS idx_planning_tasks_source ON planning_tasks(source_fingerprint);
CREATE INDEX IF NOT EXISTS idx_planning_tasks_status ON planning_tasks(status_snapshot);

CREATE TABLE IF NOT EXISTS planning_task_items (task_id TEXT NOT NULL REFERENCES planning_tasks(task_id) ON DELETE CASCADE, item_ref TEXT NOT NULL, item_id TEXT REFERENCES backlog_items(id) ON DELETE SET NULL, role TEXT, sequence INTEGER, source_path TEXT, metadata_json TEXT, PRIMARY KEY (task_id, item_ref, role));
CREATE INDEX IF NOT EXISTS idx_planning_task_items_ref ON planning_task_items(item_ref);
CREATE INDEX IF NOT EXISTS idx_planning_task_items_item ON planning_task_items(item_id);
CREATE TABLE IF NOT EXISTS planning_task_epics (task_id TEXT NOT NULL REFERENCES planning_tasks(task_id) ON DELETE CASCADE, epic_ref TEXT NOT NULL, epic_id TEXT REFERENCES epics(id) ON DELETE SET NULL, role TEXT, sequence INTEGER, source_path TEXT, metadata_json TEXT, PRIMARY KEY (task_id, epic_ref, role));
CREATE INDEX IF NOT EXISTS idx_planning_task_epics_ref ON planning_task_epics(epic_ref);
CREATE INDEX IF NOT EXISTS idx_planning_task_epics_epic ON planning_task_epics(epic_id);
CREATE TABLE IF NOT EXISTS planning_task_recommendation_refs (task_id TEXT NOT NULL REFERENCES planning_tasks(task_id) ON DELETE CASCADE, recommendation_ref TEXT NOT NULL, role TEXT, sequence INTEGER, source_path TEXT, metadata_json TEXT, PRIMARY KEY (task_id, recommendation_ref, role));
CREATE INDEX IF NOT EXISTS idx_planning_task_recommendation_refs_ref ON planning_task_recommendation_refs(recommendation_ref);

CREATE TABLE IF NOT EXISTS session_plans (
  session TEXT PRIMARY KEY,
  path TEXT,
  topic TEXT,
  status TEXT,
  planning_type TEXT,
  planning_depth TEXT,
  profile TEXT,
  agent_profile TEXT,
  eforge_session_id TEXT,
  submitted_at TEXT,
  created_at TEXT,
  updated_at TEXT,
  summary_text TEXT,
  artifact_body_hash TEXT,
  frontmatter_json TEXT NOT NULL DEFAULT '{}',
  readiness_summary_json TEXT,
  import_origin TEXT,
  import_path TEXT
);
CREATE INDEX IF NOT EXISTS idx_session_plans_status ON session_plans(status);
CREATE INDEX IF NOT EXISTS idx_session_plans_submitted ON session_plans(submitted_at);
CREATE INDEX IF NOT EXISTS idx_session_plans_updated ON session_plans(updated_at);

CREATE TABLE IF NOT EXISTS session_plan_items (session TEXT NOT NULL REFERENCES session_plans(session) ON DELETE CASCADE, item_ref TEXT NOT NULL, item_id TEXT REFERENCES backlog_items(id) ON DELETE SET NULL, role TEXT NOT NULL, provenance TEXT NOT NULL, source_task_id TEXT, source_recommendation_ref TEXT, promoted_at TEXT, sequence INTEGER, PRIMARY KEY (session, item_ref, role, provenance));
CREATE INDEX IF NOT EXISTS idx_session_plan_items_ref ON session_plan_items(item_ref);
CREATE INDEX IF NOT EXISTS idx_session_plan_items_item ON session_plan_items(item_id);
CREATE INDEX IF NOT EXISTS idx_session_plan_items_recommendation ON session_plan_items(source_recommendation_ref);
CREATE TABLE IF NOT EXISTS session_plan_epics (session TEXT NOT NULL REFERENCES session_plans(session) ON DELETE CASCADE, epic_ref TEXT NOT NULL, epic_id TEXT REFERENCES epics(id) ON DELETE SET NULL, role TEXT NOT NULL, provenance TEXT NOT NULL, source_task_id TEXT, source_recommendation_ref TEXT, promoted_at TEXT, sequence INTEGER, PRIMARY KEY (session, epic_ref, role, provenance));
CREATE INDEX IF NOT EXISTS idx_session_plan_epics_ref ON session_plan_epics(epic_ref);
CREATE INDEX IF NOT EXISTS idx_session_plan_epics_epic ON session_plan_epics(epic_id);

CREATE TABLE IF NOT EXISTS queue_prds (prd_id TEXT PRIMARY KEY, session TEXT REFERENCES session_plans(session) ON DELETE SET NULL, source_id TEXT, source_path TEXT, external_ref TEXT, status TEXT, created_at TEXT, updated_at TEXT, submitted_at TEXT, status_summary TEXT, error_summary TEXT, import_fingerprint TEXT);
CREATE INDEX IF NOT EXISTS idx_queue_prds_session ON queue_prds(session); CREATE INDEX IF NOT EXISTS idx_queue_prds_status ON queue_prds(status);
CREATE TABLE IF NOT EXISTS build_runs (run_id TEXT PRIMARY KEY, session TEXT REFERENCES session_plans(session) ON DELETE SET NULL, queue_prd_id TEXT REFERENCES queue_prds(prd_id) ON DELETE SET NULL, build_session_id TEXT, status TEXT, started_at TEXT, finished_at TEXT, plan_set TEXT, cwd TEXT, status_summary TEXT, error_summary TEXT, import_fingerprint TEXT);
CREATE INDEX IF NOT EXISTS idx_build_runs_session ON build_runs(session); CREATE INDEX IF NOT EXISTS idx_build_runs_queue ON build_runs(queue_prd_id); CREATE INDEX IF NOT EXISTS idx_build_runs_status ON build_runs(status);
CREATE TABLE IF NOT EXISTS build_sessions (build_session_id TEXT PRIMARY KEY, session TEXT REFERENCES session_plans(session) ON DELETE SET NULL, status TEXT, started_at TEXT, finished_at TEXT, status_summary TEXT, error_summary TEXT, import_fingerprint TEXT);
CREATE INDEX IF NOT EXISTS idx_build_sessions_session ON build_sessions(session); CREATE INDEX IF NOT EXISTS idx_build_sessions_status ON build_sessions(status);
CREATE TABLE IF NOT EXISTS landing_links (landing_id TEXT PRIMARY KEY, session TEXT REFERENCES session_plans(session) ON DELETE SET NULL, item_id TEXT REFERENCES backlog_items(id) ON DELETE SET NULL, queue_prd_id TEXT REFERENCES queue_prds(prd_id) ON DELETE SET NULL, run_id TEXT REFERENCES build_runs(run_id) ON DELETE SET NULL, build_session_id TEXT REFERENCES build_sessions(build_session_id) ON DELETE SET NULL, status TEXT, pr_url TEXT, feature_branch TEXT, commit_sha TEXT, merge_ref TEXT, created_at TEXT, completed_at TEXT, summary_json TEXT);
CREATE INDEX IF NOT EXISTS idx_landing_links_session ON landing_links(session); CREATE INDEX IF NOT EXISTS idx_landing_links_status ON landing_links(status); CREATE INDEX IF NOT EXISTS idx_landing_links_item ON landing_links(item_id); CREATE INDEX IF NOT EXISTS idx_landing_links_pr ON landing_links(pr_url); CREATE INDEX IF NOT EXISTS idx_landing_links_branch ON landing_links(feature_branch); CREATE INDEX IF NOT EXISTS idx_landing_links_commit ON landing_links(commit_sha);

CREATE TABLE IF NOT EXISTS lifecycle_events (event_key TEXT PRIMARY KEY, event_type TEXT NOT NULL, timestamp TEXT, session TEXT, run_id TEXT, build_session_id TEXT, queue_prd_id TEXT, landing_id TEXT, affected_item_refs_json TEXT NOT NULL DEFAULT '[]', payload_json TEXT, payload_prunable INTEGER NOT NULL DEFAULT 1 CHECK (payload_prunable IN (0,1)), source_fingerprint TEXT);
CREATE INDEX IF NOT EXISTS idx_lifecycle_events_session ON lifecycle_events(session); CREATE INDEX IF NOT EXISTS idx_lifecycle_events_run ON lifecycle_events(run_id);
CREATE TABLE IF NOT EXISTS lifecycle_evidence (evidence_key TEXT PRIMARY KEY, item_id TEXT REFERENCES backlog_items(id) ON DELETE CASCADE, item_ref TEXT NOT NULL, session TEXT REFERENCES session_plans(session) ON DELETE SET NULL, planning_task_id TEXT REFERENCES planning_tasks(task_id) ON DELETE SET NULL, queue_prd_id TEXT REFERENCES queue_prds(prd_id) ON DELETE SET NULL, run_id TEXT REFERENCES build_runs(run_id) ON DELETE SET NULL, build_session_id TEXT REFERENCES build_sessions(build_session_id) ON DELETE SET NULL, landing_id TEXT REFERENCES landing_links(landing_id) ON DELETE SET NULL, source_event_key TEXT REFERENCES lifecycle_events(event_key) ON DELETE SET NULL, lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('none','planned','active','submitted','queued','build','pr-open','merged','shipped','failed','partial')), reason_code TEXT, evidence_kind TEXT, status TEXT, is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1)), is_terminal INTEGER NOT NULL DEFAULT 0 CHECK (is_terminal IN (0,1)), occurred_at TEXT, superseded_at TEXT, summary TEXT, links_json TEXT, retained_summary_json TEXT);
CREATE INDEX IF NOT EXISTS idx_lifecycle_evidence_current_item ON lifecycle_evidence(item_id, is_current); CREATE INDEX IF NOT EXISTS idx_lifecycle_evidence_state ON lifecycle_evidence(lifecycle_state); CREATE INDEX IF NOT EXISTS idx_lifecycle_evidence_session ON lifecycle_evidence(session); CREATE INDEX IF NOT EXISTS idx_lifecycle_evidence_queue ON lifecycle_evidence(queue_prd_id); CREATE INDEX IF NOT EXISTS idx_lifecycle_evidence_run ON lifecycle_evidence(run_id); CREATE INDEX IF NOT EXISTS idx_lifecycle_evidence_build_session ON lifecycle_evidence(build_session_id); CREATE INDEX IF NOT EXISTS idx_lifecycle_evidence_landing ON lifecycle_evidence(landing_id); CREATE INDEX IF NOT EXISTS idx_lifecycle_evidence_event ON lifecycle_evidence(source_event_key);

CREATE TABLE IF NOT EXISTS store_maintenance_runs (run_id TEXT PRIMARY KEY, categories_json TEXT, started_at TEXT, finished_at TEXT, pruned_counts_json TEXT, archived_counts_json TEXT, preserved_evidence_counts_json TEXT, status TEXT, error_summary TEXT);

CREATE TABLE IF NOT EXISTS search_documents (document_type TEXT NOT NULL CHECK (document_type IN ('backlog_item','epic','session_plan','recommendation')), document_id TEXT NOT NULL, title TEXT, tags_text TEXT, summary_text TEXT, body_text TEXT, item_ids_text TEXT, epic_ids_text TEXT, recommendation_refs_text TEXT, source_sha256 TEXT, updated_at TEXT, dirty INTEGER NOT NULL DEFAULT 0 CHECK (dirty IN (0,1)), PRIMARY KEY (document_type, document_id));
CREATE VIRTUAL TABLE IF NOT EXISTS search_documents_fts USING fts5(document_type UNINDEXED, document_id UNINDEXED, title, tags_text, summary_text, body_text, item_ids_text, epic_ids_text, recommendation_refs_text);
CREATE TABLE IF NOT EXISTS search_index_state (id INTEGER PRIMARY KEY CHECK (id = 1), dirty INTEGER NOT NULL DEFAULT 0 CHECK (dirty IN (0,1)), dirty_since TEXT, dirty_reason TEXT, last_rebuilt_at TEXT);
INSERT OR IGNORE INTO search_index_state (id, dirty) VALUES (1, 0);
CREATE TABLE IF NOT EXISTS search_index_dirty_records (document_type TEXT NOT NULL, document_id TEXT NOT NULL, reason TEXT, marked_at TEXT, PRIMARY KEY (document_type, document_id));
CREATE INDEX IF NOT EXISTS idx_search_dirty_records_marked ON search_index_dirty_records(marked_at);
`;
// --- eforge:endregion schema-v1 ---
