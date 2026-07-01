-- 狗糧:移掉假的訂便當,把 wish-pool 自己的 roadmap 當真願望上牆(徵求中、站方署名、0 假票、附真 needs)
DELETE FROM votes WHERE wish_id = 1;
DELETE FROM needs WHERE wish_id = 1;
DELETE FROM open_questions WHERE wish_id = 1;
DELETE FROM responses WHERE wish_id = 1;
DELETE FROM answers WHERE wish_id = 1;
DELETE FROM wishes WHERE id = 1;

INSERT INTO wishes (title, problem, current, desired, who, nickname, status, votes, created_at) VALUES
 ('願望池要能「真的刪掉」或任何狀態都能隱藏', '現在 adopted 之後的願望拿不掉,也沒有硬刪除', 'owner 只能把 pending/published 設 hidden', '任何狀態都能隱藏 + 一個真正的刪除鈕(連 answers/needs/updates 一起清)', '站方管理,偶爾', '站方', 'published', 0, 1782915394),
 ('願望可以懸賞或贊助,讓「有錢出錢」成真', '想推的願望沒有誘因讓人動手做', '目前只能出力/出資訊,錢刻意還沒做', '願望上能標懸賞金額/贊助意願,結帳串金流', '想加速某願望的人', '站方', 'published', 0, 1782915494),
 ('自動找出「這個願望其實早就有人做過」的類似 repo', '有人許的願望可能已有現成 repo,只是不知道 URL', '只能靠社群手動在答案區指認', '送出願望時自動比對、推薦相似的既有願望/repo', '每個許願者', '站方', 'published', 0, 1782915594),
 ('協力者可用 GitHub 登入,票數與署名更乾淨', '協力者只留純文字 handle,票可被灌、署名不可信', '選填 GitHub handle(不驗證)+ 軟去重', 'GitHub OAuth 登入,真實身份、乾淨票數(許願者維持零登入)', '認真交實作的協力者', '站方', 'published', 0, 1782915694),
 ('有人交實作或更新進度時,通知許願者', '許願完就斷線,不知道自己的願望有沒有進展', '要自己回來看', '有答案/進度時通知(email 或其他),把人拉回來', '每個許願者', '站方', 'published', 0, 1782915794);

INSERT INTO needs (wish_id, type, body) VALUES
 ((SELECT id FROM wishes WHERE title LIKE '%真的刪掉%'), 'skill', '熟 Cloudflare Worker/D1 的人'),
 ((SELECT id FROM wishes WHERE title LIKE '%真的刪掉%'), 'info', '刪除要不要保留稽核記錄(soft 還是 hard delete)'),
 ((SELECT id FROM wishes WHERE title LIKE '%懸賞%'), 'skill', '金流串接(SHOPLINE 或 Stripe)'),
 ((SELECT id FROM wishes WHERE title LIKE '%懸賞%'), 'info', '結帳/退款/爭議怎麼處理'),
 ((SELECT id FROM wishes WHERE title LIKE '%早就有人做過%'), 'skill', 'embedding / 相似度搜尋'),
 ((SELECT id FROM wishes WHERE title LIKE '%早就有人做過%'), 'info', '只比站內願望,還是也爬外部 repo'),
 ((SELECT id FROM wishes WHERE title LIKE '%GitHub 登入%'), 'skill', 'Worker 端 GitHub OAuth'),
 ((SELECT id FROM wishes WHERE title LIKE '%GitHub 登入%'), 'info', '只協力者登入、許願者維持免登入的不對稱設計'),
 ((SELECT id FROM wishes WHERE title LIKE '%通知許願者%'), 'skill', 'Worker 端寄信 / 通知管道'),
 ((SELECT id FROM wishes WHERE title LIKE '%通知許願者%'), 'info', '用什麼管道(email 就要收 email、處理隱私)');
