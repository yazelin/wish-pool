export type NewWish = {
  title: string; problem?: string; current?: string; desired?: string
  who?: string; nickname?: string; status: string; open_questions: string[]
}
export type WishRow = {
  id: number; title: string; problem: string | null; current: string | null
  desired: string | null; who: string | null; nickname: string | null
  status: string; votes: number; created_at: number
}
export type Need = { id: number; type: string; body: string; resolved: number }
export type Wish = WishRow & {
  needs: Need[]
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
    `SELECT * FROM wishes WHERE status IN (${marks}) ORDER BY ${order} LIMIT ? OFFSET ?`,
  ).bind(...PUBLIC_STATUSES, opts.limit, opts.offset).all<WishRow>()
  return results
}

export async function getWish(db: D1Database, id: number): Promise<Wish | null> {
  const row = await db.prepare('SELECT * FROM wishes WHERE id = ?').bind(id).first<WishRow>()
  if (!row) return null
  const q = await db.prepare('SELECT id, type, body, resolved FROM needs WHERE wish_id = ? ORDER BY id').bind(id).all<Need>()
  const r = await db.prepare('SELECT id, question_id, body, nickname, kind, created_at FROM responses WHERE wish_id = ? ORDER BY id').bind(id).all<Wish['responses'][number]>()
  return { ...row, needs: q.results, responses: r.results }
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
    await db.prepare('UPDATE open_questions SET resolved = 1 WHERE id = ? AND wish_id = ?').bind(r.questionId, wishId).run()
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
