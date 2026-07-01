// 公開設定(可進 repo)。部署後把 WORKER_BASE 改成你的 workers.dev 網址,
// TURNSTILE_SITE_KEY 改成你的 Turnstile site key(public)。
window.WISHPOOL_CONFIG = {
  WORKER_BASE: 'http://localhost:8787',
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA', // Cloudflare 測試用 site key(永遠通過)
}
