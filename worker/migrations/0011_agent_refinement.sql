-- Agent-first iterative specification refinement (issue #31).
-- Keep wish lifecycle status (published/adopted/building/done) separate from spec maturity.
ALTER TABLE wishes ADD COLUMN refinement_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE wishes ADD COLUMN refinement_active_round_id INTEGER;

ALTER TABLE needs ADD COLUMN refinement_state TEXT NOT NULL DEFAULT 'open';
ALTER TABLE needs ADD COLUMN asked_of TEXT NOT NULL DEFAULT 'requester';
ALTER TABLE needs ADD COLUMN priority TEXT NOT NULL DEFAULT 'blocking';
ALTER TABLE needs ADD COLUMN parent_need_id INTEGER;
ALTER TABLE needs ADD COLUMN source_response_id INTEGER;
ALTER TABLE needs ADD COLUMN refinement_round_id INTEGER;
ALTER TABLE needs ADD COLUMN dedupe_key TEXT;
ALTER TABLE needs ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE needs ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE needs ADD COLUMN agent_token_id INTEGER;

ALTER TABLE responses ADD COLUMN refinement_round_id INTEGER;
ALTER TABLE responses ADD COLUMN basis TEXT;
ALTER TABLE responses ADD COLUMN confidence TEXT;
ALTER TABLE responses ADD COLUMN sources_json TEXT;
ALTER TABLE responses ADD COLUMN basis_response_id INTEGER;
ALTER TABLE responses ADD COLUMN mutation_key TEXT;

CREATE TABLE refinement_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wish_id INTEGER NOT NULL,
  actor_key TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  base_version INTEGER NOT NULL,
  resulting_version INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  decision TEXT,
  summary TEXT,
  checklist_json TEXT,
  spec_json TEXT,
  result_json TEXT,
  apply_token TEXT,
  apply_started_at INTEGER,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE (wish_id, actor_key, idempotency_key)
);

-- Legacy `resolved=1` mostly meant "someone answered". Only an explicitly selected
-- solution (or an admin-resolved need with no response) is promoted to resolved.
UPDATE needs SET refinement_state = CASE
  WHEN resolved = 0 THEN 'open'
  WHEN EXISTS (
    SELECT 1 FROM responses r
    WHERE r.wish_id = needs.wish_id AND r.question_id = needs.id AND r.is_solution = 1
  ) THEN 'resolved'
  WHEN EXISTS (
    SELECT 1 FROM responses r
    WHERE r.wish_id = needs.wish_id AND r.question_id = needs.id
  ) THEN 'answered'
  ELSE 'resolved'
END;

UPDATE needs SET source_response_id = (
  SELECT r.id FROM responses r
  WHERE r.wish_id = needs.wish_id AND r.question_id = needs.id
  ORDER BY r.is_solution DESC, r.id DESC LIMIT 1
);

UPDATE needs SET asked_of = CASE WHEN type = 'info' THEN 'requester' ELSE 'builder' END;

CREATE INDEX idx_needs_refinement ON needs(wish_id, refinement_state, priority);
CREATE INDEX idx_needs_parent ON needs(parent_need_id);
CREATE UNIQUE INDEX idx_needs_dedupe ON needs(wish_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX idx_refinement_rounds_wish ON refinement_rounds(wish_id, id DESC);
CREATE INDEX idx_refinement_rounds_status ON refinement_rounds(wish_id, status);
CREATE UNIQUE INDEX idx_responses_mutation_key ON responses(mutation_key) WHERE mutation_key IS NOT NULL;
