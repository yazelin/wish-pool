-- agent 代發留言的歸因(與 updates/answers 一致,供稽核/撤銷判斷)
ALTER TABLE responses ADD COLUMN agent_token_id INTEGER;
