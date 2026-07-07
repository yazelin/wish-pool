-- 保存許願時與女神的前導對話(JSON messages 陣列:[{role:'user'|'assistant',content:string},...])。
-- 僅站主可見:只有 admin 端點回傳;公開端點的欄位白名單(WISH_PUBLIC_COLS)不含此欄。
ALTER TABLE wishes ADD COLUMN transcript TEXT;
