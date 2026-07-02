-- 每則願望對應一條 GitHub Discussion(聚焦討論串)
ALTER TABLE wishes ADD COLUMN discussion_url TEXT;
