/* MigoLive production API bridge.
 * Authentication, wallet reads, rooms and direct messages use the Railway API.
 * Local UI data is only a presentation cache; server remains authoritative.
 */
(() => {
  'use strict';
  const API = 'https://migolive-api-production.up.railway.app/api';
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
      if (data.blocked) {
        showUpdateBlock(data, () => checkAppUpdatePolicy().catch(() => {}));
        return false;
      }
      hideUpdateBlock();
      return true;
    } catch (error) {
      // Fail closed: if the server cannot confirm the installed APK is allowed,
      // keep the app locked and let the user retry rather than bypass enforcement.
      showUpdateBlock({
        message: "تعذر التحقق من صلاحية إصدار التطبيق. اتصل بالإنترنت ثم أعد المحاولة."
      }, () => checkAppUpdatePolicy().catch(() => {}));
      console.warn("MigoLive update policy check failed:", error.message);
      return false;
    } finally {
      updateCheckRunning = false;
    }
  }
  window.__migoCheckAppUpdate = checkAppUpdatePolicy;

  // Owner-only control panel entry. The server independently checks role on save.
  function installOwnerUpdatePanel() {
    if (document.getElementById("migo-owner-update-entry") || typeof me === "undefined" || !me) return;
    const owner = DB && DB.users && DB.users[me] && DB.users[me].role === "owner";
    if (!owner) return;
    const entry = document.createElement("button");
    entry.id = "migo-owner-update-entry";
    entry.type = "button";
    entry.textContent = "⚙️ إدارة تحديث التطبيق";
    entry.style.cssText = "position:fixed;bottom:86px;left:12px;z-index:99990;border:0;border-radius:14px;padding:12px 15px;background:#6f35a5;color:#fff;font-weight:800;box-shadow:0 5px 18px #0003";
    entry.onclick = openOwnerUpdatePanel;
    document.body.appendChild(entry);
  }
  async function openOwnerUpdatePanel() {
    let modal = document.getElementById("migo-owner-update-panel");
    if (modal) { modal.remove(); return; }
    modal = document.createElement("div");
    modal.id = "migo-owner-update-panel";
    modal.style.cssText = "position:fixed;inset:0;z-index:999999;background:#000b;display:flex;align-items:center;justify-content:center;padding:16px;direction:rtl";
    modal.innerHTML = '<section style="width:min(100%,460px);max-height:90vh;overflow:auto;background:#21182b;color:#fff;border-radius:18px;padding:20px;font-family:inherit"><h3 style="margin:0 0 8px">التحكم في تحديثات ميجو لايف</h3><p style="color:#cbbbd8;font-size:13px;line-height:1.7">يمكنك إيقاف النسخ القديمة وإلزامها بالتواصل مع المالك للحصول على APK جديد.</p><label style="display:block;margin:12px 0 5px">أحدث رقم إصدار</label><input id="migo-up-latest" type="number" min="1" value="' + MIGO_APP_VERSION_CODE + '" style="box-sizing:border-box;width:100%;padding:12px;border-radius:10px"><label style="display:block;margin:12px 0 5px">أقل إصدار مسموح</label><input id="migo-up-min" type="number" min="1" value="' + MIGO_APP_VERSION_CODE + '" style="box-sizing:border-box;width:100%;padding:12px;border-radius:10px"><label style="display:block;margin:12px 0 5px">رابط ملف APK الجديد (اختياري)</label><input id="migo-up-url" type="url" placeholder="https://..." style="box-sizing:border-box;width:100%;padding:12px;border-radius:10px"><label style="display:flex;align-items:center;gap:9px;margin:16px 0"><input id="migo-up-enabled" type="checkbox"> تفعيل إيقاف الإصدارات القديمة</label><div id="migo-up-status" role="status" style="font-size:13px;color:#e8c9ff;margin:8px 0"></div><button id="migo-up-save" type="button" style="width:100%;padding:14px;border:0;border-radius:12px;background:#a56be8;color:#fff;font-weight:900">حفظ وتطبيق الأمر</button><button id="migo-up-close" type="button" style="width:100%;padding:12px;margin-top:8px;border:1px solid #806a91;border-radius:12px;background:transparent;color:#fff">إغلاق</button></section>';
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
    } catch (error) { status.textContent = error.message || "تعذر تحميل الإعدادات"; }
    modal.querySelector("#migo-up-save").onclick = async () => {
      const saveButton = modal.querySelector("#migo-up-save");
      saveButton.disabled = true;
      status.textContent = "جارٍ الحفظ...";
      try {
        await api("/app-updates/policy", { method: "PUT", body: JSON.stringify({
          enabled: modal.querySelector("#migo-up-enabled").checked,
          latestVersionCode: Number(modal.querySelector("#migo-up-latest").value),
          minimumVersionCode: Number(modal.querySelector("#migo-up-min").value),
          apkUrl: modal.querySelector("#migo-up-url").value.trim()
        }) });
        status.textContent = "تم حفظ إعدادات التحديث على الخادم.";
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
          if (allowed) installOwnerUpdatePanel();
        }
      };
    }
  }
  window.addEventListener("focus", () => {
    if (token()) checkAppUpdatePolicy().then(allowed => { if (allowed) installOwnerUpdatePanel(); }).catch(() => {});
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && token()) checkAppUpdatePolicy().then(allowed => { if (allowed) installOwnerUpdatePanel(); }).catch(() => {});
  });

  // Restore server identity validation for remembered sessions.
  if (token() && typeof me !== 'undefined' && me && DB.users[me]) {
    api('/auth/me').then(async (data) => {
      const key = await cacheUser(data.user);
      migrateLegacyProfile(data.user).catch((e) => console.warn('Legacy profile migration pending:', e.message));
      if (key !== me) { me = key; try { localStorage.setItem('mygo_session', key); } catch (_) {} }
      refreshWallet().catch(() => {});
      const allowed = await checkAppUpdatePolicy();
      if (allowed) installOwnerUpdatePanel();
    }).catch(() => {
      saveToken('');
      if (typeof forceOut === 'function') forceOut('انتهت جلسة الدخول؛ سجّل الدخول مرة أخرى');
    });
  }
})();
