export type NewWish = {
  title: string; problem?: string; current?: string; desired?: string
  who?: string; nickname?: string; status: string; open_questions: string[]
  difficulty?: string
  gaps?: { type: string; body: string }[]
}
export type WishRow = {
  id: number; title: string; problem: string | null; current: string | null
  desired: string | null; who: string | null; nickname: string | null
  status: string; votes: number; created_at: number; accepted_answer_id: number | null
  echoes: number
  discussion_url: string | null
  difficulty: string | null
}
// 池面清單列:WishRow + 活動計數(站內通知「有新進展」徽章的資料來源,一次列表請求就能比對)
export type WishListRow = WishRow & { answers_count: number; updates_count: number; needs_open: number; needs_total: number }
export type Need = { id: number; type: string; body: string; resolved: number }
export type Update = { id: number; kind: string; body: string; github_handle: string | null; created_at: number }
export type Answer = { id: number; repo_url: string; note: string | null; github_handle: string | null; votes: number; status: string; created_at: number }
export type ResponseRow = {
  id: number; question_id: number | null; parent_id: number | null; is_solution: number
  body: string; nickname: string | null; kind: string; created_at: number
}
export type Wish = WishRow & {
  needs: Need[]
  updates: Update[]
  answers: Answer[]
  responses: ResponseRow[]
}

// 公開狀態白名單:清單、單筆、spec、公開寫入端點都用同一套口徑(issue #20)
export const PUBLIC_STATUSES = ['published', 'adopted', 'building', 'done']

// 公開端點的 wishes 欄位白名單:新增欄位(例如未來的通知 email)預設「不」外洩,
// 要公開必須進這串名單並過 notify.route.test 的欄位契約測試。
const WISH_PUBLIC_COLS = 'id, title, problem, current, desired, who, nickname, status, votes, created_at, accepted_answer_id, discussion_url, difficulty'

export async function createWish(db: D1Database, w: NewWish, now: number): Promise<number> {
  const res = await db.prepare(
    `INSERT INTO wishes (title, problem, current, desired, who, nickname, status, votes, created_at, difficulty)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).bind(w.title, w.problem ?? null, w.current ?? null, w.desired ?? null,
         w.who ?? null, w.nickname ?? null, w.status, now, w.difficulty || null).run()
  const id = res.meta.last_row_id as number
  for (const q of w.open_questions) {
    if (!q?.trim()) continue
    await db.prepare('INSERT INTO open_questions (wish_id, question) VALUES (?, ?)').bind(id, q).run()
    await db.prepare("INSERT INTO needs (wish_id, type, body) VALUES (?, 'info', ?)").bind(id, q).run()
  }
  for (const g of w.gaps ?? []) {
    if (!g || typeof g.body !== 'string' || !g.body.trim()) continue
    const t = ['info', 'skill', 'resource'].includes(g.type) ? g.type : 'info'
    await db.prepare('INSERT INTO needs (wish_id, type, body) VALUES (?, ?, ?)').bind(id, t, g.body.trim()).run()
  }
  return id
}

export async function listWishes(
  db: D1Database, opts: { sort: 'hot' | 'new'; limit: number; offset: number },
): Promise<WishListRow[]> {
  const order = opts.sort === 'hot' ? 'votes DESC, created_at DESC' : 'created_at DESC'
  const marks = PUBLIC_STATUSES.map(() => '?').join(',')
  // answers_count 只算 visible(與詳情頁一致),updates/responses 全算 —— 前端「有新進展」用同一套口徑比對
  const { results } = await db.prepare(
    `SELECT ${WISH_PUBLIC_COLS},
       (SELECT COUNT(*) FROM responses WHERE wish_id = wishes.id) AS echoes,
       (SELECT COUNT(*) FROM answers WHERE wish_id = wishes.id AND status = 'visible') AS answers_count,
       (SELECT COUNT(*) FROM updates WHERE wish_id = wishes.id) AS updates_count,
       (SELECT COUNT(*) FROM needs WHERE wish_id = wishes.id AND resolved = 0) AS needs_open,
       (SELECT COUNT(*) FROM needs WHERE wish_id = wishes.id) AS needs_total
     FROM wishes WHERE wishes.status IN (${marks}) ORDER BY ${order} LIMIT ? OFFSET ?`,
  ).bind(...PUBLIC_STATUSES, opts.limit, opts.offset).all<WishListRow>()
  return results
}

export async function getWish(db: D1Database, id: number): Promise<Wish | null> {
  const row = await db.prepare(`SELECT ${WISH_PUBLIC_COLS}, (SELECT COUNT(*) FROM responses WHERE wish_id = wishes.id) AS echoes FROM wishes WHERE id = ?`).bind(id).first<WishRow>()
  if (!row) return null
  const q = await db.prepare('SELECT id, type, body, resolved FROM needs WHERE wish_id = ? ORDER BY id').bind(id).all<Need>()
  const u = await db.prepare('SELECT id, kind, body, github_handle, created_at FROM updates WHERE wish_id = ? ORDER BY id').bind(id).all<Update>()
  const a = await db.prepare("SELECT id, repo_url, note, github_handle, votes, status, created_at FROM answers WHERE wish_id = ? AND status = 'visible' ORDER BY votes DESC, created_at DESC").bind(id).all<Answer>()
  const r = await db.prepare('SELECT id, question_id, parent_id, is_solution, body, nickname, kind, created_at FROM responses WHERE wish_id = ? ORDER BY id').bind(id).all<ResponseRow>()
  return { ...row, needs: q.results, updates: u.results, answers: a.results, responses: r.results }
}

// 公開端點用:非公開狀態(pending/hidden)視同不存在 → 404,不洩漏存在性。
// (原不分狀態的 wishExists 已移除,免得公開 route 誤用重開這個洞;後台讀單筆走 getWish。)
// 寫入端點也用這個,免得「對 hidden id 投票回 200」變成存在性探針。
export async function publicWishExists(db: D1Database, id: number): Promise<boolean> {
  const marks = PUBLIC_STATUSES.map(() => '?').join(',')
  const row = await db.prepare(`SELECT 1 AS x FROM wishes WHERE id = ? AND status IN (${marks})`)
    .bind(id, ...PUBLIC_STATUSES).first<{ x: number }>()
  return !!row
}

// 公開投票端點用:answer 要 visible 且所屬願望是公開狀態(admin 端仍走 answerExists 不受限)
export async function publicAnswerExists(db: D1Database, id: number): Promise<boolean> {
  const marks = PUBLIC_STATUSES.map(() => '?').join(',')
  const row = await db.prepare(
    `SELECT 1 AS x FROM answers a JOIN wishes w ON w.id = a.wish_id
     WHERE a.id = ? AND a.status = 'visible' AND w.status IN (${marks})`,
  ).bind(id, ...PUBLIC_STATUSES).first<{ x: number }>()
  return !!row
}

export async function addVote(
  db: D1Database, wishId: number, fingerprint: string, now: number,
): Promise<{ ok: boolean; votes: number }> {
  try {
    await db.prepare('INSERT INTO votes (wish_id, fingerprint, created_at) VALUES (?, ?, ?)')
      .bind(wishId, fingerprint, now).run()
  } catch (e) {
    // 只把 UNIQUE 主鍵衝突當「已投過」;其他錯誤照拋,避免真錯誤被誤報成重複投票。
    // ponytail: 軟去重上限:同 IP(NAT)會共用指紋,小社群可接受。
    if (!String((e as Error)?.message ?? e).includes('UNIQUE')) throw e
    const cur = await db.prepare('SELECT votes FROM wishes WHERE id = ?').bind(wishId).first<{ votes: number }>()
    return { ok: false, votes: cur?.votes ?? 0 }
  }
  const upd = await db.prepare('UPDATE wishes SET votes = votes + 1 WHERE id = ? RETURNING votes')
    .bind(wishId).first<{ votes: number }>()
  return { ok: true, votes: upd?.votes ?? 0 }
}

// 巢狀回覆(issue #7):只做一層 —— 回覆一則「回覆」時,攤平掛回它的頂層留言(同一條串),不長二層樓。
export async function addResponse(
  db: D1Database, wishId: number,
  r: { body: string; nickname?: string; kind: 'answer' | 'metoo'; questionId?: number; parentId?: number; agentTokenId?: number }, now: number,
): Promise<{ id: number; parentId: number | null; questionId: number | null }> {
  let parentId: number | null = null
  if (r.parentId) {
    const parent = await db.prepare('SELECT id, parent_id FROM responses WHERE id = ? AND wish_id = ?')
      .bind(r.parentId, wishId).first<{ id: number; parent_id: number | null }>()
    if (parent) parentId = parent.parent_id ?? parent.id
  }
  const questionId = r.questionId ?? null
  const res = await db.prepare(
    'INSERT INTO responses (wish_id, question_id, parent_id, body, nickname, kind, created_at, agent_token_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(wishId, questionId, parentId, r.body, r.nickname ?? null, r.kind, now, r.agentTokenId ?? null).run()
  if (questionId) {
    await db.prepare('UPDATE needs SET resolved = 1 WHERE id = ? AND wish_id = ?').bind(questionId, wishId).run()
  }
  return { id: res.meta.last_row_id as number, parentId, questionId }
}

// 許願者標記「這則回答解決了我的問題」——與 needs.resolved(缺口自動已解)各自獨立的欄位。
export async function getResponseWithWish(
  db: D1Database, id: number,
): Promise<{ id: number; wish_id: number; parent_id: number | null; question_id: number | null; is_solution: number } | null> {
  const row = await db.prepare('SELECT id, wish_id, parent_id, question_id, is_solution FROM responses WHERE id = ?')
    .bind(id).first<{ id: number; wish_id: number; parent_id: number | null; question_id: number | null; is_solution: number }>()
  return row ?? null
}
export async function setResponseSolution(db: D1Database, id: number, value: boolean): Promise<void> {
  await db.prepare('UPDATE responses SET is_solution = ? WHERE id = ?').bind(value ? 1 : 0, id).run()
}

export async function listByStatus(db: D1Database, status: string): Promise<WishRow[]> {
  const { results } = await db.prepare('SELECT * FROM wishes WHERE status = ? ORDER BY created_at DESC').bind(status).all<WishRow>()
  return results
}

// 後台卡片用:一句 SQL 帶齊「該不該進下一狀態」的決策訊號
export type AdminWishRow = WishRow & {
  needs_total: number; needs_open: number; claims: number; updates_count: number
  answers_count: number; top_answer_votes: number | null; last_update: string | null
}
export async function listByStatusAdmin(db: D1Database, status: string): Promise<AdminWishRow[]> {
  const { results } = await db.prepare(`SELECT w.*,
      (SELECT COUNT(*) FROM responses r WHERE r.wish_id = w.id) AS echoes,
      (SELECT COUNT(*) FROM needs n WHERE n.wish_id = w.id) AS needs_total,
      (SELECT COUNT(*) FROM needs n WHERE n.wish_id = w.id AND n.resolved = 0) AS needs_open,
      (SELECT COUNT(*) FROM updates u WHERE u.wish_id = w.id AND u.kind = 'claim') AS claims,
      (SELECT COUNT(*) FROM updates u WHERE u.wish_id = w.id) AS updates_count,
      (SELECT COUNT(*) FROM answers a WHERE a.wish_id = w.id AND a.status = 'visible') AS answers_count,
      (SELECT MAX(a.votes) FROM answers a WHERE a.wish_id = w.id AND a.status = 'visible') AS top_answer_votes,
      (SELECT u.kind || ':' || u.body FROM updates u WHERE u.wish_id = w.id ORDER BY u.id DESC LIMIT 1) AS last_update
    FROM wishes w WHERE w.status = ? ORDER BY w.created_at DESC`).bind(status).all<AdminWishRow>()
  return results
}

export async function setStatus(db: D1Database, id: number, status: string): Promise<void> {
  await db.prepare('UPDATE wishes SET status = ? WHERE id = ?').bind(status, id).run()
}

export async function exportAll(db: D1Database): Promise<Wish[]> {
  const { results } = await db.prepare('SELECT id FROM wishes ORDER BY created_at DESC').all<{ id: number }>()
  const out: Wish[] = []
  for (const { id } of results) {
    const w = await getWish(db, id)
    if (w) out.push(w)
  }
  return out
}

export async function createNeed(db: D1Database, wishId: number, type: string, body: string): Promise<number> {
  const t = ['info', 'skill', 'resource'].includes(type) ? type : 'info'
  const res = await db.prepare('INSERT INTO needs (wish_id, type, body) VALUES (?, ?, ?)').bind(wishId, t, body).run()
  return res.meta.last_row_id as number
}
export async function listNeeds(db: D1Database, wishId: number): Promise<Need[]> {
  const { results } = await db.prepare('SELECT id, type, body, resolved FROM needs WHERE wish_id = ? ORDER BY id').bind(wishId).all<Need>()
  return results
}
export async function resolveNeed(db: D1Database, id: number): Promise<void> {
  await db.prepare('UPDATE needs SET resolved = 1 WHERE id = ?').bind(id).run()
}

const UPDATE_KINDS = ['claim', 'progress', 'blocked']
export async function addUpdate(
  db: D1Database, wishId: number, u: { kind: string; body: string; github_handle?: string; agentTokenId?: number }, now: number,
): Promise<number> {
  const kind = UPDATE_KINDS.includes(u.kind) ? u.kind : 'progress'
  const res = await db.prepare('INSERT INTO updates (wish_id, kind, body, github_handle, created_at, agent_token_id) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(wishId, kind, u.body, u.github_handle ?? null, now, u.agentTokenId ?? null).run()
  return res.meta.last_row_id as number
}
export async function listUpdates(db: D1Database, wishId: number): Promise<Update[]> {
  const { results } = await db.prepare('SELECT id, kind, body, github_handle, created_at FROM updates WHERE wish_id = ? ORDER BY id').bind(wishId).all<Update>()
  return results
}

export async function createAnswer(
  db: D1Database, wishId: number, a: { repo_url: string; note?: string; github_handle?: string; agentTokenId?: number }, now: number,
): Promise<number> {
  const res = await db.prepare('INSERT INTO answers (wish_id, repo_url, note, github_handle, votes, status, created_at, agent_token_id) VALUES (?, ?, ?, ?, 0, ?, ?, ?)')
    .bind(wishId, a.repo_url, a.note ?? null, a.github_handle ?? null, 'visible', now, a.agentTokenId ?? null).run()
  return res.meta.last_row_id as number
}
export async function listAnswers(db: D1Database, wishId: number, opts: { includeHidden?: boolean } = {}): Promise<Answer[]> {
  const where = opts.includeHidden ? '' : "AND status = 'visible'"
  const { results } = await db.prepare(`SELECT id, repo_url, note, github_handle, votes, status, created_at FROM answers WHERE wish_id = ? ${where} ORDER BY votes DESC, created_at DESC`).bind(wishId).all<Answer>()
  return results
}
export async function addAnswerVote(db: D1Database, answerId: number, fingerprint: string, now: number): Promise<{ ok: boolean; votes: number }> {
  try {
    await db.prepare('INSERT INTO answer_votes (answer_id, fingerprint, created_at) VALUES (?, ?, ?)').bind(answerId, fingerprint, now).run()
  } catch (e) {
    // 只把 UNIQUE 主鍵衝突當「已投過」;其他錯誤照拋,避免真錯誤被誤報成重複投票。鏡射 addVote。
    if (!String((e as Error)?.message ?? e).includes('UNIQUE')) throw e
    const cur = await db.prepare('SELECT votes FROM answers WHERE id = ?').bind(answerId).first<{ votes: number }>()
    return { ok: false, votes: cur?.votes ?? 0 }
  }
  const upd = await db.prepare('UPDATE answers SET votes = votes + 1 WHERE id = ? RETURNING votes').bind(answerId).first<{ votes: number }>()
  return { ok: true, votes: upd?.votes ?? 0 }
}
export async function answerExists(db: D1Database, id: number): Promise<boolean> {
  const row = await db.prepare('SELECT 1 AS x FROM answers WHERE id = ?').bind(id).first<{ x: number }>()
  return !!row
}
export async function setAnswerStatus(db: D1Database, id: number, status: string): Promise<void> {
  const s = status === 'hidden' ? 'hidden' : 'visible'
  await db.prepare('UPDATE answers SET status = ? WHERE id = ?').bind(s, id).run()
}
export async function acceptAnswer(db: D1Database, wishId: number, answerId: number): Promise<void> {
  await db.prepare("UPDATE wishes SET accepted_answer_id = ?, status = 'done' WHERE id = ?").bind(answerId, wishId).run()
}
// 硬刪除:連子表一起清(表名來自固定陣列,非 user input)。
export async function deleteWish(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM answer_votes WHERE answer_id IN (SELECT id FROM answers WHERE wish_id = ?)').bind(id).run()
  for (const t of ['answers', 'updates', 'needs', 'votes', 'responses', 'open_questions']) {
    await db.prepare(`DELETE FROM ${t} WHERE wish_id = ?`).bind(id).run()
  }
  await db.prepare('DELETE FROM wishes WHERE id = ?').bind(id).run()
}

export async function setDiscussionUrl(db: D1Database, id: number, url: string): Promise<void> {
  await db.prepare('UPDATE wishes SET discussion_url = ? WHERE id = ?').bind(url, id).run()
}

// 自動狀態升級:社群熱度(幣+共鳴>=門檻)published->adopted;有人認領 published/adopted->building。
// done 不自動 —— 成真由站長「採用」把關(池規)。
export async function autoAdoptIfHot(db: D1Database, id: number, threshold = 3): Promise<{ promoted: boolean; discussion_url: string | null }> {
  const row = await db.prepare(
    `SELECT status, votes, discussion_url, (SELECT COUNT(*) FROM responses r WHERE r.wish_id = wishes.id) AS echoes FROM wishes WHERE id = ?`,
  ).bind(id).first<{ status: string; votes: number; discussion_url: string | null; echoes: number }>()
  if (!row || row.status !== 'published' || row.votes + row.echoes < threshold) return { promoted: false, discussion_url: null }
  await db.prepare("UPDATE wishes SET status = 'adopted' WHERE id = ? AND status = 'published'").bind(id).run()
  return { promoted: true, discussion_url: row.discussion_url }
}
export async function autoBuildOnClaim(db: D1Database, id: number): Promise<{ promoted: boolean; discussion_url: string | null }> {
  const row = await db.prepare('SELECT status, discussion_url FROM wishes WHERE id = ?').bind(id)
    .first<{ status: string; discussion_url: string | null }>()
  if (!row || !['published', 'adopted'].includes(row.status)) return { promoted: false, discussion_url: null }
  await db.prepare("UPDATE wishes SET status = 'building' WHERE id = ? AND status IN ('published','adopted')").bind(id).run()
  return { promoted: true, discussion_url: row.discussion_url }
}
