import { Hono } from 'hono'
import type { Env } from '../env'
import { checkAgentBearer } from '../lib/agent-auth'
import { publicWishExists } from '../lib/d1'
import {
  applyRefinementRound,
  getRefinementContext,
  parseRefinementRound,
  refinementRequestHash,
  RefinementError,
} from '../lib/refinement'

export const refinement = new Hono<{ Bindings: Env }>()

function errorResponse(c: any, error: unknown) {
  if (error instanceof RefinementError) {
    return c.json({ error: error.code, ...(error.details ?? {}) }, error.status as any)
  }
  throw error
}

refinement.get('/api/wishes/:id/refinement', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) return c.json({ error: 'not_found' }, 404)
  const state = await getRefinementContext(c.env.DB, id)
  if (!state) return c.json({ error: 'not_found' }, 404)
  return c.json(state)
})

refinement.post('/api/wishes/:id/refinement/rounds', async (c) => {
  const id = Number(c.req.param('id'))
  const agent = await checkAgentBearer(c, 'atokrefine', 50)
  if (agent instanceof Response) return agent
  if (!agent) return c.json({ error: 'agent_token_required' }, 401)
  if (!Number.isInteger(id) || !(await publicWishExists(c.env.DB, id))) return c.json({ error: 'not_found' }, 404)

  try {
    const input = parseRefinementRound(await c.req.json().catch(() => null))
    const hash = await refinementRequestHash(input)
    const actorKey = String((c as any).get('atokHash') || 'owner')
    const result = await applyRefinementRound(
      c.env.DB,
      id,
      actorKey,
      agent.tokenId,
      input,
      hash,
      Math.floor(Date.now() / 1000),
    )
    return c.json(result)
  } catch (error) {
    return errorResponse(c, error)
  }
})
