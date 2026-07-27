-- 協力者 GitHub OAuth(issue #2):署名是否經 GitHub 驗證。
-- 既有資料一律 0 —— 就是現況「選填、未驗證的 handle」,沒有任何既有列被改寫。
-- 登入本身無狀態(state / session 都是 HMAC 簽章),所以不需要 sessions 表;
-- 投票去重也不加欄位:登入者的指紋直接寫成 `gh:<github_user_id>` 進既有的 votes / answer_votes。
ALTER TABLE answers ADD COLUMN handle_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE updates ADD COLUMN handle_verified INTEGER NOT NULL DEFAULT 0;
