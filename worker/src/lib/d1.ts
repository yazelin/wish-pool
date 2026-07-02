export type NewWish = {
  title: string; problem?: string; current?: string; desired?: string
  who?: string; nickname?: string; status: string; open_questions: string[]
}
export type WishRow = {
  id: number; title: string; problem: string | null; current: string | null
  desired: string | null; who: string | null; nickname: string | null
  status: string; votes: number; created_at: number; accepted_answer_id: number | null
  echoes: number
}
export type Need = { id: number; type: string; body: string; resolved: number }
export type Update = { id: number; kind: string; body: string; github_handle: string | null; created_at: number }
export type Answer = { id: number; repo_url: string; note: string | null; github_handle: string | null; votes: number; status: string; created_at: number }
export type Wish = WishRow & {
  needs: Need[]
  updates: Update[]
  answers: Answer[]
  responses: { id: number; question_id: number | null; body: string; nickname: string | null; kind: string; created_at: number }[]
}

const PUBLIC_STATUSES = ['published', 'adopted', 'building', 'done']

export async function createWish(db: D1Database, w: NewWish, now: number): Promise<number> {
  const res = await db.prepare(
    `INSERT INTO wishes (title, problem, current, desired, who, nickname, status, votes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  ).bind(w.title, w.problem ?? null, w.current ?? null, w.desired ?? null,
         w.who ?? null, w.nickname ?? null, w.status, now).run()
  const id = res.meta.last_row_id as number
  for (const q of w.open_questions) {
    if (!q?.trim()) continue
    await db.prepare('INSERT INTO open_questions (wish_id, question) VALUES (?, ?)').bind(id, q).run()
    await db.prepare("INSERT INTO needs (wish_id, type, body) VALUES (?, 'info', ?)").bind(id, q).run()
  }
  return id
}

export async function listWishes(
  db: D1Database, opts: { sort: 'hot' | 'new'; limit: number; offset: number },
): Promise<WishRow[]> {
  const order = opts.sort === 'hot' ? 'votes DESC, created_at DESC' : 'created_at DESC'
  const marks = PUBLIC_STATUSES.map(() => '?').join(',')
  const { results } = await db.prepare(
    `SELECT *, (SELECT COUNT(*) FROM responses WHERE wish_id = wishes.id) AS echoes FROM wishes WHERE status IN (${marks}) ORDER BY ${order} LIMIT ? OFFSET ?`,
  ).bind(...PUBLIC_STATUSES, opts.limit, opts.offset).all<WishRow>()
  return results
}

export async function getWish(db: D1Database, id: number): Promise<Wish | null> {
  const row = await db.prepare('SELECT *, (SELECT COUNT(*) FROM responses WHERE wish_id = wishes.id) AS echoes FROM wishes WHERE id = ?').bind(id).first<WishRow>()
  if (!row) return null
  const q = await db.prepare('SELECT id, type, body, resolved FROM needs WHERE wish_id = ? ORDER BY id').bind(id).all<Need>()
  const u = await db.prepare('SELECT id, kind, body, github_handle, created_at FROM updates WHERE wish_id = ? ORDER BY id').bind(id).all<Update>()
  const a = await db.prepare("SELECT id, repo_url, note, github_handle, votes, status, created_at FROM answers WHERE wish_id = ? AND status = 'visible' ORDER BY votes DESC, created_at DESC").bind(id).all<Answer>()
  const r = await db.prepare('SELECT id, question_id, body, nickname, kind, created_at FROM responses WHERE wish_id = ? ORDER BY id').bind(id).all<Wish['responses'][number]>()
  return { ...row, needs: q.results, updates: u.results, answers: a.results, responses: r.results }
}

export async function wishExists(db: D1Database, id: number): Promise<boolean> {
  const row = await db.prepare('SELECT 1 AS x FROM wishes WHERE id = ?').bind(id).first<{ x: number }>()
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

export async function addResponse(
  db: D1Database, wishId: number,
  r: { body: string; nickname?: string; kind: 'answer' | 'metoo'; questionId?: number }, now: number,
): Promise<number> {
  const res = await db.prepare(
    'INSERT INTO responses (wish_id, question_id, body, nickname, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(wishId, r.questionId ?? null, r.body, r.nickname ?? null, r.kind, now).run()
  if (r.questionId) {
    await db.prepare('UPDATE needs SET resolved = 1 WHERE id = ? AND wish_id = ?').bind(r.questionId, wishId).run()
  }
  return res.meta.last_row_id as number
}

export async function listByStatus(db: D1Database, status: string): Promise<WishRow[]> {
  const { results } = await db.prepare('SELECT * FROM wishes WHERE status = ? ORDER BY created_at DESC').bind(status).all<WishRow>()
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
