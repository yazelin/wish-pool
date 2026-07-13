import { beforeEach, describe, expect, it } from 'vitest'
import { SELF, env, fetchMock } from 'cloudflare:test'

const O = 'https://test.local'
const JSON_H = { 'Content-Type': 'application/json', Origin: O }
const AGENT_H = { ...JSON_H, Authorization: 'Bearer test-agent-token' }
const CHECKLIST = {
  goal: true,
  users: true,
  mvp_scope: true,
  primary_flow: true,
  acceptance: true,
  constraints: true,
  safety: true,
}
const STRUCTURED_SPEC = {
  goal: '產生可驗證的結構化輸出',
  users: ['實作者'],
  mvp: { in_scope: ['JSON Schema 驗證'], out_of_scope: ['圖形化編輯器'] },
  primary_flow: ['輸入需求', '產生 JSON', '驗證 Schema'],
  requirements: [{ id: 'R1', description: '輸出固定 JSON', acceptance: ['輸出通過 Schema 驗證'] }],
  constraints: ['第一版只支援 JSON'],
  safety: [],
  assumptions: [],
}

beforeEach(async () => {
  for (const table of [
    'refinement_rounds', 'answer_votes', 'answers', 'updates', 'needs', 'responses',
    'open_questions', 'votes', 'wishes', 'rate_limits',
  ]) await env.DB.exec(`DELETE FROM ${table}`)
  fetchMock.activate()
  fetchMock.disableNetConnect()
})

async function seed(status = 'published') {
  const { createWish, createNeed } = await import('../src/lib/d1')
  const wishId = await createWish(env.DB, {
    title: '逐步規格', problem: '需求不完整', current: '靠聊天', desired: 'Agent 自己收斂',
    who: '實作者', status, open_questions: [],
  }, 100)
  const needId = await createNeed(env.DB, wishId, 'info', '核心輸出格式是什麼？', {
    askedOf: 'agent', priority: 'blocking', now: 101, bumpVersion: false,
  })
  return { wishId, needId }
}

function roundBody(needId: number, over: Record<string, unknown> = {}) {
  return {
    idempotency_key: 'run-1:round-1',
    base_version: 0,
    answers: [{
      need_id: needId,
      body: '輸出固定 JSON Schema。',
      state: 'resolved',
      basis: 'source',
      confidence: 'high',
      sources: ['https://example.com/schema'],
    }],
    followups: [{
      type: 'info',
      body: 'JSON Schema 的必要欄位有哪些？',
      asked_of: 'requester',
      priority: 'blocking',
      parent_need_id: needId,
    }],
    assessment: {
      decision: 'continue',
      summary: '輸出格式已定，必要欄位仍待確認。',
      checklist: CHECKLIST,
      spec: STRUCTURED_SPEC,
    },
    ...over,
  }
}

describe('GET /api/wishes/:id/refinement', () => {
  it('returns deterministic machine context and one next action', async () => {
    const { wishId, needId } = await seed()
    const res = await SELF.fetch(`${O}/api/wishes/${wishId}/refinement`)
    expect(res.status).toBe(200)
    const state = await res.json<any>()
    expect(state.protocol_version).toBe(1)
    expect(state.version).toBe(0)
    expect(state.spec_state).toBe('refining')
    expect(state.next_action).toEqual({ kind: 'research_need', need_id: needId })
    expect(state.needs[0]).toMatchObject({ id: needId, state: 'open', asked_of: 'agent', priority: 'blocking' })
    expect(state.needs[0]).not.toHaveProperty('agent_token_id')
    expect(state).not.toHaveProperty('actor_key')
  })

  it('pending/hidden and missing wishes are indistinguishable 404s', async () => {
    for (const status of ['pending', 'hidden']) {
      const { wishId } = await seed(status)
      const res = await SELF.fetch(`${O}/api/wishes/${wishId}/refinement`)
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'not_found' })
    }
    expect((await SELF.fetch(`${O}/api/wishes/999999/refinement`)).status).toBe(404)
  })
})

describe('POST /api/wishes/:id/refinement/rounds', () => {
  it('atomically answers, derives a follow-up, stores spec, and advances the version', async () => {
    const { wishId, needId } = await seed()
    const res = await SELF.fetch(`${O}/api/wishes/${wishId}/refinement/rounds`, {
      method: 'POST', headers: AGENT_H, body: JSON.stringify(roundBody(needId)),
    })
    expect(res.status).toBe(200)
    const result = await res.json<any>()
    expect(result).toMatchObject({ replayed: false, version: 1, spec_state: 'refining' })
    expect(result.answer_ids).toHaveLength(1)
    expect(result.followup_ids).toHaveLength(1)

    const state = await SELF.fetch(`${O}/api/wishes/${wishId}/refinement`).then((r) => r.json<any>())
    const original = state.needs.find((n: any) => n.id === needId)
    const followup = state.needs.find((n: any) => n.parent_need_id === needId)
    expect(original).toMatchObject({ state: 'resolved', source_response_id: result.answer_ids[0] })
    expect(original.answers[0]).toMatchObject({ basis: 'source', confidence: 'high', selected: true })
    expect(followup).toMatchObject({ state: 'open', asked_of: 'requester', source_response_id: result.answer_ids[0] })
    expect(state.structured_spec).toEqual(STRUCTURED_SPEC)
    expect(state.next_action).toEqual({ kind: 'ask_requester', need_id: followup.id })
    const publicWish = await SELF.fetch(`${O}/api/wishes/${wishId}`).then((r) => r.json<any>())
    expect(publicWish.echoes).toBe(0) // automated refinement is not a social-adoption signal
  })

  it('replays the same actor/key/body without duplicate rows', async () => {
    const { wishId, needId } = await seed()
    const call = () => SELF.fetch(`${O}/api/wishes/${wishId}/refinement/rounds`, {
      method: 'POST', headers: AGENT_H, body: JSON.stringify(roundBody(needId)),
    })
    const first = await call().then((r) => r.json<any>())
    const secondRes = await call()
    expect(secondRes.status).toBe(200)
    const second = await secondRes.json<any>()
    expect(second.replayed).toBe(true)
    expect(second.round_id).toBe(first.round_id)
    expect(second.answer_ids).toEqual(first.answer_ids)
    expect(second.followup_ids).toEqual(first.followup_ids)
    const state = await SELF.fetch(`${O}/api/wishes/${wishId}/refinement`).then((r) => r.json<any>())
    expect(state.version).toBe(1)
    expect(state.needs).toHaveLength(2)
  })

  it('rejects same key with another body and stale base versions with zero writes', async () => {
    const { wishId, needId } = await seed()
    const first = await SELF.fetch(`${O}/api/wishes/${wishId}/refinement/rounds`, {
      method: 'POST', headers: AGENT_H, body: JSON.stringify(roundBody(needId)),
    })
    expect(first.status).toBe(200)
    const conflict = roundBody(needId)
    ;(conflict.answers[0] as any).body = '另一個答案'
    const keyConflict = await SELF.fetch(`${O}/api/wishes/${wishId}/refinement/rounds`, {
      method: 'POST', headers: AGENT_H, body: JSON.stringify(conflict),
    })
    expect(keyConflict.status).toBe(409)
    expect(await keyConflict.json()).toEqual({ error: 'idempotency_conflict' })

    const stale = roundBody(needId, { idempotency_key: 'run-1:round-stale' })
    const staleRes = await SELF.fetch(`${O}/api/wishes/${wishId}/refinement/rounds`, {
      method: 'POST', headers: AGENT_H, body: JSON.stringify(stale),
    })
    expect(staleRes.status).toBe(409)
    expect(await staleRes.json()).toEqual({ error: 'stale_refinement', current_version: 1 })
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM responses WHERE wish_id = ?').bind(wishId).first<{ n: number }>()
    expect(count?.n).toBe(1)
  })

  it('lets only one of two concurrent rounds win the same base version', async () => {
    const { wishId, needId } = await seed()
    const make = (key: string, body: string) => roundBody(needId, {
      idempotency_key: key,
      answers: [{
        need_id: needId, body, state: 'resolved', basis: 'source', confidence: 'high',
        sources: ['https://example.com/concurrency'],
      }],
      followups: [],
    })
    const [a, b] = await Promise.all([
      SELF.fetch(`${O}/api/wishes/${wishId}/refinement/rounds`, {
        method: 'POST', headers: AGENT_H, body: JSON.stringify(make('race-a', 'A wins')),
      }),
      SELF.fetch(`${O}/api/wishes/${wishId}/refinement/rounds`, {
        method: 'POST', headers: AGENT_H, body: JSON.stringify(make('race-b', 'B wins')),
      }),
    ])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    const state = await SELF.fetch(`${O}/api/wishes/${wishId}/refinement`).then((r) => r.json<any>())
    expect(state.version).toBe(1)
    expect(state.needs[0].answers).toHaveLength(1)
    const committed = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM refinement_rounds WHERE wish_id = ? AND status IN ('applied','completed')",
    ).bind(wishId).first<{ n: number }>()
    expect(committed?.n).toBe(1)
  })

  it('does not duplicate rows when the same idempotency key is submitted concurrently', async () => {
    const { wishId, needId } = await seed()
    const body = roundBody(needId, { followups: [] })
    const call = () => SELF.fetch(`${O}/api/wishes/${wishId}/refinement/rounds`, {
      method: 'POST', headers: AGENT_H, body: JSON.stringify(body),
    })
    const [a, b] = await Promise.all([call(), call()])
    expect([a.status, b.status]).toContain(200)
    for (const response of [a, b]) {
      if (response.status === 409) expect((await response.json<any>()).error).toBe('round_in_progress')
    }
    const state = await SELF.fetch(`${O}/api/wishes/${wishId}/refinement`).then((r) => r.json<any>())
    expect(state.version).toBe(1)
    expect(state.needs[0].answers).toHaveLength(1)
    const rounds = await env.DB.prepare('SELECT COUNT(*) AS n FROM refinement_rounds WHERE wish_id = ?')
      .bind(wishId).first<{ n: number }>()
    expect(rounds?.n).toBe(1)
  })

  it('rejects cross-wish need ids and duplicate follow-ups without partial writes', async () => {
    const a = await seed()
    const b = await seed()
    const cross = roundBody(b.needId, { followups: [] })
    const crossRes = await SELF.fetch(`${O}/api/wishes/${a.wishId}/refinement/rounds`, {
      method: 'POST', headers: AGENT_H, body: JSON.stringify(cross),
    })
    expect(crossRes.status).toBe(400)
    expect(await crossRes.json()).toEqual({ error: 'need_not_in_wish' })

    const duplicate = roundBody(a.needId, {
      followups: [
        { type: 'info', body: '同一題？', asked_of: 'requester', priority: 'blocking', parent_need_id: a.needId },
        { type: 'info', body: '  同一題？  ', asked_of: 'requester', priority: 'important', parent_need_id: a.needId },
      ],
    })
    const dupRes = await SELF.fetch(`${O}/api/wishes/${a.wishId}/refinement/rounds`, {
      method: 'POST', headers: AGENT_H, body: JSON.stringify(duplicate),
    })
    expect(dupRes.status).toBe(409)
    expect(await dupRes.json()).toEqual({ error: 'duplicate_followup' })
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM responses WHERE wish_id = ?').bind(a.wishId).first<{ n: number }>()
    expect(count?.n).toBe(0)
  })

  it('keeps candidate answers separate from evidence-backed resolution', async () => {
    const { wishId, needId } = await seed()
    const candidate = roundBody(needId, {
      idempotency_key: 'candidate-1',
      answers: [{ need_id: needId, body: '建議先用 JSON。', state: 'answered', basis: 'decision', confidence: 'medium', sources: [] }],
      followups: [],
    })
    expect((await SELF.fetch(`${O}/api/wishes/${wishId}/refinement/rounds`, {
      method: 'POST', headers: AGENT_H, body: JSON.stringify(candidate),
    })).status).toBe(200)
    let state = await SELF.fetch(`${O}/api/wishes/${wishId}/refinement`).then((r) => r.json<any>())
    expect(state.needs[0].state).toBe('answered')
    expect(state.spec_state).toBe('refining')
    expect(state.next_action).toEqual({ kind: 'evaluate_answer', need_id: needId })
    const listed = await SELF.fetch(`${O}/api/wishes?sort=new`).then((r) => r.json<any>())
    expect(listed.wishes.find((wish: any) => wish.id === wishId).needs_open).toBe(1)

    const { addResponse } = await import('../src/lib/d1')
    const requester = await addResponse(env.DB, wishId, {
      body: '許願者確認使用 JSON。', nickname: '許願者', kind: 'answer', questionId: needId,
    }, 200)

    const confirm = roundBody(needId, {
      idempotency_key: 'candidate-2',
      base_version: 2,
      answers: [{
        need_id: needId, response_id: requester.id, body: '採用許願者的明確回答。',
        state: 'resolved', basis: 'requester', confidence: 'high', sources: [],
      }],
      followups: [],
      assessment: { decision: 'agent_ready', summary: '規格可動工。', checklist: CHECKLIST, spec: STRUCTURED_SPEC },
    })
    const confirmed = await SELF.fetch(`${O}/api/wishes/${wishId}/refinement/rounds`, {
      method: 'POST', headers: AGENT_H, body: JSON.stringify(confirm),
    })
    expect(confirmed.status).toBe(200)
    state = await SELF.fetch(`${O}/api/wishes/${wishId}/refinement`).then((r) => r.json<any>())
    expect(state.needs[0].state).toBe('resolved')
    expect(state.spec_state).toBe('ready')
    expect(state.implementation_ready).toBe(true)
  })

  it('requires a current agent_ready assessment and merges incremental spec patches', async () => {
    const { wishId, needId } = await seed()
    const draft = roundBody(needId, { followups: [] })
    const draftRes = await SELF.fetch(`${O}/api/wishes/${wishId}/refinement/rounds`, {
      method: 'POST', headers: AGENT_H, body: JSON.stringify(draft),
    })
    expect(draftRes.status).toBe(200)
    const draftResult = await draftRes.json<any>()
    expect(draftResult.spec_state).toBe('refining')
    expect(draftResult.next_action).toEqual({ kind: 'assess_readiness' })

    const ready = {
      idempotency_key: 'ready-after-draft',
      base_version: 1,
      assessment: {
        decision: 'agent_ready', summary: '完整規格通過伺服器 gate。', checklist: CHECKLIST,
        spec: { constraints: ['第二版才支援 XML'] },
      },
    }
    const readyRes = await SELF.fetch(`${O}/api/wishes/${wishId}/refinement/rounds`, {
      method: 'POST', headers: AGENT_H, body: JSON.stringify(ready),
    })
    expect(readyRes.status).toBe(200)
    const state = await SELF.fetch(`${O}/api/wishes/${wishId}/refinement`).then((r) => r.json<any>())
    expect(state.spec_state).toBe('ready')
    expect(state.structured_spec.goal).toBe(STRUCTURED_SPEC.goal)
    expect(state.structured_spec.constraints).toEqual(['第二版才支援 XML'])
  })

  it('does not downgrade an evidence-backed resolution when its legacy solution marker is toggled', async () => {
    const { wishId, needId } = await seed()
    const round = roundBody(needId, { followups: [] })
    const posted = await SELF.fetch(`${O}/api/wishes/${wishId}/refinement/rounds`, {
      method: 'POST', headers: AGENT_H, body: JSON.stringify(round),
    }).then((r) => r.json<any>())
    const responseId = posted.answer_ids[0]
    for (const value of [true, false]) {
      const res = await SELF.fetch(`${O}/api/responses/${responseId}/solve`, {
        method: 'POST', headers: AGENT_H, body: JSON.stringify({ value }),
      })
      expect(res.status).toBe(200)
    }
    const state = await SELF.fetch(`${O}/api/wishes/${wishId}/refinement`).then((r) => r.json<any>())
    expect(state.needs[0]).toMatchObject({ state: 'resolved', source_response_id: responseId })
  })

  it('allows ready_with_assumptions and separates spec from implementation readiness', async () => {
    const { createNeed } = await import('../src/lib/d1')
    const assumedSeed = await seed()
    await createNeed(env.DB, assumedSeed.wishId, 'resource', '需要正式 API key', {
      askedOf: 'builder', priority: 'blocking', now: 102, bumpVersion: false,
    })
    const assumed = roundBody(assumedSeed.needId, {
      answers: [{
        need_id: assumedSeed.needId, body: 'MVP 先採 JSON 作為明示假設。',
        state: 'assumed', basis: 'decision', confidence: 'medium', sources: [],
      }],
      followups: [],
      assessment: {
        decision: 'agent_ready', summary: '規格以明示假設收斂。', checklist: CHECKLIST,
        spec: {
          ...STRUCTURED_SPEC,
          assumptions: [{ need_id: assumedSeed.needId, statement: 'MVP 先採 JSON' }],
        },
      },
    })
    const res = await SELF.fetch(`${O}/api/wishes/${assumedSeed.wishId}/refinement/rounds`, {
      method: 'POST', headers: AGENT_H, body: JSON.stringify(assumed),
    })
    expect(res.status).toBe(200)
    const state = await SELF.fetch(`${O}/api/wishes/${assumedSeed.wishId}/refinement`).then((r) => r.json<any>())
    expect(state.spec_state).toBe('ready_with_assumptions')
    expect(state.spec_ready).toBe(true)
    expect(state.implementation_ready).toBe(false)
    expect(state.next_action.kind).toBe('plan_implementation_gap')

    const { addResponse } = await import('../src/lib/d1')
    const requester = await addResponse(env.DB, assumedSeed.wishId, {
      body: '許願者確認使用 JSON。', nickname: '許願者', kind: 'answer', questionId: assumedSeed.needId,
    }, 300)
    let revised = await SELF.fetch(`${O}/api/wishes/${assumedSeed.wishId}/refinement`).then((r) => r.json<any>())
    expect(revised.needs.find((need: any) => need.id === assumedSeed.needId).state).toBe('answered')
    const resolveAssumption = {
      idempotency_key: 'resolve-assumption',
      base_version: 2,
      answers: [{
        need_id: assumedSeed.needId, response_id: requester.id, body: '以許願者回答取代假設。',
        state: 'resolved', basis: 'requester', confidence: 'high', sources: [],
      }],
      assessment: {
        decision: 'agent_ready', summary: '假設已由許願者回答取代。', checklist: CHECKLIST,
        spec: { assumptions: [] },
      },
    }
    const staleAssumption = {
      ...resolveAssumption,
      idempotency_key: 'stale-assumption',
      assessment: {
        ...resolveAssumption.assessment,
        spec: {
          assumptions: [{ need_id: assumedSeed.needId, statement: '已被回答但仍殘留的舊假設' }],
        },
      },
    }
    const stale = await SELF.fetch(`${O}/api/wishes/${assumedSeed.wishId}/refinement/rounds`, {
      method: 'POST', headers: AGENT_H, body: JSON.stringify(staleAssumption),
    })
    expect(stale.status).toBe(409)
    expect(await stale.json<any>()).toMatchObject({ error: 'agent_ready_incomplete', missing: ['assumptions_content'] })

    const resolved = await SELF.fetch(`${O}/api/wishes/${assumedSeed.wishId}/refinement/rounds`, {
      method: 'POST', headers: AGENT_H, body: JSON.stringify(resolveAssumption),
    })
    expect(resolved.status).toBe(200)
    revised = await SELF.fetch(`${O}/api/wishes/${assumedSeed.wishId}/refinement`).then((r) => r.json<any>())
    expect(revised.spec_state).toBe('ready')
    expect(revised.structured_spec.assumptions).toEqual([])

    const invalidSeed = await seed()
    const resourceId = await createNeed(env.DB, invalidSeed.wishId, 'resource', '另一把 API key', {
      askedOf: 'builder', priority: 'blocking', now: 103, bumpVersion: false,
    })
    const invalidAssumption = roundBody(resourceId, {
      idempotency_key: 'resource-assumption', answers: [{
        need_id: resourceId, body: '假設有 key', state: 'assumed', basis: 'decision', confidence: 'medium', sources: [],
      }], followups: [],
    })
    const invalidRes = await SELF.fetch(`${O}/api/wishes/${invalidSeed.wishId}/refinement/rounds`, {
      method: 'POST', headers: AGENT_H, body: JSON.stringify(invalidAssumption),
    })
    expect(invalidRes.status).toBe(400)
    expect(await invalidRes.json()).toEqual({ error: 'non_info_assumption' })
  })

  it('honors an explicit needs_human stop assessment without pretending the spec is ready', async () => {
    const { wishId, needId } = await seed()
    const body = {
      idempotency_key: 'stop-1',
      base_version: 0,
      assessment: {
        decision: 'needs_human',
        summary: '缺少只能由許願者決定的偏好。',
        checklist: { ...CHECKLIST, mvp_scope: false },
      },
    }
    const res = await SELF.fetch(`${O}/api/wishes/${wishId}/refinement/rounds`, {
      method: 'POST', headers: AGENT_H, body: JSON.stringify(body),
    })
    expect(res.status).toBe(200)
    const result = await res.json<any>()
    expect(result.spec_state).toBe('needs_human')
    expect(result.next_action).toEqual({ kind: 'stop', reason: 'agent_assessment', action: 'needs_human' })

    const humanAnswer = await SELF.fetch(`${O}/api/wishes/${wishId}/responses`, {
      method: 'POST', headers: AGENT_H,
      body: JSON.stringify({ body: '許願者補充了輸出格式。', kind: 'answer', questionId: needId }),
    })
    expect(humanAnswer.status).toBe(200)
    const resumed = await SELF.fetch(`${O}/api/wishes/${wishId}/refinement`).then((r) => r.json<any>())
    expect(resumed.spec_state).toBe('refining')
    expect(resumed.next_action).toEqual({ kind: 'evaluate_answer', need_id: needId })
  })

  it('requires an agent token and rejects unsupported evidence claims', async () => {
    const { wishId, needId } = await seed()
    const noAuth = await SELF.fetch(`${O}/api/wishes/${wishId}/refinement/rounds`, {
      method: 'POST', headers: JSON_H, body: JSON.stringify(roundBody(needId)),
    })
    expect(noAuth.status).toBe(401)
    expect(await noAuth.json()).toEqual({ error: 'agent_token_required' })

    const weak = roundBody(needId)
    ;(weak.answers[0] as any).sources = []
    const weakRes = await SELF.fetch(`${O}/api/wishes/${wishId}/refinement/rounds`, {
      method: 'POST', headers: AGENT_H, body: JSON.stringify(weak),
    })
    expect(weakRes.status).toBe(400)
    expect(await weakRes.json()).toEqual({ error: 'source_url_required' })

    const noSpec = roundBody(needId)
    ;(noSpec.assessment as any).decision = 'agent_ready'
    delete (noSpec.assessment as any).spec
    const noSpecRes = await SELF.fetch(`${O}/api/wishes/${wishId}/refinement/rounds`, {
      method: 'POST', headers: AGENT_H, body: JSON.stringify(noSpec),
    })
    expect(noSpecRes.status).toBe(400)
    expect(await noSpecRes.json()).toEqual({ error: 'agent_ready_requires_spec' })

    const incomplete = roundBody(needId, {
      idempotency_key: 'incomplete-ready',
      answers: [], followups: [],
      assessment: { decision: 'agent_ready', summary: '錯誤宣告。', checklist: CHECKLIST, spec: {} },
    })
    const incompleteRes = await SELF.fetch(`${O}/api/wishes/${wishId}/refinement/rounds`, {
      method: 'POST', headers: AGENT_H, body: JSON.stringify(incomplete),
    })
    expect(incompleteRes.status).toBe(409)
    expect((await incompleteRes.json<any>()).error).toBe('agent_ready_incomplete')

    const longKey = roundBody(needId, { idempotency_key: 'x'.repeat(129) })
    const longKeyRes = await SELF.fetch(`${O}/api/wishes/${wishId}/refinement/rounds`, {
      method: 'POST', headers: AGENT_H, body: JSON.stringify(longKey),
    })
    expect(longKeyRes.status).toBe(400)
    expect(await longKeyRes.json()).toEqual({ error: 'bad_idempotency_key' })

    const longAnswer = roundBody(needId, {
      idempotency_key: 'long-answer',
      answers: [{
        need_id: needId, body: 'x'.repeat(2001), state: 'answered', basis: 'decision', confidence: 'low', sources: [],
      }],
      followups: [],
    })
    const longAnswerRes = await SELF.fetch(`${O}/api/wishes/${wishId}/refinement/rounds`, {
      method: 'POST', headers: AGENT_H, body: JSON.stringify(longAnswer),
    })
    expect(longAnswerRes.status).toBe(400)
    expect(await longAnswerRes.json()).toEqual({ error: 'answer_too_long', max: 2000 })
  })
})
