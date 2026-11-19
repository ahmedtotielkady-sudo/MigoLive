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

  // Server-controlled mandatory update gate. APK installation still requires Android confirmation.
  const MIGO_APP_VERSION = '1.0.1';
  let updateGateVisible = false;
  function compareVersions(a, b) {
    const pa=String(a||'0').split(/[+-]/)[0].split('.').map(Number);
    const pb=String(b||'0').split(/[+-]/)[0].split('.');
    for(let i=0;i<3;i++){const x=pa[i]||0,y=pb[i]||0;if(x!==y)return x<y?-1:1}
    return 0;
  }
  function showMandatoryUpdate(policy) {
    if(updateGateVisible)return;
    updateGateVisible=true;
    const overlay=document.createElement('div');
    overlay.id='migo-mandatory-update';
    overlay.style.cssText='position:fixed;inset:0;z-index:2147483647;background:#090516;color:#fff;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,sans-serif;text-align:center';
    const card=document.createElement('div');
    card.style.cssText='width:100%;max-width:420px;background:#1a1035;border:1px solid #7542bb;border-radius:22px;padding:26px;box-shadow:0 12px 50px #0009';
    const title=document.createElement('h2');title.textContent='📲 تحديث إجباري مطلوب';title.style.cssText='font-size:24px;margin:0 0 14px;color:#ffc24a';
    const message=document.createElement('p');message.textContent=policy.message||'يتوفر تحديث جديد. حدّث التطبيق للمتابعة.';message.style.cssText='line-height:1.8;margin:0 0 18px';
    const version=document.createElement('p');version.textContent='الإصدار المطلوب: '+policy.minimumVersion;version.style.cssText='color:#c7b5ee;margin:0 0 20px';
    const button=document.createElement('button');button.type='button';button.textContent='تنزيل التحديث';button.style.cssText='width:100%;padding:15px;border:0;border-radius:13px;background:linear-gradient(90deg,#7c3aed,#a855f7);color:white;font-weight:800;font-size:16px';
    button.onclick=()=>{if(/^https:\/\//i.test(policy.downloadUrl||''))location.href=policy.downloadUrl;else alert('رابط التحديث غير متاح حالياً. تواصل مع الإدارة.')};
    card.append(title,message,version,button);overlay.append(card);document.body.append(overlay);
    document.body.style.overflow='hidden';
  }
  async function installedAppVersion(){
    try{
      const app=window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.App;
      if(app&&typeof app.getInfo==='function'){
        const info=await app.getInfo();
        if(info&&info.version)return String(info.version);
      }
    }catch(_){}
    return MIGO_APP_VERSION;
  }
  let installedVersionPromise=null;
  async function checkMandatoryUpdate(){
    try{
      const response=await fetch(API+'/app-update/status',{cache:'no-store'});
      if(!response.ok)return;
      const data=await response.json(),policy=data.policy||{};
      if(!policy.enabled)return;
      if(!installedVersionPromise)installedVersionPromise=installedAppVersion();
      const installed=await installedVersionPromise;
      if(compareVersions(installed,policy.minimumVersion)<0)showMandatoryUpdate(policy);
    }catch(_){}
  }
  checkMandatoryUpdate();
  setInterval(checkMandatoryUpdate,60000);

  const message = (text) => { const el = $id('aerr'); if (el) el.textContent = text; else if (typeof toast === 'function') toast(text); };

  // Bind the existing owner Coins form to the server-authoritative wallet.
  // No new controls are added; only the existing username/amount/Execute form is handled.
  const ownerAdjustmentRetries = new WeakMap();
  function findCoinsAdjustmentForm(node) {
    let root = node && node.closest && (node.closest('form') || node.closest('[role="form"]'));
    if (!root && node && node.parentElement) {
      let current = node.parentElement;
      for (let depth = 0; depth < 5 && current; depth++, current = current.parentElement) {
        const fields = Array.from(current.querySelectorAll('input'));
        if (fields.some(x => /اسم المستخدم/.test(x.placeholder || '')) &&
            fields.some(x => /العدد/.test(x.placeholder || ''))) { root = current; break; }
      }
    }
    if (!root) return null;
    const inputs = Array.from(root.querySelectorAll('input'));
    const username = inputs.find(x => /اسم المستخدم/.test(x.placeholder || ''));
    const amount = inputs.find(x => /العدد/.test(x.placeholder || ''));
    return username && amount ? { root, username, amount } : null;
  }
  async function submitExistingCoinsAdjustment(node) {
    const form = findCoinsAdjustmentForm(node);
    if (!form) return false;
    const username = String(form.username.value || '').trim().toLowerCase();
    const rawAmount = String(form.amount.value || '').trim()
      .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٬/g, '').replace(/٫/g, '.');
    const amount = Number(rawAmount);
    if (!/^[a-z0-9_.-]{3,24}$/.test(username) || !Number.isSafeInteger(amount) ||
        amount === 0 || Math.abs(amount) > 1000000000) {
      if (typeof toast === 'function') toast('اكتب اسم مستخدم صحيحًا وعدد عملات صحيحًا غير صفر');
      return true;
    }
    let pending = ownerAdjustmentRetries.get(form.root);
    if (!pending || pending.username !== username || pending.amount !== amount) {
      if (!window.crypto || !window.crypto.getRandomValues) {
        if (typeof toast === 'function') toast('تعذر تأمين العملية');
        return true;
      }
      const bytes = new Uint8Array(20);
      window.crypto.getRandomValues(bytes);
      pending = { username, amount, key: 'owner-adjust-' +
        Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('') };
      ownerAdjustmentRetries.set(form.root, pending);
    }
    const button = Array.from(form.root.querySelectorAll('button,input[type="submit"]'))
      .find(x => /تنفيذ/.test(x.textContent || x.value || ''));
    if (button) button.disabled = true;
    try {
      const data = await api('/wallet/admin/adjust', {
        method: 'POST',
        headers: { 'Idempotency-Key': pending.key },
        body: JSON.stringify({
          username,
          amount,
          description: amount < 0 ? 'خصم من صفحة العملات' : 'شحن من صفحة العملات'
        })
      });
      ownerAdjustmentRetries.delete(form.root);
      if (typeof toast === 'function') {
        toast((amount < 0 ? 'تم الخصم بنجاح' : 'تم الشحن بنجاح') +
          ' · الرصيد الحالي: ' + Number(data.coins).toLocaleString('ar-EG') + ' عملة');
      }
      if (typeof me !== 'undefined' && me && DB?.users?.[me] &&
          Number(DB.users[me].uid) === Number(data.uid)) refreshWallet().catch(() => {});
    } catch (error) {
      if (typeof toast === 'function') {
        toast('لم يتم تأكيد العملية: ' + error.message +
          ' · أعد المحاولة بنفس البيانات دون تغييرها لتجنب تكرار الشحن');
      }
    } finally {
      if (button) button.disabled = false;
    }
    return true;
  }
  document.addEventListener('submit', async event => {
    const form = findCoinsAdjustmentForm(event.target);
    if (!form) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    await submitExistingCoinsAdjustment(form.root);
  }, true);
  document.addEventListener('click', async event => {
    const button = event.target && event.target.closest &&
      event.target.closest('button,input[type="submit"]');
    if (!button || !/تنفيذ/.test(button.textContent || button.value || '')) return;
    const form = findCoinsAdjustmentForm(button);
    if (!form) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    await submitExistingCoinsAdjustment(form.root);
  }, true);

  const cacheUser = async (user, password) => {
    const key = 'server-' + String(user.uid);
    const old = DB.users[key] || {};
    DB.users[key] = Object.assign(old, {
      name: user.displayName || user.username || ('عضو ' + user.uid),
      username: user.username, phone: user.phone || '', uid: user.uid,
      coins: Number(user.coins) || 0, role: user.role || 'user',
      avatar: user.avatar || '', pass: password ? await hash(password) : (old.pass || ''),
      serverId: user.id, serverBacked: true, banned: false
    });
    return key;
  };
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

  async function refreshWallet() {
    if (!token() || typeof me === 'undefined' || !me || !DB.users[me]) return;
    const data = await api('/wallet');
    DB.users[me].coins = Number(data.coins) || 0;
    save();
    const top = $id('mycoins');
    if (top) top.textContent = DB.users[me].coins;
    const walletBalance = document.querySelector('#main [data-server-wallet-balance]');
    if (walletBalance) walletBalance.textContent = DB.users[me].coins;
    return data;
  }

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

  // Restore server identity validation for remembered sessions.
  if (token() && typeof me !== 'undefined' && me && DB.users[me]) {
    api('/auth/me').then(async (data) => {
      const key = await cacheUser(data.user);
      if (key !== me) { me = key; try { localStorage.setItem('mygo_session', key); } catch (_) {} }
      refreshWallet().catch(() => {});
    }).catch(() => {
      saveToken('');
      if (typeof forceOut === 'function') forceOut('انتهت جلسة الدخول؛ سجّل الدخول مرة أخرى');
    });
  }
})();
