export type Env = {
  DB: D1Database
  ALLOWED_ORIGIN: string
  GROQ_BASE: string
  GROQ_MODEL: string
  GROQ_API_KEY: string
  TURNSTILE_SECRET: string
  ADMIN_TOKEN: string
  IP_SALT: string
  WISH_SIGN_SECRET: string
  AGENT_TOKEN: string
  GH_PAT?: string
}
