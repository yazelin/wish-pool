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
  // 協力者 GitHub OAuth(issue #2):四個都是選用 —— 沒設就整條登入路關閉,站台其餘功能照跑。
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  SESSION_SECRET?: string        // 未設則沿用 WISH_SIGN_SECRET(用途字首做 domain separation)
  OAUTH_REDIRECT_URI?: string    // 未設則用 ALLOWED_ORIGIN;要與 GitHub OAuth App 註冊的 callback 一致
}
