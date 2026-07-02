-- agent token 濫用判斷:領取 IP 雜湊、使用次數、寫入內容歸因
ALTER TABLE agent_tokens ADD COLUMN created_ip_hash TEXT;
ALTER TABLE agent_tokens ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE updates ADD COLUMN agent_token_id INTEGER;
ALTER TABLE answers ADD COLUMN agent_token_id INTEGER;
