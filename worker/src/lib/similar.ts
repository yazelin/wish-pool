// 「這個願望早就有人做過」自動媒合(issue #4)。
// 最懶可行:純字面相似度 —— CJK 相鄰雙字(bigram)+ ASCII 詞的 Dice 係數,零 AI API、零外部呼叫。
// MVP 只比站內既有公開願望(含已完成/已有實作者);外部 repo 搜尋留待未來。
// 只做推薦、絕不擋送出:route 端 try/catch,比對失敗照常收願望。

import { PUBLIC_STATUSES } from './d1'

export type SimilarWish = {
  id: number
  title: string
  status: string
  answers_count: number
  score: number
}

const CJK = /[㐀-䶿一-鿿]/

// 斷詞:ASCII 連續字母數字(小寫、長度>=2)各成一詞;CJK 連續段取相鄰雙字 bigram
// (中文不靠空白斷詞,bigram 是不用詞庫的最懶近似)。單獨一個 CJK 字的段落退回單字。
export function tokenize(text: string): Set<string> {
  const tokens = new Set<string>()
  for (const m of String(text).toLowerCase().matchAll(/[a-z0-9]+|[㐀-䶿一-鿿]+/g)) {
    const seg = m[0]
    if (CJK.test(seg)) {
      if (seg.length === 1) tokens.add(seg)
      for (let i = 0; i + 1 < seg.length; i++) tokens.add(seg.slice(i, i + 2))
    } else if (seg.length >= 2) {
      tokens.add(seg)
    }
  }
  return tokens
}

// Dice 係數:2·|A∩B| / (|A|+|B|),0..1;空集合視為不相似
export function diceSimilarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return (2 * inter) / (a.size + b.size)
}

// 推薦門檻與數量:分數 = max(標題對標題, 全文對全文) —— 標題短而準、全文抓「標題寫法不同但講同件事」;
// 門檻 0.25 是「大約 1/4 詞彙重疊」的保守線,寧漏勿吵。
export const SIMILAR_THRESHOLD = 0.25
export const SIMILAR_LIMIT = 3
const SCAN_LIMIT = 400 // 全掃站內公開願望的上限(池子是社群規模,足夠;超過再談索引)

type CandidateRow = {
  id: number; title: string; problem: string | null; desired: string | null
  status: string; answers_count: number
}

export function scoreSimilarity(
  input: { title: string; problem?: string; desired?: string },
  cand: { title: string; problem: string | null; desired: string | null },
): number {
  const titleScore = diceSimilarity(tokenize(input.title), tokenize(cand.title))
  const fullA = tokenize([input.title, input.problem ?? '', input.desired ?? ''].join(' '))
  const fullB = tokenize([cand.title, cand.problem ?? '', cand.desired ?? ''].join(' '))
  return Math.max(titleScore, diceSimilarity(fullA, fullB))
}

// 送出願望時呼叫:對站內既有公開願望全掃比對,回傳 top N 相似(分數高到低)。
export async function findSimilarWishes(
  db: D1Database,
  input: { title: string; problem?: string; desired?: string },
): Promise<SimilarWish[]> {
  const marks = PUBLIC_STATUSES.map(() => '?').join(',')
  const { results } = await db.prepare(
    `SELECT id, title, problem, desired, status,
       (SELECT COUNT(*) FROM answers WHERE wish_id = wishes.id AND status = 'visible') AS answers_count
     FROM wishes WHERE status IN (${marks}) ORDER BY created_at DESC LIMIT ?`,
  ).bind(...PUBLIC_STATUSES, SCAN_LIMIT).all<CandidateRow>()
  return results
    .map((r) => ({ id: r.id, title: r.title, status: r.status, answers_count: r.answers_count, score: Math.round(scoreSimilarity(input, r) * 100) / 100 }))
    .filter((s) => s.score >= SIMILAR_THRESHOLD)
    .sort((a, b) => b.score - a.score || b.answers_count - a.answers_count || a.id - b.id)
    .slice(0, SIMILAR_LIMIT)
}
