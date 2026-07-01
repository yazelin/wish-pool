-- 站方示範:owner 真專案當已實現案例(0 假票、站方署名、note 標明示範)。一次性 seed,勿重複執行。
INSERT INTO wishes (title, problem, current, desired, who, nickname, status, votes, created_at) VALUES
 ('想要一個台灣風的滾物成球 3D 網頁遊戲', '想玩到有台灣在地感的 Katamari', '只有日本場景的版本', '滾遍台灣各城市地標的網頁遊戲', '想放鬆的人', '站方示範', 'done', 0, 1782912266),
 ('用 AI 描述就自動建 3D 模型並即時預覽', '不會 CAD 但想快速做 3D 原型', '手動建模很慢', '打字描述 → AI 生 FreeCAD 腳本 → three.js 即時看', '想做 3D 原型的人', '站方示範', 'done', 0, 1782912366),
 ('騎機車衝真實股價 K 線的網頁小遊戲', '想用好玩的方式看股價走勢', '看 K 線圖很枯燥', '把 K 線變成賽道,騎車衝上去', '對股市有興趣的人', '站方示範', 'done', 0, 1782912466);

INSERT INTO answers (wish_id, repo_url, note, github_handle, votes, status, created_at) VALUES
 ((SELECT id FROM wishes WHERE title LIKE '%滾物成球%'), 'https://github.com/yazelin/roll-formosa', '站方示範:這個願望已由 roll-formosa 實現', 'yazelin', 0, 'visible', 1782912276),
 ((SELECT id FROM wishes WHERE title LIKE '%自動建 3D 模型%'), 'https://github.com/yazelin/cad-agent', '站方示範:由 cad-agent 實現', 'yazelin', 0, 'visible', 1782912376),
 ((SELECT id FROM wishes WHERE title LIKE '%K 線%'), 'https://github.com/yazelin/k-rider', '站方示範:由 k-rider 實現', 'yazelin', 0, 'visible', 1782912476);

UPDATE wishes SET accepted_answer_id = (SELECT id FROM answers WHERE wish_id = wishes.id LIMIT 1)
 WHERE nickname = '站方示範';
