CREATE TABLE wishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  problem TEXT,
  current TEXT,
  desired TEXT,
  who TEXT,
  nickname TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  votes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE open_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wish_id INTEGER NOT NULL,
  question TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wish_id INTEGER NOT NULL,
  question_id INTEGER,
  body TEXT NOT NULL,
  nickname TEXT,
  kind TEXT NOT NULL DEFAULT 'answer',
  created_at INTEGER NOT NULL
);

CREATE TABLE votes (
  wish_id INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (wish_id, fingerprint)
);

CREATE TABLE rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL
);

CREATE INDEX idx_wishes_status ON wishes(status);
CREATE INDEX idx_open_questions_wish ON open_questions(wish_id);
CREATE INDEX idx_responses_wish ON responses(wish_id);
