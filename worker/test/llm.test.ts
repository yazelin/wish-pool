import { describe, it, expect } from 'vitest'
import { parseRefineResponse, parseReviewResponse } from '../src/lib/llm'

describe('parseRefineResponse', () => {
  it('parses an ask response', () => {
    const r = parseRefineResponse('{"mode":"ask","question":"這會給誰用?"}')
    expect(r).toEqual({ mode: 'ask', question: '這會給誰用?' })
  })

  it('parses a final response and coerces fields', () => {
    const r = parseRefineResponse(JSON.stringify({
      mode: 'final', title: 'X', problem: 'p', current: 'c', desired: 'd', who: 'w',
      open_questions: ['q1'], verdict: 'ok', verdict_reason: 'fine',
    }))
    expect(r.mode).toBe('final')
    if (r.mode === 'final') {
      expect(r.title).toBe('X')
      expect(r.open_questions).toEqual(['q1'])
      expect(r.verdict).toBe('ok')
    }
  })

  it('extracts JSON embedded in prose', () => {
    const r = parseRefineResponse('好的,這是結果:\n{"mode":"ask","question":"多久用一次?"}\n謝謝')
    expect(r).toEqual({ mode: 'ask', question: '多久用一次?' })
  })

  it('malformed JSON falls back to ask', () => {
    const r = parseRefineResponse('抱歉我壞了')
    expect(r.mode).toBe('ask')
  })

  it('unknown verdict coerced to review', () => {
    const r = parseRefineResponse(JSON.stringify({
      mode: 'final', title: 'X', open_questions: [], verdict: 'weird',
    }))
    if (r.mode === 'final') expect(r.verdict).toBe('review')
  })

  it('final missing a valid title falls through to ask (not a broken final)', () => {
    const r = parseRefineResponse(JSON.stringify({ mode: 'final', open_questions: [] }))
    expect(r.mode).toBe('ask')
    const blank = parseRefineResponse(JSON.stringify({ mode: 'final', title: '   ' }))
    expect(blank.mode).toBe('ask')
  })

  it('parses difficulty and gaps with whitelists', () => {
    const r = parseRefineResponse(JSON.stringify({
      mode: 'final', title: 'X', open_questions: [], verdict: 'ok', verdict_reason: '',
      difficulty: '大',
      gaps: [
        { type: 'resource', body: '全套美術素材需原創' },
        { type: 'weird', body: '不明型別落為 info' },
        { type: 'skill', body: '   ' },          // 空 body 要被丟掉
        'not-an-object',                          // 非物件要被丟掉
      ],
    }))
    expect(r.mode).toBe('final')
    if (r.mode === 'final') {
      expect(r.difficulty).toBe('大')
      expect(r.gaps).toEqual([
        { type: 'resource', body: '全套美術素材需原創' },
        { type: 'info', body: '不明型別落為 info' },
      ])
    }
  })

  it('parses notes when present', () => {
    const r = parseRefineResponse(JSON.stringify({
      mode: 'final', title: 'X', open_questions: [], verdict: 'ok', verdict_reason: '',
      notes: '理想使用情境:早上通勤時打開看一眼\n偏好:介面越少字越好',
    }))
    expect(r.mode).toBe('final')
    if (r.mode === 'final') expect(r.notes).toBe('理想使用情境:早上通勤時打開看一眼\n偏好:介面越少字越好')
  })

  it('missing notes -> empty string', () => {
    const r = parseRefineResponse(JSON.stringify({
      mode: 'final', title: 'X', open_questions: [], verdict: 'ok', verdict_reason: '',
    }))
    if (r.mode === 'final') expect(r.notes).toBe('')
  })

  it('difficulty outside whitelist coerced to empty; missing gaps -> []', () => {
    const r = parseRefineResponse(JSON.stringify({
      mode: 'final', title: 'X', open_questions: [], verdict: 'ok', verdict_reason: '', difficulty: 'XL',
    }))
    if (r.mode === 'final') {
      expect(r.difficulty).toBe('')
      expect(r.gaps).toEqual([])
    }
  })
})

describe('parseReviewResponse(伺服器端重審)', () => {
  it('parses ok verdict with reason', () => {
    expect(parseReviewResponse('{"verdict":"ok","reason":"原創作品願望"}'))
      .toEqual({ verdict: 'ok', reason: '原創作品願望' })
  })

  it('parses review verdict', () => {
    expect(parseReviewResponse('{"verdict":"review","reason":"堅持照搬原作素材"}').verdict).toBe('review')
  })

  it('extracts JSON embedded in prose', () => {
    expect(parseReviewResponse('判定如下:\n{"verdict":"ok","reason":"沒問題"}\n以上').verdict).toBe('ok')
  })

  it('garbage / non-JSON -> review(解析失敗一律當 review)', () => {
    expect(parseReviewResponse('抱歉我壞了').verdict).toBe('review')
  })

  it('unknown verdict -> review', () => {
    expect(parseReviewResponse('{"verdict":"maybe","reason":"?"}').verdict).toBe('review')
  })

  it('missing reason -> empty string; overlong reason capped at 500', () => {
    expect(parseReviewResponse('{"verdict":"ok"}').reason).toBe('')
    expect(parseReviewResponse(JSON.stringify({ verdict: 'review', reason: 'x'.repeat(600) })).reason.length).toBe(500)
  })
})
