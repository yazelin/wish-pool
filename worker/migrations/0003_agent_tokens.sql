-- 自助發放的 agent tokens(雜湊儲存、可個別撤銷、每枚有自己的限額 bucket)
CREATE TABLE agent_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  github_handle TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_agent_tokens_hash ON agent_tokens(token_hash);
