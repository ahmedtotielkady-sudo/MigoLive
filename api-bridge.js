/* MigoLive production API bridge.
 * Authentication, wallet reads, rooms and direct messages use the Railway API.
 * Local UI data is only a presentation cache; server remains authoritative.
 */
(() => {
  'use strict';
  const API = 'https://migolive-api-production.up.railway.app/api';
  const TOKEN_KEY = 'migolive_api_token_v1';
  const DEVICE_KEY = 'migolive_device_id_v1';
  let deviceInfoPromise = null;
  async function deviceHeaders() {
    if (!deviceInfoPromise) deviceInfoPromise = (async () => {
      let id = ''; let info = {};
      try {
        const nativeDevice = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Device;
        if (nativeDevice && typeof nativeDevice.getId === 'function') { const result = await nativeDevice.getId(); id = String(result && result.identifier || ''); }
        if (nativeDevice && typeof nativeDevice.getInfo === 'function') info = await nativeDevice.getInfo() || {};
      } catch (_) {}
      try {
        if (!id) id = localStorage.getItem(DEVICE_KEY) || '';
        if (!id) { const bytes = new Uint8Array(24); if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes); else for (let i=0;i<bytes.length;i++) bytes[i]=Math.floor(Math.random()*256); id = Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''); }
        localStorage.setItem(DEVICE_KEY,id);
      } catch (_) {}
      const ua = navigator.userAgent || '';
      const match = ua.match(/;\s*([^;)]+)\s+Build\//i);
      let appVersion = String(info.appVersion || '');
      try { if (!appVersion && typeof installedAppVersion === 'function') appVersion = await installedAppVersion(); } catch (_) {}
      return { 'X-Migo-Device-ID': id, 'X-Migo-Device-Platform': String(info.platform || (window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform()) || 'web').slice(0,32), 'X-Migo-Device-Model': String(info.model || (match && match[1]) || 'غير معروف').slice(0,120), 'X-Migo-Device-Manufacturer': String(info.manufacturer || '').slice(0,80), 'X-Migo-OS-Version': String(info.osVersion || '').slice(0,40), 'X-Migo-App-Version': String(appVersion || '1.0.1').slice(0,32) };
    })();
    return deviceInfoPromise;
  }
  const $id = (id) => document.getElementById(id);
  const token = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; } };
  const saveToken = (v) => { try { if (v) localStorage.setItem(TOKEN_KEY, v); else localStorage.removeItem(TOKEN_KEY); } catch (_) {} };
  async function api(path, options = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, await deviceHeaders(), options.headers || {});
    if (token()) headers.Authorization = 'Bearer ' + token();
    let response;
    const method = String(options.method || 'GET').toUpperCase();
    const requestOptions = Object.assign({}, options, { headers });
    // Wallet polling must bypass browser/WebView ETag caching: a 304 has no JSON
    // body and the API wrapper correctly treats it as a failed API response.
    if (method === 'GET') requestOptions.cache = 'no-store';
    try {
      response = await fetch(API + path, requestOptions);
      markNetworkOnline();
    } catch (error) {
      markNetworkOffline();
      throw error;
    }
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok || data.ok === false) {
      const error = new Error(data.message || ('HTTP ' + response.status));
      // Preserve authoritative server balance on rejected game bets so the iframe
      // can reconcile immediately instead of keeping a stale local wallet value.
      if (Number.isSafeInteger(Number(data.coins)) && Number(data.coins) >= 0) {
        error.coins = Number(data.coins);
      }
      error.status = response.status;
      throw error;
    }
    return data;
  }
  window.migoApi = api;
  window.migoDeviceHeaders = deviceHeaders;

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
      if(!installedVersionPromise)installedVersionPromise=installedAppVersion();
      const installed=await installedVersionPromise;
      const response=await fetch(API+'/app-update/status?version='+encodeURIComponent(installed),{cache:'no-store'});
      if(!response.ok)return;
      const data=await response.json(),policy=data.policy||{};
      const individuallyBlocked=Array.isArray(policy.blockedVersions)&&policy.blockedVersions.includes(installed);
      if(individuallyBlocked||(policy.enabled&&compareVersions(installed,policy.minimumVersion)<0))showMandatoryUpdate(policy);
    }catch(_){}
  }
  checkMandatoryUpdate();
  setInterval(checkMandatoryUpdate,60000);

  const message = (text) => { const el = $id('aerr'); if (el) el.textContent = text; else if (typeof toast === 'function') toast(text); };

  // Graceful offline gate: wait 7 seconds before blocking the app, then resume automatically.
  let offlineTimer = null;
  let offlineOverlay = null;
  function showOfflineGate() {
    if (offlineOverlay || !document.body) return;
    offlineOverlay = document.createElement('div');
    offlineOverlay.id = 'migo-offline-gate';
    offlineOverlay.setAttribute('role', 'alert');
    offlineOverlay.setAttribute('aria-live', 'assertive');
    offlineOverlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(8,5,20,.97);color:#fff;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,sans-serif;text-align:center';
    const card = document.createElement('div');
    card.style.cssText = 'width:100%;max-width:380px;background:#1a1035;border:1px solid #7542bb;border-radius:20px;padding:28px 22px;box-shadow:0 12px 50px #0009';
    const title = document.createElement('h2');
    title.textContent = '📡 الإنترنت لا يعمل';
    title.style.cssText = 'font-size:23px;margin:0 0 12px;color:#ffc24a';
    const note = document.createElement('p');
    note.textContent = 'تأكد من اتصالك بالإنترنت. سيعود التطبيق للعمل تلقائياً بمجرد رجوع الاتصال.';
    note.style.cssText = 'line-height:1.9;margin:0;color:#eee';
    card.append(title, note);
    offlineOverlay.append(card);
    document.body.append(offlineOverlay);
    document.body.style.overflow = 'hidden';
  }
  function clearOfflineGate() {
    if (offlineTimer) clearTimeout(offlineTimer);
    offlineTimer = null;
    if (offlineOverlay) offlineOverlay.remove();
    offlineOverlay = null;
    if (!document.getElementById('migo-mandatory-update')) document.body.style.overflow = '';
  }
  function markNetworkOffline() {
    if (offlineTimer || offlineOverlay) return;
    offlineTimer = setTimeout(() => {
      offlineTimer = null;
      showOfflineGate();
    }, 7000);
  }
  function markNetworkOnline() {
    clearOfflineGate();
  }
  window.addEventListener('offline', markNetworkOffline);
  window.addEventListener('online', () => {
    markNetworkOnline();
    if (typeof refreshWalletSafely === 'function') refreshWalletSafely();
  });
  if (navigator.onLine === false) markNetworkOffline();


  // Bind the existing owner Coins form to the server-authoritative wallet.
  // No new controls are added; only the existing username/amount/Execute form is handled.
  const ownerAdjustmentRetries = new WeakMap();
  function findCoinsAdjustmentForm(node) {
    let root = node && node.closest && (node.closest('form') || node.closest('[role="form"]'));
    if (!root && node && node.parentElement) {
      let current = node.parentElement;
      for (let depth = 0; depth < 5 && current; depth++, current = current.parentElement) {
        const fields = Array.from(current.querySelectorAll('input'));
        // Accept both the original placeholder and the normalized ID placeholder.
        // The first server-backed adjustment changes the placeholder, so matching
        // only "اسم المستخدم" made later clicks fall through to the local handler.
        if (fields.some(x => /اسم المستخدم|رقم ID المستخدم|رقم المعرف/i.test(x.placeholder || '')) &&
            fields.some(x => /العدد/.test(x.placeholder || ''))) { root = current; break; }
      }
    }
    if (!root) return null;
    const inputs = Array.from(root.querySelectorAll('input'));
    const username = inputs.find(x => /اسم المستخدم|رقم ID المستخدم|رقم المعرف/i.test(x.placeholder || ''));
    const amount = inputs.find(x => /العدد/.test(x.placeholder || ''));
    if (username) username.placeholder = 'رقم ID المستخدم';
    return username && amount ? { root, username, amount } : null;
  }
  async function submitExistingCoinsAdjustment(node) {
    const form = findCoinsAdjustmentForm(node);
    if (!form) return false;
    const rawUid = String(form.username.value || '').trim()
      .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٬/g, '');
    const targetUid = Number(rawUid);
    const rawAmount = String(form.amount.value || '').trim()
      .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٬/g, '').replace(/٫/g, '.');
    const amount = Number(rawAmount);
    if (!/^\d{6,10}$/.test(rawUid) || !Number.isSafeInteger(targetUid) || !Number.isSafeInteger(amount) ||
        amount === 0 || Math.abs(amount) > 1000000000) {
      if (typeof toast === 'function') toast('اكتب رقم ID صحيحًا (6 إلى 10 أرقام) وعدد عملات صحيحًا غير صفر');
      return true;
    }
    let pending = ownerAdjustmentRetries.get(form.root);
    if (!pending || pending.targetUid !== targetUid || pending.amount !== amount) {
      if (!window.crypto || !window.crypto.getRandomValues) {
        if (typeof toast === 'function') toast('تعذر تأمين العملية');
        return true;
      }
      const bytes = new Uint8Array(20);
      window.crypto.getRandomValues(bytes);
      pending = { targetUid, amount, key: 'owner-adjust-' +
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
          targetUid,
          amount,
          description: amount < 0 ? 'خصم من صفحة العملات' : 'شحن من صفحة العملات'
        })
      });
      ownerAdjustmentRetries.delete(form.root);
      // Keep the owner's local user list in step with the committed server balance.
      // The API remains authoritative; this only refreshes the presentation cache.
      if (data && Number.isSafeInteger(Number(data.uid)) && Number.isFinite(Number(data.coins))) {
        const targetKey = Object.keys(DB.users || {}).find(key =>
          Number(DB.users[key] && DB.users[key].uid) === Number(data.uid));
        if (targetKey) {
          DB.users[targetKey].coins = Number(data.coins);
          save();
        }
      }
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
  // Approve receipt-backed package top-ups on the server, not only in localStorage.
  // The top-up request itself is local in this build; approval is the point where
  // the canonical server wallet must be credited.
  async function approveTopupOnServer(button) {
    const index = Number(button && button.getAttribute('data-tok'));
    const topup = Number.isInteger(index) && index >= 0 ? DB.topups[index] : null;
    const user = topup && DB.users[topup.user];
    const targetUid = Number(user && user.uid);
    const amount = Number(topup && topup.amount);
    if (!topup || topup.status !== 'pending' || !user ||
        !Number.isSafeInteger(targetUid) || targetUid < 100000 ||
        !Number.isSafeInteger(amount) || amount < 1) {
      if (typeof toast === 'function') toast('طلب الشحن غير صالح أو تمت معالجته');
      return;
    }
    if (button) button.disabled = true;
    try {
      const stableId = String(topup.id || '');
      if (!/^\d{10,20}$/.test(stableId)) throw new Error('رقم طلب الشحن غير صالح');
      const data = await api('/wallet/admin/adjust', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'topup-approval-' + stableId },
        body: JSON.stringify({
          targetUid,
          amount,
          description: 'اعتماد طلب شحن بإيصال' + (topup.pack ? ' · باقة ' + Number(topup.pack.coins || amount) : '')
        })
      });
      // Only mark the receipt approved after the server confirms its atomic ledger write.
      topup.status = 'ok';
      user.coins = Number(data.coins);
      if (typeof addCharge === 'function') addCharge(topup.user, amount);
      if (typeof notifyUserResult === 'function') {
        notifyUserResult(topup.user, 'تم تنفيذ شحن ' + amount.toLocaleString('ar-EG') +
          ' عملة بنجاح. رصيدك الآن ' + Number(data.coins).toLocaleString('ar-EG') + ' عملة');
      }
      if (typeof logIt === 'function') logIt('مالك', 'شحن ' + amount + ' عملة لـ ' + (user.name || targetUid) + ' (إيصال)');
      save();
      if (typeof toast === 'function') toast('تم الشحن وحفظ الرصيد على الخادم');
      if (typeof render === 'function') render();
      window.dispatchEvent(new Event('migo:wallet-updated'));
    } catch (error) {
      if (typeof toast === 'function') {
        toast('لم يتم تأكيد الشحن على الخادم: ' + (error.message || 'خطأ غير معروف') +
          ' · الطلب لم يُعتمد محلياً، ويمكن إعادة المحاولة بأمان');
      }
    } finally {
      if (button) button.disabled = false;
    }
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
    if (!button) return;
    if (button.hasAttribute('data-tok')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      await approveTopupOnServer(button);
      return;
    }
    if (!/تنفيذ/.test(button.textContent || button.value || '')) return;
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
      username: user.username, phone: user.phone || '', email: user.email || '', uid: user.uid,
      coins: Number(user.coins) || 0, role: user.role || 'user',
      avatar: user.avatar || '', pass: password ? await hash(password) : (old.pass || ''),
      serverId: user.id, serverBacked: true, banned: false
    });
    return key;
  };
  // Add a country-aware registration contact form without replacing the existing auth screen.
  function installInternationalContactFields() {
    const phoneInput = $id('reg-phone');
    if (!phoneInput || $id('reg-country')) return;
    const countryWrap = document.createElement('div');
    countryWrap.id = 'reg-phone-country-wrap';
    countryWrap.style.cssText = 'display:flex;gap:8px;align-items:center;margin:8px 0;width:100%';
    const countrySelect = document.createElement('select');
    countrySelect.id = 'reg-country';
    countrySelect.className = 'in';
    countrySelect.setAttribute('aria-label', 'دولة رقم الهاتف');
    countrySelect.style.cssText = 'flex:1;min-width:0;margin:0;direction:rtl';
    countrySelect.innerHTML = '<option value="EG">🇪🇬 مصر (+20)</option>';
    countryWrap.append(countrySelect);
    phoneInput.insertAdjacentElement('beforebegin', countryWrap);

    const emailInput = document.createElement('input');
    emailInput.id = 'reg-email';
    emailInput.type = 'email';
    emailInput.className = 'in hide';
    emailInput.autocomplete = 'email';
    emailInput.inputMode = 'email';
    emailInput.placeholder = 'البريد الإلكتروني (بديل رقم الهاتف)';
    emailInput.setAttribute('aria-label', 'البريد الإلكتروني');
    emailInput.style.cssText = 'width:100%;box-sizing:border-box';
    phoneInput.insertAdjacentElement('afterend', emailInput);

    let allCountries = [{ country: 'EG', callingCode: '+20', name: 'مصر' }];
    const flagFor = code => String(code || '').toUpperCase().replace(/[A-Z]/g, c => String.fromCodePoint(127397 + c.charCodeAt(0)));
    const renderCountries = () => {
      const previous = countrySelect.value || 'EG';
      const list = allCountries;
      countrySelect.innerHTML = '';
      list.forEach(c => {
        const option = document.createElement('option');
        option.value = c.country;
        option.textContent = flagFor(c.country) + ' ' + c.name + ' (' + c.callingCode + ')';
        countrySelect.append(option);
      });
      if (list.some(c => c.country === previous)) countrySelect.value = previous;
      else if (list.some(c => c.country === 'EG')) countrySelect.value = 'EG';
      else if (list.length) countrySelect.value = list[0].country;
    };
    api('/auth/phone-countries').then(data => {
      if (Array.isArray(data.countries) && data.countries.length) {
        allCountries = data.countries;
        renderCountries();
      }
    }).catch(error => console.warn('Country list unavailable:', error.message));

    const syncVisibility = () => {
      const registering = !!(typeof reg !== 'undefined' && reg);
      countryWrap.classList.toggle('hide', !registering);
      emailInput.classList.toggle('hide', !registering);
    };
    const switchButton = $id('bsw');
    if (switchButton && !switchButton.dataset.migoContactWrapped) {
      const prior = switchButton.onclick;
      switchButton.onclick = function () {
        if (typeof prior === 'function') prior.apply(this, arguments);
        syncVisibility();
      };
      switchButton.dataset.migoContactWrapped = '1';
    }
    syncVisibility();
  }
  installInternationalContactFields();
  const originalLogin = $id('bin') && $id('bin').onclick;
  if ($id('bin') && typeof originalLogin === 'function') {
    $id('bin').onclick = async () => {
      const rawInput = ($id('u')?.value || '');
      const raw = rawInput.normalize('NFKC').trim();
      const phoneCountry = $id('reg-country')?.value || 'EG';
      let phone = ($id('reg-phone')?.value || '').trim()
        .replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d))
        .replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
        .replace(/[\s\u00a0\u200e\u200f\u202a-\u202e()-]/g,'');
      if (phoneCountry === 'EG') {
        if(/^01[0-9]{9}$/.test(phone)) phone='+20'+phone.slice(1);
        else if(/^00201[0-9]{9}$/.test(phone)) phone='+20'+phone.slice(4);
        else if(/^201[0-9]{9}$/.test(phone)) phone='+'+phone;
      }
      const email = ($id('reg-email')?.value || '').trim().toLowerCase();
      const password = $id('p')?.value || '';
      const registering = !!(typeof reg !== 'undefined' && reg);
      if (!raw || !password) return message('أدخل اسم المستخدم وكلمة المرور');
      if (registering) {
        const usernameLength = [...raw].length;
        if (usernameLength < 3) return message('اسم المستخدم يجب أن يكون 3 أحرف على الأقل');
        if (usernameLength > 24) return message('اسم المستخدم يجب ألا يزيد عن 24 حرفاً');
        if (!/^[\p{L}\p{N}_.-]+$/u.test(raw)) {
          return message('اسم المستخدم يقبل الحروف والأرقام والشرطة والشرطة السفلية والنقطة فقط، دون مسافات');
        }
        if (!phone && !email) return message('أدخل رقم الهاتف أو البريد الإلكتروني');
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return message('البريد الإلكتروني غير صحيح');
      }
      if (password.length < (registering ? 8 : 1)) return message(registering ? 'كلمة المرور يجب ألا تقل عن 8 أحرف' : 'أدخل كلمة المرور');
      const button = $id('bin');
      if (button) button.disabled = true;
      try {
        let data;
        if (registering) {
          data = await api('/auth/register', { method: 'POST', body: JSON.stringify({
            username: raw, displayName: raw, phone, phoneCountry, email, password
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

  function applyServerWalletCoins(value) {
    const coins = Math.max(0, Math.floor(Number(value) || 0));
    if (typeof me !== 'undefined' && me && DB.users[me]) {
      DB.users[me].coins = coins;
      save();
    }
    const top = $id('mycoins');
    if (top) top.textContent = coins.toLocaleString('en-US');
    document.querySelectorAll('[data-server-wallet-balance]').forEach(node => {
      node.textContent = coins.toLocaleString('en-US');
    });
    // Push the canonical server balance to every active game immediately.
    const gameFrames = [$id('gf'), ...document.querySelectorAll('#migo-game-overlay iframe')].filter(Boolean);
    gameFrames.forEach(frame => {
      try { frame.contentWindow.postMessage({ t: 'bal', v: coins }, '*'); } catch (_) {}
    });
    return coins;
  }

  async function refreshWallet() {
    if (!token() || typeof me === 'undefined' || !me || !DB.users[me]) return;
    const data = await api('/wallet');
    applyServerWalletCoins(data.coins);
    return data;
  }

  // The server is authoritative for incoming transfers and owner/agency credits.
  // Refresh while the app is foregrounded so a recipient sees newly received coins
  // without signing out or reopening the wallet. Pause polling while a game is open.
  let walletRefreshBusy = false;
  async function refreshWalletSafely() {
    if (walletRefreshBusy || document.visibilityState === 'hidden') return;
    walletRefreshBusy = true;
    try { await refreshWallet(); }
    catch (error) { console.warn('Server wallet sync pending:', error.message); }
    finally { walletRefreshBusy = false; }
  }
  // Socket.IO pushes wallet changes immediately; reconcile with the server
  // every second while the app is visible to recover missed events safely.
  // The busy guard prevents overlapping requests on slow connections.
  setInterval(refreshWalletSafely, 1000);
  window.addEventListener('focus', refreshWalletSafely);
  document.addEventListener('visibilitychange', refreshWalletSafely);
  window.addEventListener('migo:wallet-updated', refreshWalletSafely);

  // Secure game-to-server bridge: the game iframe requests a server-settled
  // round; it never supplies a resulting balance or payout.
  function gameRequestKey(prefix) {
    if (!window.crypto || !window.crypto.getRandomValues) throw new Error('تعذر تأمين الجولة');
    const bytes = new Uint8Array(20);
    window.crypto.getRandomValues(bytes);
    return prefix + '-' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }
  window.addEventListener('message', async event => {
    const request = event.data;
    if (!gameFrameFor(event.source) || !request ||
        request.t !== 'migo:game:slot-777:spin') return;
    const reply = (payload) => {
      try { event.source.postMessage(Object.assign({
        t: 'migo:game:slot-777:result', requestId: request.requestId
      }, payload), event.origin || '*'); } catch (_) {}
    };
    const bet = Number(request.bet);
    if (typeof request.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(request.requestId) ||
        !Number.isSafeInteger(bet) || bet <= 0) {
      reply({ ok: false, message: 'بيانات الرهان غير صحيحة' });
      return;
    }
    try {
      const result = await api('/games/slot-777/spin', {
        method: 'POST',
        headers: { 'Idempotency-Key': request.requestId },
        body: JSON.stringify({ bet })
      });
      reply({ ok: true, result });
      refreshWalletSafely();
    } catch (error) {
      reply({ ok: false, message: error.message || 'تعذر تنفيذ الجولة على الخادم' });
    }
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

  // Server-authoritative settlement bridge for every game iframe.
  // Iframes submit bets/choices only; balances and payouts are never client supplied.
  const GAME_ACTIONS = {
    'slot-777:spin': '/games/slot-777/spin',
    'ocean-storm:spin': '/games/ocean-storm/spin',
    'wheel-animals:spin': '/games/wheel-animals/spin',
    'fruit-luck:spin': '/games/fruit-luck/spin',
    'big-warrior:fight': '/games/big-warrior/fight',
    'cleopatra-gold:spin': '/games/cleopatra-gold/spin',
    'rocket-crash:start': '/games/rocket-crash/start',
    'rocket-crash:state': '/games/rocket-crash/state',
    'rocket-crash:cashout': '/games/rocket-crash/cashout',
    'rocket-crash:cancel': '/games/rocket-crash/cancel',
    'veggie:state': '/games/veggie/state',
    'veggie:bet': '/games/veggie/bet'
  };
  function gameFrameFor(source) {
    const frames = [$id('gf'), document.querySelector('#migo-game-overlay iframe')].filter(Boolean);
    return frames.find(frame => frame.contentWindow === source) || null;
  }
  function validateGameServerResult(gameId, action, result) {
    if (!result || result.gameId !== gameId ||
        !Number.isSafeInteger(Number(result.coins)) || Number(result.coins) < 0) {
      throw new Error('رد الخادم غير مكتمل: لم يتم تأكيد رصيد الجولة');
    }
    if (action === 'state' || action === 'wallet') {
      if (gameId === 'veggie' && action === 'state' &&
          (!result.roundId || !Number.isFinite(Number(result.startsAt)) ||
           !['bet', 'spin', 'result'].includes(result.phase) ||
           (result.outcome && !['single', 'group'].includes(result.outcome.type)))) {
        throw new Error('بيانات جولة الخضار غير مكتملة');
      }
      return result;
    }
    if (gameId === 'veggie' && action === 'bet') {
      if (!Array.isArray(result.outcome && result.outcome.amounts) ||
          result.outcome.amounts.length !== 8 || !Number.isFinite(Number(result.bet))) {
        throw new Error('تأكيد رهان الخضار غير مكتمل');
      }
      return result;
    }
    if (typeof result.roundId !== 'string' || !result.roundId) {
      throw new Error('رد الخادم لا يحتوي على رقم الجولة');
    }
    if (action === 'start') {
      if (!Number.isFinite(Number(result.startAt))) throw new Error('بيانات بدء الجولة غير مكتملة');
      return result;
    }
    if (action === 'cancel') {
      if (!Number.isFinite(Number(result.refunded))) throw new Error('بيانات استرداد الرهان غير مكتملة');
      return result;
    }
    if (action === 'cashout') {
      if (!Number.isFinite(Number(result.payout))) throw new Error('بيانات سحب الأرباح غير مكتملة');
      return result;
    }
    if (!Number.isFinite(Number(result.payout)) || !result.outcome || typeof result.outcome !== 'object') {
      throw new Error('نتيجة اللعبة أو قيمة الربح غير مكتملة من الخادم');
    }
    const o = result.outcome;
    if (gameId === 'slot-777' &&
        (!Array.isArray(o.grid) || o.grid.length !== 5 || o.grid.some(col => !Array.isArray(col) || col.length !== 3))) {
      throw new Error('شبكة نتيجة سلوت 777 غير مكتملة');
    }
    if (gameId === 'ocean-storm' &&
        (!Array.isArray(result.grid) || result.grid.length !== 6 || result.grid.some(col => !Array.isArray(col) || col.length !== 5))) {
      throw new Error('شبكة نتيجة عاصفة المحيط غير مكتملة');
    }
    if (gameId === 'wheel-animals' &&
        (!Number.isInteger(Number(o.index)) || Number(o.index) < 0 || Number(o.index) > 7 ||
         typeof o.animal !== 'string' || !o.animal)) {
      throw new Error('الحيوان الفائز غير محدد بشكل صحيح من الخادم');
    }
    if (gameId === 'fruit-luck' && !['m', '77', 'o'].includes(o.result)) {
      throw new Error('رمز نتيجة الفواكه غير صحيح');
    }
    if (gameId === 'big-warrior' && !['lion', 'tiger', 'draw'].includes(o.winner)) {
      throw new Error('الفائز في المحارب الكبير غير محدد من الخادم');
    }
    if (gameId === 'cleopatra-gold' &&
        (!Array.isArray(o.grid) || o.grid.length !== 5 || o.grid.some(col => !Array.isArray(col) || col.length !== 4))) {
      throw new Error('شبكة نتيجة ذهب كليوباترا غير مكتملة');
    }
    return result;
  }

  window.addEventListener('message', async event => {
    const request = event.data;
    if (!request || request.t !== 'migo:game:request' || !gameFrameFor(event.source)) return;
    const endpoint = GAME_ACTIONS[String(request.gameId || '') + ':' + String(request.action || '')];
    const requestId = String(request.requestId || '');
    const reply = payload => {
      try { event.source.postMessage(Object.assign({ t: 'migo:game:response', requestId }, payload), event.origin || '*'); } catch (_) {}
    };
    if (!endpoint || !/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) {
      reply({ ok: false, message: 'طلب اللعبة غير صالح' });
      return;
    }
    try {
      const options = (request.action === 'wallet' || request.action === 'state') ? { method: 'GET' } : {
        method: 'POST',
        body: JSON.stringify(request.payload && typeof request.payload === 'object' ? request.payload : {})
      };
      if (request.action !== 'state' && request.action !== 'wallet') options.headers = { 'Idempotency-Key': requestId };
      const rawResult = await api(endpoint, options);
      const result = validateGameServerResult(String(request.gameId), String(request.action), rawResult);
      if (result && Number.isFinite(Number(result.coins))) {
        const coins = applyServerWalletCoins(result.coins);
        window.dispatchEvent(new CustomEvent('migo:wallet-updated', {
          detail: { coins, source: 'server-game' }
        }));
      }
      reply({ ok: true, result });
      if (result && Number.isFinite(Number(result.coins))) refreshWalletSafely();
    } catch (error) {
      // Reconcile the canonical wallet after any rejected game action (e.g. insufficient
      // funds), so the game HUD cannot keep showing a stale balance.
      let coins = Number.isSafeInteger(Number(error && error.coins)) ? Number(error.coins) : null;
      if (coins === null) {
        try {
          const wallet = await api('/wallet');
          if (Number.isSafeInteger(Number(wallet && wallet.coins)) && Number(wallet.coins) >= 0) {
            coins = applyServerWalletCoins(wallet.coins);
          }
        } catch (_) {}
      } else {
        coins = applyServerWalletCoins(coins);
      }
      if (coins !== null) {
        window.dispatchEvent(new CustomEvent('migo:wallet-updated', {
          detail: { coins, source: 'server-game-rejected' }
        }));
        reply({ ok: false, message: error && error.message ? error.message : 'تعذر تنفيذ الجولة', coins });
      } else {
        reply({ ok: false, message: error && error.message ? error.message : 'تعذر تنفيذ الجولة على الخادم' });
      }
    }
  });


  function openMemberManagement() {
    if (document.getElementById('migo-member-admin')) return;
    const root=document.createElement('section'); root.id='migo-member-admin'; root.dir='rtl';
    root.style.cssText='position:fixed;inset:0;z-index:2147483000;background:#100827;color:#fff;overflow:auto;padding:18px 14px 36px;font-family:system-ui,sans-serif';
    root.innerHTML='<style>#migo-member-admin *{box-sizing:border-box}#migo-member-admin .h{display:flex;justify-content:space-between;align-items:center;margin:5px 0 18px}#migo-member-admin .t{font-size:22px;font-weight:900;color:#f4d48b}#migo-member-admin button,#migo-member-admin input,#migo-member-admin select{border:1px solid #6940a6;background:#28134b;color:#fff;border-radius:11px;padding:11px;font-weight:700}#migo-member-admin input{width:100%;background:#1c1038;margin-bottom:9px}#migo-member-admin .filters{display:grid;grid-template-columns:1fr 120px;gap:8px}#migo-member-admin .card{background:linear-gradient(135deg,#241044,#180b32);border:1px solid #55328a;border-radius:16px;padding:13px;margin:10px 0}#migo-member-admin .meta{font-size:12px;color:#c7b5e9;line-height:1.8}#migo-member-admin .actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}#migo-member-admin .bad{background:#5b1736}#migo-member-admin .good{background:#174b3d}#migo-member-admin .stats{color:#d8c8f5;font-size:13px;margin:8px 0}</style><header class="h"><b class="t">إدارة الأعضاء</b><button id="ma-close">إغلاق ✕</button></header><div class="filters"><input id="ma-q" placeholder="ابحث بالاسم أو رقم ID"><select id="ma-status"><option value="">كل الأعضاء</option><option value="active">النشطون</option><option value="banned">المحظورون</option></select></div><div class="stats" id="ma-stats">جارٍ التحميل…</div><div id="ma-list"></div><button id="ma-more" style="width:100%;display:none">عرض المزيد</button>';
    document.body.append(root);
    const list=root.querySelector('#ma-list'),stats=root.querySelector('#ma-stats'),more=root.querySelector('#ma-more');
    let page=1,total=0,busy=false,q='';
    const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const fmt=n=>Number(n||0).toLocaleString('ar-EG');
    async function load(reset){if(busy)return;busy=true;more.disabled=true;if(reset){page=1;list.innerHTML='';stats.textContent='جارٍ تحميل الأعضاء…'}
      try{const p=new URLSearchParams({page:String(page),limit:'30',q,status:root.querySelector('#ma-status').value});const d=await api('/admin/users?'+p);
        total=Number(d.total||0);(d.users||[]).forEach(u=>{const c=document.createElement('article');c.className='card';c.innerHTML='<b>'+esc(u.displayName)+'</b><div class="meta">ID: '+esc(u.uid)+' · @'+esc(u.username)+'<br>الرصيد: '+fmt(u.coins)+' عملة · '+(u.status==='banned'?'محظور':'نشط')+' · '+(u.role==='admin'?'مشرف':'عضو')+'</div>';
          if(u.role!=='owner'){const a=document.createElement('div');a.className='actions';const add=(label,fn,cl='')=>{const b=document.createElement('button');b.textContent=label;if(cl)b.classList.add(cl);b.onclick=fn;a.append(b)};
            add('تعديل الاسم',async()=>{const v=prompt('اسم العرض الجديد:',u.displayName||'');if(v===null)return;try{await api('/admin/users/'+u.uid,{method:'PATCH',body:JSON.stringify({displayName:v})});load(true)}catch(e){alert(e.message)}});
            add(u.role==='admin'?'إلغاء المشرف':'جعله مشرفاً',async()=>{if(!confirm('تأكيد تغيير صلاحية العضو؟'))return;try{await api('/admin/users/'+u.uid,{method:'PATCH',body:JSON.stringify({role:u.role==='admin'?'user':'admin'})});load(true)}catch(e){alert(e.message)}});
            add('تسجيل خروج',async()=>{if(!confirm('إنهاء جلسة العضو على جميع الأجهزة؟'))return;try{await api('/admin/users/'+u.uid+'/logout',{method:'POST',body:'{}'});alert('تم إنهاء الجلسة')}catch(e){alert(e.message)}});
            add(u.status==='banned'?'فك الحظر':'حظر العضو',async()=>{if(!confirm('تأكيد '+(u.status==='banned'?'فك حظر':'حظر')+' العضو؟'))return;try{await api('/admin/users/'+u.uid+'/'+(u.status==='banned'?'unban':'ban'),{method:'POST',body:'{}'});load(true)}catch(e){alert(e.message)}},u.status==='banned'?'good':'bad');c.append(a)}
          list.append(c)});
        stats.textContent='إجمالي الأعضاء: '+fmt(total)+' · المعروض: '+fmt(list.children.length);more.style.display=list.children.length<total?'block':'none';page++;
      }catch(e){stats.textContent=e.message||'تعذر تحميل الأعضاء';if(!list.children.length)list.textContent='تأكد من تسجيل الدخول بحساب المالك ونشر تحديث إدارة الأعضاء.';more.style.display='none'}finally{busy=false;more.disabled=false}}
    root.querySelector('#ma-close').onclick=()=>root.remove();more.onclick=()=>load(false);root.querySelector('#ma-status').onchange=()=>load(true);
    let timer;root.querySelector('#ma-q').oninput=e=>{clearTimeout(timer);timer=setTimeout(()=>{q=e.target.value.trim();load(true)},300)};load(true);
  }
  document.addEventListener('click',event=>{if(event.target.closest('#migo-member-admin'))return;let n=event.target;for(let i=0;n&&i<7;i++,n=n.parentElement){const t=String(n.innerText||n.textContent||'').replace(/[›❯>]/g,'').trim();if(t==='الأعضاء'||(t.startsWith('الأعضاء')&&t.length<45)){event.preventDefault();event.stopImmediatePropagation();openMemberManagement();return}}},true);


  // Automatically guide a selected recharge package to payment and receipt upload.
  // The original package selection handler still owns package state and pricing.
  // This enhancement only scrolls to the existing payment/receipt controls.
  (function installRechargePackageScroll() {
    function isVisible(element) {
      if (!element || !element.isConnected) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        element.getClientRects().length > 0;
    }
    function findPaymentTarget() {
      // The live wallet screen labels this exact destination section
      // "شحن العملات بالتحويل". Locate its heading and scroll the whole card
      // into view, even when the file input itself is visually hidden.
      const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,[role="heading"],strong,b'))
        .filter(isVisible);
      const heading = headings.find(element =>
        /شحن\\s*العملات\\s*بالتحويل/.test((element.textContent || '').replace(/\\s+/g, ' ').trim())
      );
      if (heading) {
        let section = heading;
        for (let depth = 0; depth < 5 && section.parentElement; depth++) {
          const parent = section.parentElement;
          const text = (parent.textContent || '').slice(0, 2400);
          if (/(?:رقم\\s*المحفظة|لم\\s*يحدد\\s*المالك|رفع\\s*المرفق|صورة\\s*الإيصال|إرسال\\s*طلب\\s*الشحن)/.test(text)) {
            section = parent;
            if (parent.tagName === 'SECTION' || parent.tagName === 'FORM' ||
                parent.classList.contains('card')) break;
          }
        }
        return section;
      }
      // Fallback for older UI wording or layouts without a semantic heading.
      const candidates = Array.from(document.querySelectorAll(
        'button,label,h2,h3,h4,p,span,div,input[type="file"]'
      )).filter(element => {
        if (!isVisible(element) || (element.children && element.children.length > 5)) return false;
        const text = (element.textContent || '').replace(/\\s+/g, ' ').trim();
        return text.length < 130 &&
          /(?:نسخ\\s*(?:الرقم|رقم)|رقم\\s*المحفظة|لم\\s*يحدد\\s*المالك|رفع\\s*(?:المرفق|مستند|إيصال)|إرسال\\s*طلب\\s*الشحن)/i.test(text);
      });
      if (!candidates.length) return null;
      let section = candidates[0];
      for (let depth = 0; depth < 5 && section.parentElement; depth++) {
        const parent = section.parentElement;
        const text = (parent.textContent || '').slice(0, 2400);
        if (/(?:رقم\\s*المحفظة|رفع\\s*المرفق|إرسال\\s*طلب\\s*الشحن)/.test(text) &&
            (parent.tagName === 'SECTION' || parent.tagName === 'FORM' ||
             parent.querySelector('input[type="file"]'))) {
          section = parent;
          break;
        }
        section = parent;
      }
      return section;
    }
    document.addEventListener('click', event => {
      const button = event.target && event.target.closest &&
        event.target.closest('button, [role="button"], input[type="button"]');
      if (!button || !isVisible(button)) return;
      const label = String(button.textContent || button.value || '').trim();
      if (label !== 'اختيار') return;
      // Restrict this to package cards, not unrelated "اختيار" controls.
      const card = button.closest('article, .pack, .package, .pkg, .card') ||
        button.parentElement && button.parentElement.parentElement;
      if (!card || !/1,?000|5,?000|10,?000|50,?000|100,?000/.test(card.textContent || '')) return;
      // Allow the application's existing click handler to render the selected
      // package before locating the receipt section.
      [120, 450].forEach((delay, index) => setTimeout(() => {
        const target = findPaymentTarget();
        if (!target) return;
        if (index === 0 || !isVisible(target)) return;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, delay));
    }, false);
  })();

  // Shared owner settings: persisted centrally and pushed to every connected app.
  let sharedPublicSettings = {};
  let sharedSettingsRevision = 0;
  function applySharedSettings(payload, source) {
    if (!payload || !payload.settings || typeof payload.settings !== 'object') return;
    sharedPublicSettings = payload.settings;
    sharedSettingsRevision = Number(payload.revision || sharedSettingsRevision || 0);
    try {
      localStorage.setItem('migo_public_settings_v1', JSON.stringify({
        settings: sharedPublicSettings, revision: sharedSettingsRevision,
        updatedAt: payload.updatedAt || null
      }));
    } catch (_) {}
    window.dispatchEvent(new CustomEvent('migo:settings-updated', {
      detail: { settings: sharedPublicSettings, revision: sharedSettingsRevision,
        updatedAt: payload.updatedAt || null, source: source || 'server' }
    }));
  }
  async function refreshSharedSettings() {
    try {
      const payload = await api('/app-settings/public');
      applySharedSettings(payload, 'server');
      return sharedPublicSettings;
    } catch (error) {
      // Keep the last server-confirmed cache visible during temporary outages.
      try {
        const cached = JSON.parse(localStorage.getItem('migo_public_settings_v1') || '{}');
        if (cached.settings && typeof cached.settings === 'object') {
          sharedPublicSettings = cached.settings;
          sharedSettingsRevision = Number(cached.revision || 0);
        }
      } catch (_) {}
      throw error;
    }
  }
  window.MigoSettings = Object.freeze({
    get: () => sharedPublicSettings,
    refresh: refreshSharedSettings,
    update: async patch => {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('بيانات الإعدادات غير صالحة');
      const payload = await api('/app-settings/owner', {
        method: 'PUT', body: JSON.stringify({ settings: patch })
      });
      applySharedSettings(payload, 'owner-save');
      return payload;
    }
  });

  // Authenticated live updates from the API. Reconnects re-read canonical data.
  (function installOwnerLiveSync(){
    if(window.__migoLiveSyncInstalled)return;window.__migoLiveSyncInstalled=true;
    const script=document.createElement('script');
    script.src=API.replace(/\/api$/,'')+'/socket.io/socket.io.js';script.async=true;
    script.onload=()=>{
      if(typeof window.io!=='function')return;
      let socket=null;
      const connectNow=()=>{
        if(socket||!token())return;
        socket=window.io(API.replace(/\/api$/,''),{transports:['websocket','polling'],auth:{token:token()},reconnection:true,reconnectionDelay:1000,reconnectionDelayMax:10000,timeout:15000});
        window.migoLiveSocket=socket;
        const resync=()=>{if(typeof refreshWalletSafely==='function')refreshWalletSafely();refreshSharedSettings().catch(()=>{});window.dispatchEvent(new Event('migo:live-sync'));};
        socket.on('connect',resync);
        socket.on('wallet:updated',payload=>{
          if(payload&&Number.isFinite(Number(payload.coins))){
            try{const uid=Number(payload.uid),key=Object.keys(DB.users||{}).find(k=>Number(DB.users[k]&&DB.users[k].uid)===uid);if(key){DB.users[key].coins=Number(payload.coins);if(typeof save==='function')save();}}catch(_){}
            if(typeof refreshWalletSafely==='function')refreshWalletSafely();
            window.dispatchEvent(new CustomEvent('migo:wallet-updated',{detail:payload}));
          }
        });
        socket.on('owner:settings-updated',payload=>applySharedSettings(payload,'realtime'));
        socket.on('owner:announcement',payload=>{const msg=String(payload&&payload.message||'').trim();if(msg&&typeof toast==='function')toast(msg);window.dispatchEvent(new CustomEvent('migo:announcement',{detail:payload||{}}));});
        socket.on('owner:policy-updated',payload=>{window.dispatchEvent(new CustomEvent('migo:policy-updated',{detail:payload||{}}));if(payload&&payload.kind==='app-update'&&typeof checkMandatoryUpdate==='function')checkMandatoryUpdate();if(payload&&payload.kind==='game-control')window.dispatchEvent(new Event('migo:games-updated'));});
        socket.on('owner:member-updated',payload=>window.dispatchEvent(new CustomEvent('migo:member-updated',{detail:payload||{}})));
        socket.on('auth:revoked',payload=>{alert(String(payload&&payload.message||'تم إيقاف هذا الحساب'));if(typeof logout==='function')logout();});
        socket.on('auth:session-replaced',payload=>{alert(String(payload&&payload.message||'تم إنهاء جلسة الحساب'));if(typeof logout==='function')logout();});
      };
      connectNow();
      const waitForLogin=setInterval(()=>{if(!socket)connectNow();else clearInterval(waitForLogin);},1000);
    };
    script.onerror=()=>{window.__migoLiveSyncInstalled=false;};document.head.append(script);
  })();

})();
