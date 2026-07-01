import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config'
import path from 'node:path'

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, 'migrations'))
  return {
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.toml' },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              ALLOWED_ORIGIN: 'https://test.local',
              GROQ_BASE: 'https://groq.test',
              GROQ_MODEL: 'openai/gpt-oss-120b',
              GROQ_API_KEY: 'test-groq-key',
              TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
              ADMIN_TOKEN: 'test-admin-token',
              IP_SALT: 'test-salt',
            },
          },
        },
      },
    },
  }
})
