import type { Env } from '../env'

// 一願望一討論串:在 yazelin/wish-pool 開 GitHub Discussion(需 GH_PAT secret;未設則靜默略過)。
// 分類優先序:「願望」(owner 可在 repo 設定手動建)→ Ideas → 第一個可用分類。
export async function createWishDiscussion(
  env: Env,
  wish: { id: number; title: string; problem?: string | null; current?: string | null; desired?: string | null; who?: string | null },
): Promise<string | null> {
  if (!env.GH_PAT) return null
  const gql = async (query: string, variables: Record<string, unknown>) => {
    const r = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.GH_PAT}`, 'Content-Type': 'application/json', 'User-Agent': 'wish-pool' },
      body: JSON.stringify({ query, variables }),
    })
    if (!r.ok) throw new Error('gh http ' + r.status)
    const j = (await r.json()) as { data?: any; errors?: unknown }
    if (j.errors || !j.data) throw new Error('gh graphql error')
    return j.data
  }
  const d = await gql('query{repository(owner:"yazelin",name:"wish-pool"){id discussionCategories(first:20){nodes{id name}}}}', {})
  const nodes: { id: string; name: string }[] = d.repository.discussionCategories.nodes
  const cat = nodes.find((c) => c.name === '願望') || nodes.find((c) => c.name === 'Ideas') || nodes[0]
  if (!cat) return null
  const body = [
    `本討論串聚焦這一個願望(願望 #${wish.id})。想聊別的願望,請到它自己的串。`,
    '',
    `池中頁面(投幣/共鳴/交實作): https://yazelin.github.io/wish-pool/#wish-${wish.id}`,
    '',
    `- 想解決:${wish.problem || ''}`,
    `- 現況:${wish.current || ''}`,
    `- 期望:${wish.desired || ''}`,
    `- 誰會用:${wish.who || ''}`,
  ].join('\n')
  const m = await gql(
    'mutation($rid:ID!,$cid:ID!,$t:String!,$b:String!){createDiscussion(input:{repositoryId:$rid,categoryId:$cid,title:$t,body:$b}){discussion{url}}}',
    { rid: d.repository.id, cid: cat.id, t: `願望 #${wish.id}:${wish.title}`, b: body },
  )
  return m.createDiscussion.discussion.url as string
}
