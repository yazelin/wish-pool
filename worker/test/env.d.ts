import type { Env } from '../src/env'
import type { D1Migration } from '@cloudflare/workers-types'

declare module 'cloudflare:test' {
  // 測試環境的 env:Worker 的 Env + 測試專用的 migrations binding
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[]
  }
}
