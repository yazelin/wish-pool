-- 巢狀回覆(issue #7):留言可回覆留言,一層即可(reply-to-reply 在 API 層攤平掛回同一條頂層串)。
ALTER TABLE responses ADD COLUMN parent_id INTEGER;
CREATE INDEX idx_responses_parent ON responses(parent_id);

-- 許願者標記「這則回答解決了我的問題」——獨立於 needs.resolved(缺口自動已解,見 addResponse)。
ALTER TABLE responses ADD COLUMN is_solution INTEGER NOT NULL DEFAULT 0;
