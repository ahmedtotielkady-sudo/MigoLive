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
  if(!res.ok){const error=new Error(data.error||'تعذر الاتصال بالخادم ('+res.status+')');error.status=res.status;throw error;}
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
     // Backend accounts are separate from legacy local accounts. Never auto-create
     // a remote account after a failed login; that could create duplicates or confusion.
     const username=raw.toLowerCase();
     const data=await api('/api/auth/login',{method:'POST',body:JSON.stringify({username,password})});
     localStorage.setItem(TOKEN,data.token);localStorage.setItem(REMOTE,JSON.stringify(data.user));
     document.dispatchEvent(new CustomEvent('migolive:api-authenticated',{detail:data.user}));
   }catch(e){console.warn('MigoLive API authentication:',e.message);setTimeout(()=>{if(typeof window.toast==='function')window.toast('تعذر ربط الحساب بالخادم: '+e.message)},300);}
 },true);
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
function renderAgency(){
 const host=$id('main'); if(!host)return;
 const connected=!!base()&&!!token();
 host.innerHTML='<div class="card"><b>🏢 الوكالات عبر الخادم</b><div class="mu" id="api-agency-status">'+(connected?'الحساب متصل بالخادم':'سجّل الدخول بحساب الخادم أولاً')+'</div></div>'+
 '<div class="card"><b>طلب إنشاء وكالة</b><input class="in w" id="api-agency-name" maxlength="60" placeholder="اسم الوكالة"><textarea class="in w" id="api-agency-desc" maxlength="500" placeholder="وصف الوكالة"></textarea><button class="btn w" id="api-agency-create">إرسال طلب للمالك</button></div>'+
 '<div class="card"><b>الانضمام إلى وكالة</b><input class="in w" id="api-agency-code" maxlength="20" placeholder="كود الوكالة"><button class="btn o w" id="api-agency-lookup">بحث عن الوكالة</button><div id="api-agency-found" class="mu"></div></div>'+
 '<div class="card"><b>وكالتي</b><div id="api-agency-mine" class="mu">جاري التحميل...</div><button class="btn o w" id="api-agency-refresh">تحديث</button></div>'+
 '<div class="card"><b>طلبات الانضمام (للوكيل)</b><div id="api-agency-joins" class="mu">—</div></div>'+
 '<div class="card"><b>طلبات إنشاء الوكالات (للمالك)</b><div id="api-agency-owner" class="mu">—</div></div>';
 const status=$id('api-agency-status'),found=$id('api-agency-found'),mine=$id('api-agency-mine'),joins=$id('api-agency-joins'),owner=$id('api-agency-owner');
 if(!connected){status.textContent='اضبط رابط الخادم وسجّل الدخول بحساب مسجل على الخادم.';return;}
 async function refresh(){
  try{const d=await api('/api/agencies/mine');mine.textContent=d.agency?d.agency.name+' · كود '+d.agency.agencyId+' · '+(d.role==='agent'?'وكيل':'عضو'):'لا تنتمي إلى وكالة حالياً';}
  catch(e){mine.textContent=e.message;}
  try{const d=await api('/api/agencies/join-requests');joins.innerHTML=d.requests.length?d.requests.map(x=>'<div class="row" style="justify-content:space-between;margin:6px 0"><span>'+escapeHtml(x.username)+'</span><span><button class="btn s" data-join="'+x._id+'" data-decision="approve">قبول</button> <button class="btn o s" data-join="'+x._id+'" data-decision="reject">رفض</button></span></div>').join(''):'لا توجد طلبات معلقة';joins.querySelectorAll('[data-join]').forEach(b=>b.onclick=async()=>{try{await api('/api/agencies/join-requests/'+encodeURIComponent(b.dataset.join),{method:'PATCH',body:JSON.stringify({decision:b.dataset.decision})});refresh();}catch(e){status.textContent=e.message;}});}
  catch(e){joins.textContent=e.status===403?'هذه القائمة تظهر لوكيل وكالة نشطة فقط':e.message;}
  try{const d=await api('/api/agencies/owner/create-requests');owner.innerHTML=d.requests.length?d.requests.map(x=>'<div style="margin:8px 0"><b>'+escapeHtml(x.name)+'</b> · '+escapeHtml(x.applicant||'')+'<div><button class="btn s" data-owner="'+escapeHtml(x.agencyId)+'" data-decision="approve">موافقة</button> <button class="btn o s" data-owner="'+escapeHtml(x.agencyId)+'" data-decision="reject">رفض</button></div></div>').join(''):'لا توجد طلبات إنشاء معلقة';owner.querySelectorAll('[data-owner]').forEach(b=>b.onclick=async()=>{try{await api('/api/agencies/owner/create-requests/'+encodeURIComponent(b.dataset.owner),{method:'PATCH',body:JSON.stringify({decision:b.dataset.decision})});refresh();}catch(e){status.textContent=e.message;}});}
  catch(e){owner.textContent=e.status===403?'هذه القائمة للمالك فقط':e.message;}
 }
 $id('api-agency-create').onclick=async()=>{try{const name=$id('api-agency-name').value.trim(),description=$id('api-agency-desc').value.trim();await api('/api/agencies/create-requests',{method:'POST',body:JSON.stringify({name,description})});status.textContent='تم إرسال طلب إنشاء الوكالة للمالك.';refresh();}catch(e){status.textContent=e.message;}};
 $id('api-agency-lookup').onclick=async()=>{try{const code=$id('api-agency-code').value.trim();const d=await api('/api/agencies/lookup/'+encodeURIComponent(code));found.innerHTML='<b>'+escapeHtml(d.agency.name)+'</b> · '+escapeHtml(d.agency.ownerUsername||'')+' · '+d.agency.memberCount+' عضو <button class="btn s" id="api-agency-join">طلب انضمام</button>';$id('api-agency-join').onclick=async()=>{try{await api('/api/agencies/join-requests',{method:'POST',body:JSON.stringify({agencyId:d.agency.agencyId})});found.textContent='تم إرسال طلب الانضمام للوكيل.';}catch(e){found.textContent=e.message;}};}catch(e){found.textContent=e.message;}};
 $id('api-agency-refresh').onclick=refresh;refresh();
}
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

const APP_VERSION='1.0.0';
function versionParts(v){return String(v||'0.0.0').split('.').map(n=>parseInt(n,10)||0)}
function versionLess(a,b){const x=versionParts(a),y=versionParts(b);for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]<y[i]}return false}
function updateDialog(release,forced){
 if(document.getElementById('migolive-update-lock'))return;
 const overlay=document.createElement('div');overlay.id='migolive-update-lock';
 overlay.style.cssText='position:fixed;inset:0;z-index:2147483000;background:#080414f5;display:flex;align-items:center;justify-content:center;padding:22px;direction:rtl;font-family:Cairo,Tahoma,sans-serif;color:#fff';
 const card=document.createElement('div');card.style.cssText='width:100%;max-width:420px;background:#180d32;border:1px solid #a855f7;border-radius:22px;padding:22px;text-align:center;box-shadow:0 15px 55px #000b';
 const title=document.createElement('h2');title.textContent=forced?'يجب تحديث التطبيق للمتابعة':'يتوفر تحديث جديد';
 const info=document.createElement('p');info.style.cssText='color:#c4b5fd;margin:14px 0;white-space:pre-wrap';info.textContent='الإصدار '+release.version+' · build '+release.build+(release.notes?'\\n'+release.notes:'');
 const button=document.createElement('button');button.textContent='تحديث الآن';button.style.cssText='width:100%;min-height:48px;border:0;border-radius:12px;background:linear-gradient(90deg,#7c3aed,#a855f7);color:white;font-weight:bold';
 button.onclick=()=>GenUpdateOpen(release.downloadUrl);
 card.append(title,info,button);
 if(!forced){const later=document.createElement('button');later.textContent='لاحقاً';later.style.cssText='margin-top:10px;width:100%;min-height:42px;background:transparent;border:1px solid #8b5cf6;border-radius:12px;color:white';later.onclick=()=>overlay.remove();card.append(later)}
 overlay.append(card);document.body.append(overlay);
}
function GenUpdateOpen(url){if(url)window.open(url,'_system')||window.open(url,'_blank')}
async function checkAppUpdate(){
 try{
  if(!base())return;
  const d=await api('/api/app-update');const r=d.release;if(!r||!r.active)return;
  const current=window.MIGOLIVE_APP_VERSION||APP_VERSION;
  const forced=!!r.force&&versionLess(current,r.minVersion);
  if(forced||versionLess(current,r.version))updateDialog(r,forced);
 }catch(e){console.warn('MigoLive update check:',e.message)}
}
window.MigoLiveAppUpdates={
 adminGet:()=>api('/api/app-update/admin'),
 adminSave:data=>api('/api/app-update',{method:'PUT',body:JSON.stringify(data)}),
 check:checkAppUpdate
};

function install(){
 authHook();
 if(typeof window.rMsgs==='function')window.rMsgs=renderMessages;
 if(typeof window.rAgency==='function')window.rAgency=renderAgency;
 if(typeof window.render==='function'&&!window.render.__apiWrapped){const old=window.render;const wrapped=function(){const out=old.apply(this,arguments);setupButton();return out};wrapped.__apiWrapped=true;window.render=wrapped;}
 setupButton();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
document.addEventListener('migolive:api-authenticated',()=>{if(location.hash==='#msgs'&&typeof window.render==='function')window.render();});
})();
