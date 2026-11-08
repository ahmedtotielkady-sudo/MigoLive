(function(){
'use strict';
const KEY='migolive_api_url', TOKEN='migolive_api_token', REMOTE='migolive_remote_user';
const $id=id=>document.getElementById(id);
const base=()=>String(localStorage.getItem(KEY)||'').trim().replace(/\/+$/,'');
const token=()=>localStorage.getItem(TOKEN)||'';
async function api(path,opts={}){
  const url=base(); if(!url) throw new Error('لم يتم ضبط رابط الخادم بعد');
  const headers={'Content-Type':'application/json',...(opts.headers||{})};
  if(token()) headers.Authorization='Bearer '+token();
  const res=await fetch(url+path,{...opts,headers});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error||'تعذر الاتصال بالخادم ('+res.status+')');
  return data;
}
function statusText(){return base()?'الخادم: '+base():'الخادم غير مربوط بعد';}
function setupButton(){
  const host=document.querySelector('#main');
  if(!host||document.getElementById('migolive-api-setup')) return;
  const bar=document.createElement('div');bar.id='migolive-api-setup';bar.className='card';
  bar.style.cssText='font-size:12px;margin:8px 0;padding:9px;display:flex;gap:8px;align-items:center;flex-wrap:wrap';
  const label=document.createElement('span');label.textContent=statusText();label.style.flex='1';
  const btn=document.createElement('button');btn.className='btn o s';btn.textContent='إعداد اتصال الخادم';
  btn.onclick=()=>{const v=prompt('أدخل رابط Backend الخاص بتطبيق MigoLive (مثال: https://api.example.com)',base());if(v===null)return;const clean=v.trim().replace(/\/+$/,'');if(clean&&!/^https?:\/\//i.test(clean)){alert('الرابط يجب أن يبدأ بـ https:// أو http://');return;}if(clean)localStorage.setItem(KEY,clean);else localStorage.removeItem(KEY);label.textContent=statusText();};
  bar.append(label,btn);host.prepend(bar);
}
function authHook(){
 const btn=$id('bin'); if(!btn||btn.dataset.apiHook)return;btn.dataset.apiHook='1';
 btn.addEventListener('click',async()=>{
   const url=base();if(!url)return;
   const raw=($id('u')?.value||'').trim(),password=$id('p')?.value||'';
   if(!raw||!password)return;
   try{
     let username=raw.toLowerCase();
     if(!(typeof reg!=='undefined'&&reg)){
       const users=window.DB?.users||{};
       const key=Object.keys(users).find(k=>String(users[k].uid)===raw)||Object.keys(users).find(k=>String(users[k].phone||'').replace(/[\s()-]/g,'')===raw.replace(/[\s()-]/g,''));
       if(key)username=key;
     }
     let data;
     try{data=await api('/api/auth/login',{method:'POST',body:JSON.stringify({username,password})});}
     catch(loginError){
       if(!(typeof reg!=='undefined'&&reg) && !/Invalid username or password/i.test(loginError.message)) throw loginError;
       if(password.length<10) throw new Error('لربط الحساب بالخادم، كلمة المرور يجب أن تكون 10 أحرف على الأقل. غيّرها أو أنشئ الحساب بكلمة مرور أقوى.');
       await api('/api/auth/register',{method:'POST',body:JSON.stringify({username,password})});
       data=await api('/api/auth/login',{method:'POST',body:JSON.stringify({username,password})});
     }
     localStorage.setItem(TOKEN,data.token);localStorage.setItem(REMOTE,JSON.stringify(data.user));
     document.dispatchEvent(new CustomEvent('migolive:api-authenticated',{detail:data.user}));
   }catch(e){console.warn('MigoLive API authentication:',e.message);setTimeout(()=>{if(typeof window.toast==='function')window.toast('تعذر ربط الحساب بالخادم: '+e.message)},300);}
 },true);
}
async function renderAgency(m){
 const remote=(()=>{try{return JSON.parse(localStorage.getItem(REMOTE)||'null')}catch(_){return null}})();
 const connected=!!base()&&!!token();
 m.innerHTML='<h3>🏢 الوكالات</h3><div class="card"><div class="mu">'+(connected?'متصل بحساب الخادم':'يلزم ربط الخادم وتسجيل الدخول')+'</div></div><div id="api-agency-main" class="card">جاري تحميل بيانات الوكالة...</div><div id="api-agency-owner"></div>';
 setupButton();const main=$id('api-agency-main'),owner=$id('api-agency-owner');
 if(!connected){main.textContent='اضبط رابط الخادم ثم سجّل الدخول مجدداً.';return;}
 async function load(){
  try{
   const [mine,joins]=await Promise.all([api('/api/agencies/mine'),api('/api/agencies/join-requests').catch(()=>({requests:[]}))]);
   if(mine.agency){
    main.innerHTML='<b>وكالتك: '+escapeHtml(mine.agency.name)+'</b><div class="mu">المعرف: '+escapeHtml(mine.agency.agencyId)+' · الأعضاء: '+mine.agency.memberCount+' · الصفة: '+(mine.role==='agent'?'وكيل':'عضو')+'</div>';
    if(mine.role==='agent')main.innerHTML+='<div class="sp"></div><b>طلبات الانضمام</b>'+(joins.requests.length?joins.requests.map(r=>'<div class="row" style="margin:8px 0"><span class="grow">'+escapeHtml(r.username)+'</span><button class="btn g s" data-join="'+r._id+'" data-decision="approve">قبول</button><button class="btn r s" data-join="'+r._id+'" data-decision="reject">رفض</button></div>').join(''):'<div class="mu">لا توجد طلبات معلقة</div>');
    main.querySelectorAll('[data-join]').forEach(b=>b.onclick=async()=>{try{await api('/api/agencies/join-requests/'+b.dataset.join,{method:'PATCH',body:JSON.stringify({decision:b.dataset.decision})});await load()}catch(e){alert(e.message)}});
   }else{
    main.innerHTML='<b>إنشاء وكالة</b><div class="mu">يرسل الطلب إلى مالك المنصة للموافقة.</div><input class="in" id="api-agency-name" maxlength="60" placeholder="اسم الوكالة"><textarea class="in" id="api-agency-desc" maxlength="500" placeholder="وصف الوكالة (اختياري)"></textarea><button class="btn g w" id="api-agency-create">إرسال طلب إنشاء</button><div class="divider"></div><b>الانضمام إلى وكالة</b><input class="in" id="api-agency-id" dir="ltr" placeholder="معرف الوكالة"><button class="btn o w" id="api-agency-lookup">بحث عن وكالة</button><div id="api-agency-found" class="mu"></div>';
    $id('api-agency-create').onclick=async()=>{const name=$id('api-agency-name').value.trim(),description=$id('api-agency-desc').value.trim();try{await api('/api/agencies/create-requests',{method:'POST',body:JSON.stringify({name,description})});alert('تم إرسال طلب إنشاء الوكالة للمالك');await load()}catch(e){alert(e.message)}};
    $id('api-agency-lookup').onclick=async()=>{const id=$id('api-agency-id').value.trim();try{const d=await api('/api/agencies/lookup/'+encodeURIComponent(id));$id('api-agency-found').innerHTML='<b>'+escapeHtml(d.agency.name)+'</b> · الوكيل '+escapeHtml(d.agency.ownerUsername)+' · '+d.agency.memberCount+' أعضاء <button class="btn s" id="api-agency-join">طلب انضمام</button>';$id('api-agency-join').onclick=async()=>{try{await api('/api/agencies/join-requests',{method:'POST',body:JSON.stringify({agencyId:d.agency.agencyId})});alert('تم إرسال طلب الانضمام للوكيل')}catch(e){alert(e.message)}};}catch(e){$id('api-agency-found').textContent=e.message}};
   }
   if(remote&&remote.role==='owner'){
    owner.innerHTML='<div class="card"><b>طلبات إنشاء الوكالات (المالك)</b><div id="api-owner-requests">جاري التحميل...</div></div>';
    try{const d=await api('/api/agencies/owner/create-requests');const box=$id('api-owner-requests');box.innerHTML=d.requests.length?d.requests.map(a=>'<div class="card"><b>'+escapeHtml(a.name)+'</b><div class="mu">المتقدم: '+escapeHtml(a.applicant||'')+' · ID '+escapeHtml(a.agencyId)+'</div><div>'+escapeHtml(a.description||'')+'</div><div class="row"><button class="btn g grow" data-agency="'+escapeHtml(a.agencyId)+'" data-decision="approve">موافقة</button><button class="btn r grow" data-agency="'+escapeHtml(a.agencyId)+'" data-decision="reject">رفض</button></div></div>').join(''):'لا توجد طلبات معلقة';box.querySelectorAll('[data-agency]').forEach(b=>b.onclick=async()=>{try{await api('/api/agencies/owner/create-requests/'+encodeURIComponent(b.dataset.agency),{method:'PATCH',body:JSON.stringify({decision:b.dataset.decision})});await load()}catch(e){alert(e.message)}})}catch(e){$id('api-owner-requests').textContent=e.message}
   }
  }catch(e){main.textContent=e.message}
 }
 await load();
}
function renderMessages(m){
 const remote=(()=>{try{return JSON.parse(localStorage.getItem(REMOTE)||'null')}catch(_){return null}})();
 const connected=!!base()&&!!token();
 m.innerHTML='<div class="card"><b>💬 الرسائل عبر الخادم</b><div class="mu">'+(connected?'الحساب مربوط بالخادم':'اربط الخادم وسجّل الدخول بحسابك لفتح الرسائل بين الأجهزة')+'</div><div class="sp"></div><div class="row"><input class="in grow" id="api-msg-user" dir="ltr" placeholder="ID الحساب على الخادم"><button class="btn s" id="api-msg-find">بحث</button></div><div id="api-msg-state" class="mu" style="margin-top:8px"></div></div><div id="api-msg-thread"></div><div class="card"><b>المحادثات الأخيرة</b><div id="api-msg-list" class="mu">جاري التحميل...</div></div>';
 setupButton();
 const state=$id('api-msg-state'),thread=$id('api-msg-thread'),list=$id('api-msg-list');
 let current=null;
 async function loadConversations(){
   if(!connected){list.textContent='لا توجد جلسة خادم. اضبط الرابط ثم سجّل الدخول مجدداً.';return;}
   try{const d=await api('/api/messages/conversations');list.innerHTML=d.conversations.length?d.conversations.map(c=>'<button class="btn o w" data-chat="'+c.user.id+'" style="margin:4px 0;text-align:right">'+escapeHtml(c.user.username)+' · '+escapeHtml(c.lastMessage.body)+' · غير مقروء '+c.unreadCount+'</button>').join(''):'لا توجد محادثات بعد';
     list.querySelectorAll('[data-chat]').forEach(b=>b.onclick=()=>openChat(b.dataset.chat));
   }catch(e){list.textContent=e.message;}
 }
 async function openChat(id){
   current=id;thread.innerHTML='<div class="card">جاري تحميل المحادثة...</div>';
   try{const d=await api('/api/messages/with/'+encodeURIComponent(id));state.textContent='المحادثة مع '+d.user.username+' · '+id;
     thread.innerHTML='<div class="card"><b>'+escapeHtml(d.user.username)+'</b><div id="api-msg-items" style="max-height:42vh;overflow:auto;margin:10px 0">'+d.messages.map(x=>'<div style="padding:8px;margin:5px 0;border-radius:10px;background:rgba(124,58,237,.10)">'+escapeHtml(x.body)+'<div class="mu">'+new Date(x.createdAt).toLocaleString('ar-EG')+'</div></div>').join('')+'</div><div class="row"><input class="in grow" id="api-msg-body" maxlength="2000" placeholder="اكتب رسالتك"><button class="btn s" id="api-msg-send">إرسال</button></div></div>';
     $id('api-msg-send').onclick=async()=>{const input=$id('api-msg-body'),body=input.value.trim();if(!body)return;try{await api('/api/messages/with/'+encodeURIComponent(current),{method:'POST',body:JSON.stringify({body})});await openChat(current);await loadConversations();}catch(e){state.textContent=e.message;}};
   }catch(e){thread.innerHTML='<div class="card err">'+escapeHtml(e.message)+'</div>';}
 }
 $id('api-msg-find').onclick=async()=>{const id=$id('api-msg-user').value.trim();if(!id)return state.textContent='اكتب ID الحساب';try{const d=await api('/api/messages/users/'+encodeURIComponent(id));await openChat(d.user.id);}catch(e){state.textContent=e.message;}};
 if(connected)loadConversations();else state.textContent='اضبط رابط الخادم من الزر أعلى الصفحة، ثم سجّل الدخول مجدداً.';
}
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function install(){
 authHook();
 if(typeof window.rMsgs==='function')window.rMsgs=renderMessages;\n if(typeof window.rAgency==='function')window.rAgency=renderAgency;
 if(typeof window.render==='function'&&!window.render.__apiWrapped){const old=window.render;const wrapped=function(){const out=old.apply(this,arguments);setupButton();return out};wrapped.__apiWrapped=true;window.render=wrapped;}
 setupButton();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
document.addEventListener('migolive:api-authenticated',()=>{if(location.hash==='#msgs'&&typeof window.render==='function')window.render();});
})();
