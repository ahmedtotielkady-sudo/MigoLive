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
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function install(){
 authHook();
 if(typeof window.rMsgs==='function')window.rMsgs=renderMessages;
 if(typeof window.render==='function'&&!window.render.__apiWrapped){const old=window.render;const wrapped=function(){const out=old.apply(this,arguments);setupButton();return out};wrapped.__apiWrapped=true;window.render=wrapped;}
 setupButton();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
document.addEventListener('migolive:api-authenticated',()=>{if(location.hash==='#msgs'&&typeof window.render==='function')window.render();});
})();
