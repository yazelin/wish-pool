CREATE TABLE needs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wish_id INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  body TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wish_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  github_handle TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wish_id INTEGER NOT NULL,
  repo_url TEXT NOT NULL,
  note TEXT,
  github_handle TEXT,
  votes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'visible',
  created_at INTEGER NOT NULL
);
CREATE TABLE answer_votes (
  answer_id INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (answer_id, fingerprint)
);

ALTER TABLE wishes ADD COLUMN accepted_answer_id INTEGER;

CREATE INDEX idx_needs_wish ON needs(wish_id);
CREATE INDEX idx_updates_wish ON updates(wish_id);
CREATE INDEX idx_answers_wish ON answers(wish_id);

-- Migration: old open_questions -> needs(type=info). Keep open_questions table unchanged.
INSERT INTO needs (wish_id, type, body, resolved)
  SELECT wish_id, 'info', question, resolved FROM open_questions;
