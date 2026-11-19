/* MigoLive production API bridge.
 * Authentication, wallet reads, rooms and direct messages use the Railway API.
 * Local UI data is only a presentation cache; server remains authoritative.
 */
(() => {
  'use strict';
  const API = 'https://migolive-api-production.up.railway.app/api';

  // Fail-closed network gate: the app is usable only while the API and database
  // health endpoint are reachable. A navigator.onLine=true value alone is not trusted.
  const NETWORK_GATE_ID = 'migo-network-required-gate';
  let networkGateReady = false;
  let networkCheckRunning = false;
  function showNetworkGate() {
    networkGateReady = false;
    let gate = document.getElementById(NETWORK_GATE_ID);
    if (!gate) {
      gate = document.createElement('div');
      gate.id = NETWORK_GATE_ID;
      gate.setAttribute('role', 'alertdialog');
      gate.setAttribute('aria-live', 'assertive');
      gate.innerHTML = '<div class="migo-network-card"><div class="migo-network-icon">⌁</div><h1>خدمة الإنترنت لا تعمل</h1><p>التطبيق متوقف حاليًا لعدم وجود اتصال بالإنترنت.</p><p>يرجى التأكد من اتصال الإنترنت، وسيعمل التطبيق تلقائيًا عند عودة الخدمة.</p><div class="migo-network-state">جارٍ التحقق من الاتصال…</div></div>';
      const style = document.createElement('style');
      style.textContent = '#' + NETWORK_GATE_ID + '{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;background:linear-gradient(145deg,#100d20,#21133d 58%,#100d20);color:#fff;font-family:Arial,sans-serif;text-align:center;direction:rtl;pointer-events:auto}#' + NETWORK_GATE_ID + ' .migo-network-card{width:min(440px,100%);padding:34px 24px;border:1px solid rgba(255,255,255,.16);border-radius:22px;background:rgba(255,255,255,.07);box-shadow:0 18px 60px rgba(0,0,0,.4)}#' + NETWORK_GATE_ID + ' .migo-network-icon{margin:0 auto 18px;width:72px;height:72px;display:grid;place-items:center;border-radius:50%;background:rgba(255,190,70,.15);color:#ffc65b;font-size:42px}#' + NETWORK_GATE_ID + ' h1{margin:0 0 14px;font-size:25px;color:#ffd27a}#' + NETWORK_GATE_ID + ' p{margin:9px 0;font-size:16px;line-height:1.8;color:#f1edf8}#' + NETWORK_GATE_ID + ' .migo-network-state{margin-top:22px;color:#ffd27a;font-size:14px}';
      document.head.appendChild(style);
      document.body.appendChild(gate);
    }
    const state = gate.querySelector('.migo-network-state');
    if (state) state.textContent = navigator.onLine ? 'جارٍ التحقق من خدمة الإنترنت…' : 'لا يوجد اتصال بالإنترنت';
    gate.style.display = 'flex';
  }
  function hideNetworkGate() {
    networkGateReady = true;
    const gate = document.getElementById(NETWORK_GATE_ID);
    if (gate) gate.style.display = 'none';
  }
  async function verifyNetworkService() {
    if (networkCheckRunning) return;
    networkCheckRunning = true;
    if (!navigator.onLine) {
      showNetworkGate();
      networkCheckRunning = false;
      return;
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = setTimeout(() => { if (controller) controller.abort(); }, 3500);
    try {
      const response = await fetch(API + '/health', {
        method: 'GET', cache: 'no-store', credentials: 'omit',
        headers: { 'Accept': 'application/json' },
        signal: controller ? controller.signal : undefined
      });
      const data = await response.json();
      if (response.ok && data && data.ok === true && data.database === 'connected') {
        hideNetworkGate();
      } else {
        showNetworkGate();
      }
    } catch (_) {
      showNetworkGate();
    } finally {
      clearTimeout(timeout);
      networkCheckRunning = false;
    }
  }
  window.addEventListener('offline', showNetworkGate);
  window.addEventListener('online', () => {
    showNetworkGate();
    verifyNetworkService();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') verifyNetworkService();
  });
  showNetworkGate();
  verifyNetworkService();
  setInterval(verifyNetworkService, 4000);
  const TOKEN_KEY = 'migolive_api_token_v1';
  const $id = (id) => document.getElementById(id);
  const token = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; } };
  const saveToken = (v) => { try { if (v) localStorage.setItem(TOKEN_KEY, v); else localStorage.removeItem(TOKEN_KEY); } catch (_) {} };
  async function api(path, options = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    if (token()) headers.Authorization = 'Bearer ' + token();
    const response = await fetch(API + path, Object.assign({}, options, { headers }));
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok || data.ok === false) throw new Error(data.message || ('HTTP ' + response.status));
    return data;
  }
  const message = (text) => { const el = $id('aerr'); if (el) el.textContent = text; else if (typeof toast === 'function') toast(text); };

  // Connect the existing Coins-page "تنفيذ" form to the authoritative wallet API.
  // The visible form stays unchanged; positive amounts credit and negative amounts debit.
  const ownerAdjustmentRetries = new WeakMap();
  function findCoinsAdjustmentForm(node) {
    let root = node && node.closest && (node.closest('form') || node.closest('[role="form"]'));
    if (!root && node && node.parentElement) {
      let current = node.parentElement;
      for (let depth = 0; depth < 5 && current; depth++, current = current.parentElement) {
        const fields = Array.from(current.querySelectorAll('input'));
        if (fields.some(x => /اسم المستخدم/.test(x.placeholder || '')) && fields.some(x => /العدد/.test(x.placeholder || ''))) { root = current; break; }
      }
    }
    if (!root) return null;
    const inputs = Array.from(root.querySelectorAll('input'));
    const username = inputs.find(x => /اسم المستخدم/.test(x.placeholder || ''));
    const amount = inputs.find(x => /العدد/.test(x.placeholder || ''));
    return username && amount ? { root, username, amount } : null;
  }
  async function submitExistingCoinsAdjustment(root) {
    const form = findCoinsAdjustmentForm(root);
    if (!form) return false;
    const username = String(form.username.value || '').trim().toLowerCase();
    const amount = Number(String(form.amount.value || '').trim().replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٬/g, '').replace(/٫/g, '.'));
    if (!/^[a-z0-9_.-]{3,24}$/.test(username) || !Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > 1000000000) {
      if (typeof toast === 'function') toast('اكتب اسم مستخدم صحيحًا وعدد عملات صحيحًا غير صفر');
      return true;
    }
    let pending = ownerAdjustmentRetries.get(form.root);
    if (!pending || pending.username !== username || pending.amount !== amount) {
      const bytes = new Uint8Array(20);
      if (!window.crypto || !window.crypto.getRandomValues) { if (typeof toast === 'function') toast('تعذر تأمين العملية'); return true; }
      window.crypto.getRandomValues(bytes);
      pending = { username, amount, key: 'owner-adjust-' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('') };
      ownerAdjustmentRetries.set(form.root, pending);
    }
    const button = Array.from(form.root.querySelectorAll('button,input[type="submit"]')).find(x => /تنفيذ/.test(x.textContent || x.value || ''));
    if (button) button.disabled = true;
    try {
      const data = await api('/wallet/admin/adjust', {
        method: 'POST', headers: { 'Idempotency-Key': pending.key },
        body: JSON.stringify({ username, amount, description: amount < 0 ? 'خصم من صفحة العملات' : 'شحن من صفحة العملات' })
      });
      ownerAdjustmentRetries.delete(form.root);
      if (typeof toast === 'function') toast((amount < 0 ? 'تم الخصم بنجاح' : 'تم الشحن بنجاح') + ' · الرصيد الحالي: ' + Number(data.coins).toLocaleString('ar-EG') + ' عملة');
      if (typeof me !== 'undefined' && me && DB?.users?.[me] && Number(DB.users[me].uid) === Number(data.uid)) refreshWallet().catch(() => {});
    } catch (error) {
      if (typeof toast === 'function') toast('لم يتم تأكيد العملية: ' + error.message + ' · أعد المحاولة بنفس البيانات دون تغييرها');
    } finally { if (button) button.disabled = false; }
    return true;
  }
  document.addEventListener('submit', async event => {
    const form = findCoinsAdjustmentForm(event.target);
    if (!form) return;
    event.preventDefault(); event.stopImmediatePropagation();
    await submitExistingCoinsAdjustment(form.root);
  }, true);
  document.addEventListener('click', async event => {
    const button = event.target && event.target.closest && event.target.closest('button,input[type="submit"]');
    if (!button || !/تنفيذ/.test(button.textContent || button.value || '')) return;
    const form = findCoinsAdjustmentForm(button);
    if (!form) return;
    event.preventDefault(); event.stopImmediatePropagation();
    await submitExistingCoinsAdjustment(form.root);
  }, true);

  const cacheUser = async (user, password) => {
    const key = 'server-' + String(user.uid);
    const old = DB.users[key] || {};
    DB.users[key] = Object.assign(old, {
      name: user.displayName || user.username || ('عضو ' + user.uid),
      username: user.username, phone: user.phone || '', uid: user.uid,
      coins: Number(user.coins) || 0, role: user.role || 'user',
      avatar: user.avatar || '',
      serverId: user.id, serverBacked: true, banned: false
    });
    // Never retain a locally hashed password for server-backed accounts.
    try { delete DB.users[key].pass; } catch (_) {}
    return key;
  };
  // One-time, authenticated migration of safe profile fields from a matching legacy UID.
  // Wallet, roles, passwords, sessions and local transaction history are never uploaded.
  async function migrateLegacyProfile(serverUser) {
    if (!serverUser || !serverUser.uid || !token()) return;
    const legacy = Object.values(DB.users || {}).find((user) =>
      user && Number(user.uid) === Number(serverUser.uid) && !user.serverBacked
    );
    if (!legacy) return;
    const profile = {};
    const displayName = String(legacy.displayName || legacy.name || '').trim();
    const avatar = String(legacy.avatar || '').trim();
    if (displayName && displayName.length <= 40) profile.displayName = displayName;
    if (avatar.length <= 500 && (!avatar || /^https:\/\//i.test(avatar))) profile.avatar = avatar;
    if (!Object.keys(profile).length) return;
    const idKey = 'migolive_legacy_migration_' + String(serverUser.uid);
    let migrationId = '';
    try {
      migrationId = localStorage.getItem(idKey) || '';
      if (!/^[a-zA-Z0-9_-]{16,80}$/.test(migrationId)) {
        migrationId = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID().replace(/-/g, '')
          : ('legacy' + Date.now() + Math.random().toString(36).slice(2)).slice(0, 48);
        localStorage.setItem(idKey, migrationId);
      }
    } catch (_) {
      migrationId = ('legacy' + Date.now() + Math.random().toString(36).slice(2)).slice(0, 48);
    }
    const result = await api('/migration/legacy', {
      method: 'POST',
      body: JSON.stringify({ migrationId, profile })
    });
    if (result.ok && DB.users['server-' + serverUser.uid]) {
      if (profile.displayName) DB.users['server-' + serverUser.uid].name = profile.displayName;
      if (profile.avatar) DB.users['server-' + serverUser.uid].avatar = profile.avatar;
      save();
    }
    return result;
  }

  const originalLogin = $id('bin') && $id('bin').onclick;
  if ($id('bin') && typeof originalLogin === 'function') {
    $id('bin').onclick = async () => {
      const raw = ($id('u')?.value || '').trim();
      const phone = ($id('reg-phone')?.value || '').trim();
      const password = $id('p')?.value || '';
      const registering = !!(typeof reg !== 'undefined' && reg);
      if (!raw || !password) return message('أدخل بيانات الحساب');
      if (password.length < (registering ? 8 : 1)) return message(registering ? 'كلمة المرور يجب ألا تقل عن 8 أحرف' : 'أدخل كلمة المرور');
      const button = $id('bin');
      if (button) button.disabled = true;
      try {
        let data;
        if (registering) {
          data = await api('/auth/register', { method: 'POST', body: JSON.stringify({
            username: raw, displayName: raw, phone, password
          }) });
        } else {
          data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: raw, password }) });
        }
        saveToken(data.token);
        const key = await cacheUser(data.user, password);
        me = key;
        migrateLegacyProfile(data.user).catch((e) => console.warn('Legacy profile migration pending:', e.message));
        save();
        try { localStorage.setItem('mygo_session', key); localStorage.setItem('mygo_remember_login', '1'); } catch (_) {}
        message('');
        start();
        refreshWallet().catch(() => {});
        if (typeof toast === 'function') toast(registering ? ('تم إنشاء الحساب · رقم ID: ' + data.user.uid) : 'تم تسجيل الدخول بنجاح');
      } catch (error) {
        message(error.message || 'تعذر الاتصال بالخادم');
      } finally {
        if (button) button.disabled = false;
      }
    };
  }

  function syncWalletBalance(value) {
    const coins = Number(value);
    if (!Number.isSafeInteger(coins) || coins < 0) throw new Error('رصيد المحفظة الوارد من الخادم غير صالح');
    if (typeof me !== 'undefined' && me && DB.users && DB.users[me]) {
      DB.users[me].coins = coins;
      save();
    }
    const selectors = [
      '#mycoins', '[data-server-wallet-balance]', '[data-wallet-balance]',
      '#walletCoins', '#walletBalance', '#wallet-balance',
      '.wallet-balance', '.coins-balance'
    ];
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((node) => {
        node.textContent = String(coins);
      });
    }
    window.dispatchEvent(new CustomEvent('migo:wallet-updated', { detail: { coins } }));
    return coins;
  }

  async function refreshWallet() {
    if (!token() || typeof me === 'undefined' || !me) return null;
    // User.coins is the single canonical balance. Bypass HTTP caches so the
    // app wallet and every game iframe always read the same latest value.
    const data = await api('/wallet', { method: 'GET', cache: 'no-store' });
    if (!Number.isSafeInteger(Number(data.coins)) || Number(data.coins) < 0) {
      throw new Error('الخادم لم يرجع رصيد محفظة صالحًا');
    }
    syncWalletBalance(Number(data.coins));
    return data;
  }

  // Shared, authenticated bridge for every game iframe. The iframe can request
  // an action, but cannot choose an outcome or write a balance.
  const GAME_POST_PATHS = new Set([
    '/games/slot-777/spin',
    '/games/ocean-storm/spin',
    '/games/wheel-animals/spin',
    '/games/cleopatra-gold/spin',
    '/games/fruit-luck/spin',
    '/games/rocket-crash/start',
    '/games/rocket-crash/cashout',
    '/games/rocket-crash/cancel',
    '/games/big-warrior/play',
    '/games/big-warrior/fight'
  ]);
  window.__migoGameApiRequest = async (path, body, requestId) => {
    if (path === '/games/rocket-crash/state') {
      // The rocket state endpoint is read-only; it still requires authentication.
      const data = await api(path, { method: 'GET', cache: 'no-store' });
      if (Number.isSafeInteger(Number(data.coins)) && Number(data.coins) >= 0) {
        syncWalletBalance(Number(data.coins));
      }
      return data;
    }
    if (!GAME_POST_PATHS.has(path)) throw new Error('طلب اللعبة غير مسموح');
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(String(requestId || ''))) {
      throw new Error('معرّف الجولة غير صالح');
    }
    const data = await api(path, {
      method: 'POST',
      headers: { 'Idempotency-Key': String(requestId) },
      body: JSON.stringify(body && typeof body === 'object' ? body : {})
    });
    if (Number.isSafeInteger(Number(data.coins)) && Number(data.coins) >= 0) {
      syncWalletBalance(Number(data.coins));
    }
    // Return the completed server settlement immediately. Reconcile the shared
    // wallet in the background so an extra network round-trip does not delay
    // the animation/result shown by the game.
    refreshWallet().catch((error) => {
      console.warn('Post-game wallet refresh failed:', error.message);
    });
    return data;
  };
  window.__migoRefreshWallet = refreshWallet;
  window.__migoSyncWalletBalance = syncWalletBalance;

  // Reconcile after returning from a game, a payment screen, or backgrounding.
  window.addEventListener('focus', () => { refreshWallet().catch((e) => console.warn('Wallet focus refresh failed:', e.message)); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshWallet().catch((e) => console.warn('Wallet resume refresh failed:', e.message));
  });

  // Keep the balance display synchronized with the server whenever the wallet opens.
  if (typeof rWallet === 'function') {
    const oldWallet = rWallet;
    rWallet = function (m) {
      oldWallet(m);
      refreshWallet().then(() => {
        const balance = m.querySelector('[data-server-wallet-balance]');
        if (balance && typeof me !== 'undefined' && me) balance.textContent = DB.users[me].coins;
      }).catch((e) => console.warn('Wallet refresh failed:', e.message));
    };
  }

  // Load rooms from the API and make room creation/joining server-backed.
  if (typeof rRooms === 'function') {
    const oldRooms = rRooms;
    rRooms = function (m) {
      oldRooms(m);
      api('/rooms').then((data) => {
        const serverRooms = (data.rooms || []).map((r) => {
          const localId = Number(r.id);
          const prior = DB.rooms.find((x) => Number(x.id) === localId);
          const ownerKey = Object.keys(DB.users).find((k) => Number(DB.users[k].uid) === Number(r.ownerUid)) || '';
          const room = prior || { id: localId, seats: Array(25).fill(null), chat: [], online: [] };
          Object.assign(room, { id: localId, name: r.name, owner: ownerKey, serverBacked: true, serverId: r.id, membersCount: r.membersCount, capacity: r.capacity, pass: '', isPrivate: r.isPrivate });
          if (!Array.isArray(room.seats)) room.seats = Array(25).fill(null);
          return room;
        });
        DB.rooms = serverRooms;
        const list = $id('rl');
        if (list) { list.innerHTML = roomListHTML(DB.rooms); bindRooms(); }
      }).catch((e) => console.warn('Room list unavailable:', e.message));
      const create = $id('mk');
      if (create) create.onclick = async () => {
        const name = ($id('nr')?.value || '').trim();
        if (name.length < 2) return toast('اسم الغرفة قصير');
        create.disabled = true;
        try {
          const data = await api('/rooms', { method: 'POST', body: JSON.stringify({ name, capacity: 25 }) });
          const r = data.room;
          const key = Object.keys(DB.users).find((k) => Number(DB.users[k].uid) === Number(r.ownerUid)) || me;
          DB.rooms.unshift({ id: Number(r.id), name: r.name, owner: key, serverBacked: true, serverId: r.id, seats: Array(25).fill(null), chat: [], online: [] });
          save();
          nav('room-' + r.id);
        } catch (e) { toast(e.message || 'تعذر إنشاء الغرفة'); }
        finally { create.disabled = false; }
      };
    };
  }

  // Intercept opening a room: membership is confirmed by the API before local navigation.
  document.addEventListener('click', async (event) => {
    const card = event.target && event.target.closest && event.target.closest('[data-r]');
    if (!card || event.target.closest('[data-fav]')) return;
    const roomId = Number(card.getAttribute('data-r'));
    const localRoom = DB.rooms.find((r) => Number(r.id) === roomId);
    if (!localRoom || !localRoom.serverBacked) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      await api('/rooms/' + encodeURIComponent(roomId) + '/join', { method: 'POST', body: JSON.stringify({}) });
      nav('room-' + roomId);
    } catch (e) { toast(e.message || 'تعذر دخول الغرفة'); }
  }, true);

  // Direct messages are persisted by the API rather than the browser's local cache.
  if (typeof rMsgs === 'function') {
    const oldMsgs = rMsgs;
    rMsgs = function (m) {
      oldMsgs(m);
      const find = $id('msg-find');
      if (find) find.onclick = async () => {
        const uid = String($id('msg-id')?.value || '').trim().replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
        if (!/^\d{5,10}$/.test(uid)) return toast('اكتب رقم ID صحيح');
        try {
          const data = await api('/users/' + encodeURIComponent(uid));
          const peer = data.user || data;
          const key = 'server-' + peer.uid;
          DB.users[key] = Object.assign(DB.users[key] || {}, { uid: peer.uid, name: peer.displayName || ('عضو ' + peer.uid), username: peer.username || '', avatar: peer.avatar || '', serverBacked: true, serverId: peer.id });
          dmTo = key;
          const historyData = await api('/messages/' + encodeURIComponent(peer.uid));
          DB.msgs = DB.msgs.filter(x => !(x.serverConversation === String(peer.uid)));
          (historyData.messages || []).forEach((item) => {
            const fromUid = Number(item.from && item.from.uid);
            const toUid = Number(item.to && item.to.uid);
            const fromKey = 'server-' + fromUid;
            const toKey = 'server-' + toUid;
            [item.from, item.to].forEach((person) => {
              if (!person || !person.uid) return;
              const personKey = 'server-' + person.uid;
              DB.users[personKey] = Object.assign(DB.users[personKey] || {}, {
                uid: person.uid, name: person.displayName || ('عضو ' + person.uid), serverBacked: true
              });
            });
            DB.msgs.push({
              from: fromKey, to: toKey, m: item.text || '', t: item.createdAt || '',
              serverConversation: String(peer.uid), serverBacked: true
            });
          });
          render();
        } catch (e) { toast(e.message || 'لم يتم العثور على المستخدم'); }
      };
      const send = $id('sm');
      if (send) send.onclick = async () => {
        const peer = dmTo && DB.users[dmTo];
        const text = ($id('tx')?.value || '').trim();
        if (!peer || !peer.uid || !text) return toast('اكتب الرسالة وحدد المستلم');
        send.disabled = true;
        try {
          await api('/messages/' + encodeURIComponent(peer.uid), { method: 'POST', body: JSON.stringify({ text }) });
          DB.msgs.push({ from: me, to: dmTo, m: text, t: new Date().toISOString(), serverConversation: String(peer.uid), serverBacked: true });
          $id('tx').value = '';
          toast('تم إرسال الرسالة');
          render();
        } catch (e) { toast(e.message || 'تعذر إرسال الرسالة'); }
        finally { send.disabled = false; }
      };
    };
  }


  // Remote APK update enforcement. Increment this value for every published APK.
  const MIGO_APP_VERSION_CODE = Number(window.MIGO_APP_VERSION_CODE || 1);
  const UPDATE_BLOCK_ID = "migo-forced-update-screen-v1";
  let updateCheckRunning = false;
  function showUpdateBlock(data, retry) {
    let layer = document.getElementById(UPDATE_BLOCK_ID);
    if (!layer) {
      layer = document.createElement("div");
      layer.id = UPDATE_BLOCK_ID;
      layer.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#171020;color:#fff;display:flex;align-items:center;justify-content:center;padding:24px;direction:rtl;font-family:inherit;text-align:center";
      document.body.appendChild(layer);
    }
    const messageText = String(data && data.message || "هذا الإصدار لم يعد مدعومًا. يُرجى التواصل مع مالك التطبيق للحصول على أحدث إصدار من ميجو لايف.");
    const apkUrl = String(data && data.apkUrl || "");
    layer.innerHTML = '<div style="width:min(100%,420px)"><div style="font-size:52px;margin-bottom:16px">🔄</div><h2 style="font-size:23px;margin:0 0 14px">تحديث مطلوب</h2><p style="line-height:1.9;color:#e8dff0;margin:0 0 22px"></p><button type="button" data-contact style="width:100%;padding:15px;border:0;border-radius:14px;background:#a56be8;color:#fff;font-size:16px;font-weight:800">التواصل مع مالك التطبيق</button><button type="button" data-retry style="width:100%;padding:13px;margin-top:10px;border:1px solid #806a91;border-radius:14px;background:transparent;color:#fff">إعادة التحقق</button></div>';
    layer.querySelector("p").textContent = messageText;
    layer.querySelector("[data-contact]").onclick = () => {
      if (apkUrl) window.open(apkUrl, "_blank", "noopener");
      else if (typeof toast === "function") toast("تواصل مع مالك التطبيق للحصول على ملف APK الجديد");
    };
    layer.querySelector("[data-retry]").onclick = retry;
  }
  function hideUpdateBlock() {
    const layer = document.getElementById(UPDATE_BLOCK_ID);
    if (layer) layer.remove();
  }
  async function checkAppUpdatePolicy() {
    if (!token() || updateCheckRunning) return true;
    updateCheckRunning = true;
    try {
      const data = await api("/app-updates/status?versionCode=" + encodeURIComponent(MIGO_APP_VERSION_CODE), {
        method: "GET", cache: "no-store",
        headers: { "X-App-Version-Code": String(MIGO_APP_VERSION_CODE) }
      });
      // Show the blocking screen only for an explicit owner-issued global
      // maintenance command. Version mismatches and fresh installs do not lock the app.
      if (data.blocked === true && data.reason === "maintenance") {
        showUpdateBlock(data, () => checkAppUpdatePolicy().catch(() => {}));
        return false;
      }
      hideUpdateBlock();
      return true;
    } catch (error) {
      // A network/API error is not an owner shutdown command. Never show the
      // maintenance screen on first install or because connectivity is unavailable.
      hideUpdateBlock();
      console.warn("MigoLive maintenance check unavailable:", error.message);
      return true;
    } finally {
      updateCheckRunning = false;
    }
  }
  window.__migoCheckAppUpdate = checkAppUpdatePolicy;
  // Poll maintenance state so owner actions take effect without reinstalling.
  setInterval(() => {
    if (token() && document.visibilityState === "visible") {
      checkAppUpdatePolicy().then(allowed => { if (allowed) installOwnerUpdatePanel(); }).catch(() => {});
    }
  }, 15000);

  // Owner-only control panel entry. The server independently checks role on save.
  function findAdminSectionsContainer() {
    const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,[role=heading],strong,b,div,section"));
    const heading = headings.find(node => {
      if (!node || !node.getClientRects().length) return false;
      const label = String(node.innerText || node.textContent || "").trim().replace(/\\s+/g, " ");
      return label === "أقسام الإدارة" || label === "اقسام الادارة";
    });
    if (!heading) return null;
    // The section title is followed by the admin feature grid in the existing UI.
    return heading.parentElement?.parentElement || heading.parentElement || null;
  }
  function installOwnerUpdatePanel() {
    if (typeof me === "undefined" || !me) return;
    const owner = DB && DB.users && DB.users[me] && DB.users[me].role === "owner";
    const oldUpdate = document.getElementById("migo-owner-update-entry");
    const oldGames = document.getElementById("migo-owner-games-entry");
    const oldRecharge = document.getElementById("migo-owner-recharge-entry");
    const oldGrid = document.getElementById("migo-owner-admin-controls");
    if (!owner) {
      if (oldUpdate) oldUpdate.remove();
      if (oldGames) oldGames.remove();
      if (oldRecharge) oldRecharge.remove();
      if (oldGrid) oldGrid.remove();
      return;
    }
    const section = findAdminSectionsContainer();
    if (!section) {
      // Never float owner controls over the app. Wait until the administration
      // section is rendered, then MutationObserver will insert them there.
      if (oldGrid) oldGrid.remove();
      if (oldUpdate) oldUpdate.remove();
      if (oldGames) oldGames.remove();
      return;
    }
    let grid = document.getElementById("migo-owner-admin-controls");
    if (!grid) {
      grid = document.createElement("div");
      grid.id = "migo-owner-admin-controls";
      grid.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;width:100%;margin:14px 0";
    }
    let gamesEntry = document.getElementById("migo-owner-games-entry");
    if (!gamesEntry) {
      gamesEntry = document.createElement("button");
      gamesEntry.id = "migo-owner-games-entry";
      gamesEntry.type = "button";
      gamesEntry.textContent = "🎮 التحكم في الألعاب";
      gamesEntry.onclick = openOwnerGameControlPanel;
    }
    let updateEntry = document.getElementById("migo-owner-update-entry");
    if (!updateEntry) {
      updateEntry = document.createElement("button");
      updateEntry.id = "migo-owner-update-entry";
      updateEntry.type = "button";
      updateEntry.textContent = "⚙️ التحكم في التحديث";
      updateEntry.onclick = openOwnerUpdatePanel;
    }
    let rechargeEntry = document.getElementById("migo-owner-recharge-entry");
    if (!rechargeEntry) {
      rechargeEntry = document.createElement("button");
      rechargeEntry.id = "migo-owner-recharge-entry";
      rechargeEntry.type = "button";
      rechargeEntry.textContent = "💰 شحن المستخدمين والوكلاء";
      rechargeEntry.onclick = openOwnerRechargePanel;
    }
    const buttonStyle = "min-height:58px;border:1px solid #a56be8;border-radius:14px;padding:12px;background:#fff;color:#512477;font-weight:800;font-size:15px;white-space:normal";
    gamesEntry.style.cssText = buttonStyle;
    updateEntry.style.cssText = buttonStyle;
    rechargeEntry.style.cssText = buttonStyle;
    grid.append(gamesEntry, updateEntry, rechargeEntry);
    if (grid.parentElement !== section) {
      const heading = Array.from(section.querySelectorAll("h1,h2,h3,h4,[role=heading]")).find(node => /أقسام الإدارة|اقسام الادارة/.test(node.textContent || ""));
      if (heading && heading.nextSibling) section.insertBefore(grid, heading.nextSibling);
      else section.appendChild(grid);
    }
  }

  // Server-backed owner recharge. Both regular users and charging agents must
  // have a real server UID; no local balance mutation is ever performed here.
  async function openOwnerRechargePanel() {
    const existing = document.getElementById('migo-owner-recharge-panel');
    if (existing) { existing.remove(); return; }
    const modal = document.createElement('div');
    modal.id = 'migo-owner-recharge-panel';
    modal.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;padding:16px;direction:rtl';
    modal.innerHTML = '<div style="width:min(430px,100%);background:#201431;color:#fff;border:1px solid #b98bea;border-radius:18px;padding:22px;font-family:Arial,sans-serif"><h2 style="margin:0 0 12px">شحن حساب من المالك</h2><p style="font-size:13px;line-height:1.7">اشحن المستخدم أو وكيل الشحن باستخدام رقم ID المسجل على الخادم. يتم حفظ العملية في سجل المحفظة.</p><form id="migo-owner-recharge-form"><label style="display:block;margin:10px 0">نوع الحساب<select id="migo-recharge-kind" style="width:100%;padding:11px"><option value="user">مستخدم</option><option value="agent">وكيل شحن</option></select></label><label style="display:block;margin:10px 0">رقم ID<input id="migo-recharge-uid" type="number" min="100000" step="1" required style="width:100%;box-sizing:border-box;padding:11px"></label><label style="display:block;margin:10px 0">عدد العملات<input id="migo-recharge-amount" type="number" min="1" max="1000000000" step="1" required style="width:100%;box-sizing:border-box;padding:11px"></label><p id="migo-recharge-result" role="status" style="min-height:24px;font-size:14px"></p><div style="display:flex;gap:10px"><button id="migo-recharge-submit" type="submit" style="flex:1;padding:12px;background:#d4a14e;color:#171021;border:0;border-radius:10px;font-weight:bold">تأكيد الشحن</button><button id="migo-recharge-close" type="button" style="padding:12px;border:0;border-radius:10px">إغلاق</button></div></form></div>';
    document.body.appendChild(modal);
    modal.querySelector('#migo-recharge-close').onclick = () => modal.remove();
    const form = modal.querySelector('#migo-owner-recharge-form');
    const result = modal.querySelector('#migo-recharge-result');
    const submit = modal.querySelector('#migo-recharge-submit');
    let pending = null;
    for (const id of ['migo-recharge-kind','migo-recharge-uid','migo-recharge-amount']) {
      modal.querySelector('#' + id).addEventListener('input', () => { pending = null; result.textContent = ''; });
    }
    form.onsubmit = async (event) => {
      event.preventDefault();
      const uid = Number(modal.querySelector('#migo-recharge-uid').value);
      const amount = Number(modal.querySelector('#migo-recharge-amount').value);
      const kind = modal.querySelector('#migo-recharge-kind').value;
      if (!Number.isSafeInteger(uid) || uid < 100000 || !Number.isSafeInteger(amount) || amount < 1 || amount > 1000000000) {
        result.textContent = 'راجع رقم ID وعدد العملات'; return;
      }
      if (!pending || pending.uid !== uid || pending.amount !== amount || pending.kind !== kind) {
        const bytes = new Uint8Array(20);
        if (!window.crypto || !window.crypto.getRandomValues) { result.textContent = 'تعذر تأمين العملية'; return; }
        window.crypto.getRandomValues(bytes);
        pending = { uid, amount, kind, key: 'owner-credit-' + Array.from(bytes, b => b.toString(16).padStart(2,'0')).join('') };
      }
      submit.disabled = true;
      result.textContent = 'جارٍ حفظ الشحن على الخادم…';
      try {
        const data = await api('/wallet/admin/credit', {
          method: 'POST',
          headers: { 'Idempotency-Key': pending.key },
          body: JSON.stringify({ targetUid: uid, amount, description: kind === 'agent' ? 'شحن وكيل من المالك' : 'شحن مستخدم من المالك' })
        });
        result.textContent = 'تم الشحن بنجاح. الرصيد الحالي: ' + Number(data.coins).toLocaleString('ar-EG') + ' عملة' + (data.repeated ? ' (عملية مؤكدة مسبقًا)' : '');
        pending = null;
        if (typeof me !== 'undefined' && DB?.users?.[me] && Number(DB.users[me].uid) === uid) refreshWallet().catch(() => {});
      } catch (error) {
        result.textContent = 'لم يتم تأكيد الشحن: ' + error.message + ' — أعد المحاولة بنفس البيانات للتحقق دون تكرار الشحن.';
      } finally { submit.disabled = false; }
    };
  }
  const MIGO_GAME_LABELS = {
    "slot-777":"سلوت 777","ocean-storm":"عاصفة المحيط","wheel-animals":"عجلة الحيوانات",
    "cleopatra-gold":"ذهب كليوباترا","fruit-luck":"حظ الفواكه","rocket-crash":"الصاروخ","big-warrior":"المحارب الكبير"
  };
  async function openOwnerGameControlPanel() {
    let modal = document.getElementById("migo-owner-game-control-panel");
    if (modal) { modal.remove(); return; }
    modal = document.createElement("div");
    modal.id = "migo-owner-game-control-panel";
    modal.style.cssText = "position:fixed;inset:0;z-index:1000000;background:#000b;display:flex;align-items:center;justify-content:center;padding:16px;direction:rtl";
    modal.innerHTML = '<section style="width:min(100%,460px);max-height:90vh;overflow:auto;background:#21182b;color:#fff;border-radius:18px;padding:20px;font-family:inherit"><h3 style="margin:0 0 8px">التحكم في تشغيل الألعاب</h3><p style="color:#cbbbd8;font-size:13px;line-height:1.8">أوقف أي لعبة لإخفائها من قسم الألعاب والغرف ومنع تشغيلها من الخادم. يمكنك إعادة تشغيلها في أي وقت.</p><div id="migo-game-control-list">جارٍ تحميل الألعاب...</div><div id="migo-game-control-status" role="status" style="font-size:13px;color:#e8c9ff;margin:10px 0"></div><button id="migo-game-control-close" type="button" style="width:100%;padding:12px;border:1px solid #806a91;border-radius:12px;background:transparent;color:#fff">إغلاق</button></section>';
    document.body.appendChild(modal);
    modal.querySelector("#migo-game-control-close").onclick = () => modal.remove();
    const list = modal.querySelector("#migo-game-control-list"), status = modal.querySelector("#migo-game-control-status");
    try {
      const data = await api("/game-control/policy", { method: "GET", cache: "no-store" });
      list.innerHTML = "";
      (data.games || []).forEach(game => {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid #493b55";
        const title = document.createElement("strong"); title.textContent = game.name;
        const toggle = document.createElement("button");
        toggle.type = "button";
        const paint = () => {
          toggle.textContent = game.enabled ? "اللعبة تعمل · إيقاف" : "متوقفة · تشغيل";
          toggle.style.cssText = "border:0;border-radius:10px;padding:10px 12px;background:"+(game.enabled?"#9c3e52":"#287b59")+";color:#fff;font-weight:800";
        };
        paint();
        toggle.onclick = async () => {
          toggle.disabled = true; status.textContent = "جارٍ تحديث حالة " + game.name + "...";
          try {
            const result = await api("/game-control/" + encodeURIComponent(game.id), {
              method: "PUT", body: JSON.stringify({ enabled: !game.enabled })
            });
            game.enabled = result.game.enabled; paint();
            await refreshGameAvailability();
            status.textContent = game.enabled ? "تم تشغيل " + game.name : "تم إيقاف " + game.name + " وإخفاؤها عن المستخدمين";
          } catch (error) { status.textContent = error.message || "تعذر تغيير حالة اللعبة"; }
          finally { toggle.disabled = false; }
        };
        row.append(title, toggle); list.appendChild(row);
      });
    } catch (error) { list.textContent = error.message || "تعذر تحميل إعدادات الألعاب"; }
  }

  const GAME_SLUGS = Object.keys(MIGO_GAME_LABELS);
  let gameAvailability = Object.fromEntries(GAME_SLUGS.map(id => [id, true]));
  function gameIdFromText(value) {
    const text = String(value || "").toLowerCase();
    return GAME_SLUGS.find(id => text.includes(id) || (id === "slot-777" && /slot777|slot_777/.test(text)) || text.includes(MIGO_GAME_LABELS[id].toLowerCase()) || (id === "rocket-crash" && /صاروخ الفضاء/.test(text)) || (id === "fruit-luck" && /فواكه الحظ/.test(text))) || "";
  }
  function applyGameAvailabilityToUI() {
    const selectors = [
      "[data-game-id]", "[data-game]", "[data-gameid]", "a[href]", "iframe[src]",
      "button", "[role=button]", ".game-card", ".game-item", ".game-box",
      ".game-card-item", ".migo-game-card", ".room-game-item", ".game-option",
      ".game-tile", ".game-entry", ".game-btn", "[onclick]"
    ];
    const candidates = new Set();
    document.querySelectorAll(selectors.join(",")).forEach(node => {
      if (node.closest("#migo-owner-game-control-panel")) return;
      const id = gameIdFromText([
        node.getAttribute("data-game-id"), node.getAttribute("data-game"),
        node.getAttribute("data-gameid"), node.getAttribute("href"),
        node.getAttribute("src"), node.innerText || node.textContent
      ].filter(Boolean).join(" "));
      if (!id) return;
      const semanticCard = node.closest(
        "[data-game-card],.game-card,.game-item,.game-box,.game-card-item," +
        ".migo-game-card,.room-game-item,.game-option,.game-tile,.game-entry,.game-btn"
      );
      let card = semanticCard || node;
      if (!semanticCard && node.matches("a,button,[role=button],iframe")) {
        const parent = node.parentElement;
        const parentText = String(parent && (parent.innerText || parent.textContent) || "").trim();
        // Use the immediate wrapper only when it represents this one game,
        // never a section containing multiple game entries.
        if (parent && parent !== document.body && parentText.length <= 120 &&
            gameIdFromText(parentText) === id) card = parent;
      }
      if (card && card !== document.body) candidates.add({ node: card, id });
    });

    // Some room launchers render plain text cards without game-specific classes.
    document.querySelectorAll("#migo-game-picker .migo-game-card,#migo-game-picker *,#room-game-picker *,[data-room-game-picker] *,.room-game-picker *").forEach(node => {
      if (node.children.length > 3) return;
      const label = String(node.innerText || node.textContent || "").trim();
      if (!label || label.length > 100) return;
      const id = gameIdFromText(label);
      if (id) candidates.add({ node, id });
    });

    candidates.forEach(({ node, id }) => {
      const enabled = gameAvailability[id] !== false;
      node.setAttribute("data-migo-game-managed", id);
      if (!enabled) {
        if (!node.hasAttribute("data-migo-previous-display")) {
          node.setAttribute("data-migo-previous-display", node.style.display || "");
        }
        node.hidden = true;
        node.style.setProperty("display", "none", "important");
        node.setAttribute("aria-hidden", "true");
      } else if (node.getAttribute("data-migo-game-managed") === id) {
        node.hidden = false;
        node.removeAttribute("aria-hidden");
        const previous = node.getAttribute("data-migo-previous-display");
        if (previous !== null) {
          if (previous) node.style.setProperty("display", previous);
          else node.style.removeProperty("display");
          node.removeAttribute("data-migo-previous-display");
        } else {
          node.style.removeProperty("display");
        }
      }
    });
    window.dispatchEvent(new CustomEvent("migo:game-availability-updated", { detail: { ...gameAvailability } }));
  }
  async function refreshGameAvailability() {
    if (!token()) return;
    const data = await api("/game-control/status", { method: "GET", cache: "no-store" });
    const catalog = await api("/games/catalog", { method: "GET", cache: "no-store" });
    const catalogIds = new Set((catalog.games || []).map(game => game.id));
    gameAvailability = Object.fromEntries((data.games || []).map(game => [
      game.id, game.enabled !== false && catalogIds.has(game.id)
    ]));
    applyGameAvailabilityToUI();
    return gameAvailability;
  }
  window.__migoRefreshGameAvailability = refreshGameAvailability;
  const gameUiObserver = new MutationObserver(() => applyGameAvailabilityToUI());
  if (document.body) gameUiObserver.observe(document.body, { childList: true, subtree: true });
  // Poll for owner changes while users remain inside the app; the server also blocks direct game API calls immediately.
  setInterval(() => { if (token() && document.visibilityState === "visible") refreshGameAvailability().catch(() => {}); }, 15000);
  document.addEventListener("click", event => {
    const node = event.target && event.target.closest && event.target.closest("[data-game-id],[data-game],[data-gameid],a[href],iframe[src]");
    if (!node) return;
    const id = gameIdFromText([node.getAttribute("data-game-id"),node.getAttribute("data-game"),node.getAttribute("data-gameid"),node.getAttribute("href"),node.getAttribute("src")].filter(Boolean).join(" "));
    if (id && gameAvailability[id] === false) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (typeof toast === "function") toast("هذه اللعبة متوقفة مؤقتًا من مالك التطبيق");
    }
  }, true);

  async function openOwnerUpdatePanel() {
    let modal = document.getElementById("migo-owner-update-panel");
    if (modal) { modal.remove(); return; }
    modal = document.createElement("div");
    modal.id = "migo-owner-update-panel";
    modal.style.cssText = "position:fixed;inset:0;z-index:999999;background:#000b;display:flex;align-items:center;justify-content:center;padding:16px;direction:rtl";
    modal.innerHTML = '<section style="width:min(100%,460px);max-height:90vh;overflow:auto;background:#21182b;color:#fff;border-radius:18px;padding:20px;font-family:inherit"><h3 style="margin:0 0 8px">التحكم في تحديثات ميجو لايف</h3><p style="color:#cbbbd8;font-size:13px;line-height:1.7">يمكنك إيقاف النسخ القديمة وإلزامها بالتواصل مع المالك للحصول على APK جديد.</p><label style="display:block;margin:12px 0 5px">أحدث رقم إصدار</label><input id="migo-up-latest" type="number" min="1" value="' + MIGO_APP_VERSION_CODE + '" style="box-sizing:border-box;width:100%;padding:12px;border-radius:10px"><label style="display:block;margin:12px 0 5px">أقل إصدار مسموح</label><input id="migo-up-min" type="number" min="1" value="' + MIGO_APP_VERSION_CODE + '" style="box-sizing:border-box;width:100%;padding:12px;border-radius:10px"><label style="display:block;margin:12px 0 5px">رابط ملف APK الجديد (اختياري)</label><input id="migo-up-url" type="url" placeholder="https://..." style="box-sizing:border-box;width:100%;padding:12px;border-radius:10px"><label style="display:flex;align-items:center;gap:9px;margin:16px 0"><input id="migo-up-enabled" type="checkbox"> تفعيل إيقاف الإصدارات القديمة</label><hr style="border:0;border-top:1px solid #493b55;margin:18px 0"><h4 style="margin:0 0 8px">التحكم في تشغيل التطبيق بالكامل</h4><label style="display:flex;align-items:center;gap:9px;margin:12px 0"><input id="migo-maint-enabled" type="checkbox"> إيقاف التطبيق أمام جميع المستخدمين</label><label style="display:block;margin:8px 0 5px">رسالة الإيقاف التي ستظهر للمستخدمين</label><textarea id="migo-maint-message" rows="3" style="box-sizing:border-box;width:100%;padding:12px;border-radius:10px">التطبيق متوقف مؤقتًا من مالك التطبيق. يُرجى التواصل مع مالك التطبيق.</textarea><div id="migo-up-status" role="status" style="font-size:13px;color:#e8c9ff;margin:8px 0"></div><button id="migo-up-save" type="button" style="width:100%;padding:14px;border:0;border-radius:12px;background:#a56be8;color:#fff;font-weight:900">حفظ وتطبيق الأمر</button><button id="migo-up-close" type="button" style="width:100%;padding:12px;margin-top:8px;border:1px solid #806a91;border-radius:12px;background:transparent;color:#fff">إغلاق</button></section>';
    document.body.appendChild(modal);
    modal.querySelector("#migo-up-close").onclick = () => modal.remove();
    const status = modal.querySelector("#migo-up-status");
    try {
      const response = await api("/app-updates/status?versionCode=" + MIGO_APP_VERSION_CODE, { method: "GET", cache: "no-store" });
      modal.querySelector("#migo-up-latest").value = response.latestVersionCode || MIGO_APP_VERSION_CODE;
      modal.querySelector("#migo-up-min").value = response.minimumVersionCode || MIGO_APP_VERSION_CODE;
      modal.querySelector("#migo-up-url").value = response.apkUrl || "";
      // enabled is intentionally loaded from the dedicated owner policy read below only.
      const policy = await api("/app-updates/policy", { method: "GET", cache: "no-store" });
      modal.querySelector("#migo-up-enabled").checked = !!policy.policy.enabled;
      modal.querySelector("#migo-maint-enabled").checked = !!policy.policy.maintenanceEnabled;
      modal.querySelector("#migo-maint-message").value = policy.policy.maintenanceMessage || "التطبيق متوقف مؤقتًا من مالك التطبيق. يُرجى التواصل مع مالك التطبيق.";
    } catch (error) { status.textContent = error.message || "تعذر تحميل الإعدادات"; }
    modal.querySelector("#migo-up-save").onclick = async () => {
      const saveButton = modal.querySelector("#migo-up-save");
      saveButton.disabled = true;
      status.textContent = "جارٍ الحفظ...";
      try {
        await api("/app-updates/policy", { method: "PUT", body: JSON.stringify({
          enabled: modal.querySelector("#migo-up-enabled").checked,
          maintenanceEnabled: modal.querySelector("#migo-maint-enabled").checked,
          maintenanceMessage: modal.querySelector("#migo-maint-message").value.trim(),
          latestVersionCode: Number(modal.querySelector("#migo-up-latest").value),
          minimumVersionCode: Number(modal.querySelector("#migo-up-min").value),
          apkUrl: modal.querySelector("#migo-up-url").value.trim()
        }) });
        status.textContent = modal.querySelector("#migo-maint-enabled").checked ? "تم إيقاف التطبيق للمستخدمين. حساب المالك ما زال يعمل ويمكنه إعادة تشغيله من هنا." : "تم حفظ الإعدادات وإتاحة التطبيق للمستخدمين.";
        if (modal.querySelector("#migo-up-enabled").checked && MIGO_APP_VERSION_CODE < Number(modal.querySelector("#migo-up-min").value)) {
          setTimeout(() => checkAppUpdatePolicy().catch(() => {}), 300);
        }
      } catch (error) { status.textContent = error.message || "تعذر حفظ الإعدادات"; }
      finally { saveButton.disabled = false; }
    };
  }

  // Recheck on login, app resume and after the server confirms the remembered identity.
  const originalStartForUpdate = typeof start === "function" ? start : null;
  if (originalStartForUpdate && $id("bin")) {
    const loginButton = $id("bin");
    const previousHandler = loginButton.onclick;
    if (typeof previousHandler === "function") {
      loginButton.onclick = async (...args) => {
        await previousHandler.apply(loginButton, args);
        if (token()) {
          const allowed = await checkAppUpdatePolicy();
          if (allowed) { installOwnerUpdatePanel(); refreshGameAvailability().catch(() => {}); }
        }
      };
    }
  }
  window.addEventListener("focus", () => {
    if (token()) checkAppUpdatePolicy().then(allowed => { if (allowed) { installOwnerUpdatePanel(); refreshGameAvailability().catch(() => {}); } }).catch(() => {});
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && token()) checkAppUpdatePolicy().then(allowed => { if (allowed) { installOwnerUpdatePanel(); refreshGameAvailability().catch(() => {}); } }).catch(() => {});
  });

  const ownerPanelObserver = new MutationObserver(() => installOwnerUpdatePanel());
  if (document.body) ownerPanelObserver.observe(document.body, { childList: true, subtree: true });

  // Expose owner controls to the native owner dashboard cards. The controls
  // are opened only by explicit clicks inside the administration menu.
  window.__migoOpenOwnerGameControlPanel = openOwnerGameControlPanel;
  window.__migoOpenOwnerUpdatePanel = openOwnerUpdatePanel;

  // Restore server identity validation for remembered sessions.
  if (token() && typeof me !== 'undefined' && me && DB.users[me]) {
    api('/auth/me').then(async (data) => {
      const key = await cacheUser(data.user);
      migrateLegacyProfile(data.user).catch((e) => console.warn('Legacy profile migration pending:', e.message));
      if (key !== me) { me = key; try { localStorage.setItem('mygo_session', key); } catch (_) {} }
      refreshWallet().catch(() => {});
      const allowed = await checkAppUpdatePolicy();
      if (allowed) { installOwnerUpdatePanel(); refreshGameAvailability().catch(e => console.warn("Game availability check failed:", e.message)); }
    }).catch(() => {
      saveToken('');
      if (typeof forceOut === 'function') forceOut('انتهت جلسة الدخول؛ سجّل الدخول مرة أخرى');
    });
  }
})();
