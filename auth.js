// 協力者登入(GitHub OAuth,issue #2)。
//
// 池子的不對稱設計不變:許願永遠零登入;登入是協力者的選配 —— 換到的是「投幣一人一票」與
// 「交實作/認領自動掛已驗證署名」。沒登入的所有行為與以前完全一樣。
//
// 前端只保管兩樣東西:登入前的 state、登入後的 session token。兩樣都放 localStorage —— 行動裝置的
// in-app browser(FB / LINE 內建瀏覽器)跳去 GitHub 再跳回來時常常換了一個 context,sessionStorage
// 會整個對不上,localStorage 才留得住。
// GitHub 的 OAuth App 不支援 PKCE,所以 code 換 token 由 Worker 帶 client_secret 完成,
// client_secret 只在 Worker(wrangler secret),前端從頭到尾拿不到,也拿不到 GitHub access token。
window.WishAuth = (function () {
  var CFG = window.WISHPOOL_CONFIG || {}
  var API = CFG.WORKER_BASE
  var SESS_KEY = 'wishpool_session'     // { token, user, exp }
  var FLOW_KEY = 'wishpool_oauth_flow'  // { state, returnTo, at }
  var listeners = []

  function read(key) { try { return JSON.parse(localStorage.getItem(key)) } catch (e) { return null } }
  function write(key, v) { try { localStorage.setItem(key, JSON.stringify(v)) } catch (e) { /* ignore */ } }
  function drop(key) { try { localStorage.removeItem(key) } catch (e) { /* ignore */ } }

  // 目前登入身分(過期就當沒登入並清掉;伺服器仍會自己驗一次簽章,前端這關只是省一趟請求)
  function get() {
    var s = read(SESS_KEY)
    if (!s || !s.token || !s.user) return null
    if (s.exp && s.exp * 1000 < Date.now()) { drop(SESS_KEY); return null }
    return s
  }

  function headers() {
    var s = get()
    return s ? { 'X-Wish-Session': s.token } : {}
  }

  function emit() { listeners.forEach(function (fn) { try { fn(get()) } catch (e) { /* ignore */ } }) }
  function onChange(fn) { listeners.push(fn) }

  async function login() {
    try {
      var r = await fetch(API + '/api/auth/github/start')
      if (r.status === 503) { alert('GitHub 登入還沒開通，先照舊用就好：不登入一樣可以投幣、交實作。'); return }
      if (!r.ok) throw new Error('start ' + r.status)
      var j = await r.json()
      write(FLOW_KEY, { state: j.state, returnTo: location.hash || '', at: Date.now() })
      location.href = j.authorize_url
    } catch (e) { alert('登入服務暫時連不上，請稍後再試。') }
  }

  function logout() { drop(SESS_KEY); emit() }

  function cleanUrl(returnTo) {
    try { history.replaceState(null, '', location.pathname + (returnTo || '')) } catch (e) { /* ignore */ }
  }

  // 從 GitHub 跳回來時呼叫:網址上有 code 與 state 就把它換成 session。回傳「這次有沒有處理登入」。
  async function handleRedirect() {
    var q = new URLSearchParams(location.search)
    var code = q.get('code'), state = q.get('state')
    if (!code || !state) {
      // 使用者在 GitHub 按了取消:把網址擦乾淨回原本的位置,不吵他
      if (q.get('error')) { var f = read(FLOW_KEY); drop(FLOW_KEY); cleanUrl(f && f.returnTo) }
      return false
    }
    var flow = read(FLOW_KEY)
    drop(FLOW_KEY)
    cleanUrl(flow && flow.returnTo)
    // 本機先比一次 state(伺服器還會用簽章再驗一次,那邊才是真關卡)
    if (!flow || flow.state !== state) { alert('登入沒有完成（驗證碼對不上），請再登入一次。'); return false }
    try {
      var res = await fetch(API + '/api/auth/github/callback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code, state: state }),
      })
      if (!res.ok) throw new Error('callback ' + res.status)
      var j = await res.json()
      write(SESS_KEY, { token: j.token, user: j.user, exp: j.expires_at })
      emit()
      return true
    } catch (e) { alert('登入沒有完成，請再試一次。'); return false }
  }

  return { get: get, headers: headers, login: login, logout: logout, handleRedirect: handleRedirect, onChange: onChange }
})()
