// 公開設定(可進 repo)。部署後把 WORKER_BASE 改成你的 workers.dev 網址,
// TURNSTILE_SITE_KEY 改成你的 Turnstile site key(public)。
// GITHUB_LOGIN:協力者 GitHub 登入按鈕的開關。Worker 那邊設好 GITHUB_CLIENT_ID /
// GITHUB_CLIENT_SECRET 兩把 secret 之後再改成 true —— 沒設就別亮按鈕,免得按了只換到一句錯誤訊息。
window.WISHPOOL_CONFIG = {
  WORKER_BASE: 'https://wish-pool.yazelinj303.workers.dev',
  TURNSTILE_SITE_KEY: '0x4AAAAAADuSV2wW2GraJPZR',
  GITHUB_LOGIN: false,
}
