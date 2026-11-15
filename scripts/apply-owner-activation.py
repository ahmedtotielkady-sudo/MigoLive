#!/usr/bin/env python3
"""Wire the five-tap login eagle gesture to the server-side owner claim API."""
from pathlib import Path

path = Path("index.html")
html = path.read_text(encoding="utf-8")
anchor = """// صلاحية المالك لا تُمنح من الواجهة؛ تُدار حصرياً من قاعدة البيانات والخادم.
const loginEagle=$('#login-owner-eagle');
if(loginEagle){
  loginEagle.style.cssText='display:inline-grid;place-items:center;width:120px;height:120px;cursor:default;user-select:none';
  loginEagle.removeAttribute('role');
  loginEagle.removeAttribute('tabindex');
}"""
replacement = """// تفعيل المالك: خمس ضغطات تفتح إدخال العبارة، والتحقق حصرياً عبر API.
const loginEagle=$('#login-owner-eagle');
let ownerTapCount=0, ownerTapTimer=null;
if(loginEagle){
  loginEagle.style.cssText='display:inline-grid;place-items:center;width:120px;height:120px;cursor:pointer;touch-action:manipulation;user-select:none;-webkit-tap-highlight-color:transparent';
  loginEagle.setAttribute('role','button');
  loginEagle.setAttribute('tabindex','0');
  const tap=()=>{
    ownerTapCount++;
    if(ownerTapTimer)clearTimeout(ownerTapTimer);
    ownerTapTimer=setTimeout(()=>{ownerTapCount=0},2500);
    if(ownerTapCount>=5){ownerTapCount=0;clearTimeout(ownerTapTimer);showOwnerActivationDialog()}
  };
  loginEagle.addEventListener('click',e=>{e.preventDefault();tap()});
  loginEagle.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();tap()}});
}
function showOwnerActivationDialog(){
  if($('#owner-code-overlay'))return;
  const overlay=document.createElement('div');
  overlay.id='owner-code-overlay';
  overlay.style.cssText='position:fixed;inset:0;z-index:1000000;background:#090414e8;display:flex;align-items:center;justify-content:center;padding:20px;direction:rtl';
  overlay.innerHTML='<div class="card" style="width:min(100%,380px);background:#24133c;border:1px solid #d5a83c;box-shadow:0 20px 70px #0009"><div style="font-size:28px;text-align:center">🦅</div><h3 style="text-align:center;margin:8px 0 14px">تفعيل صلاحية المالك</h3><p class="mu" style="text-align:center">أدخل عبارة المالك كاملة</p><input id="owner-code-input" class="in" type="password" inputmode="text" dir="ltr" autocomplete="off" placeholder="عبارة المالك"><div id="owner-code-error" class="err" style="min-height:22px"></div><div class="row"><button id="owner-code-cancel" class="btn o grow">إلغاء</button><button id="owner-code-submit" class="btn g grow">تحقق وتفعيل</button></div></div>';
  document.body.appendChild(overlay);
  const input=$('#owner-code-input'), submit=$('#owner-code-submit'), error=$('#owner-code-error');
  const close=()=>overlay.remove();
  $('#owner-code-cancel').onclick=close;
  if(!localStorage.getItem('migolive_token')){
    error.textContent='سجّل الدخول إلى حسابك أولاً، ثم أعد محاولة التفعيل.';
    submit.disabled=true;
  }
  const activate=async()=>{
    const phrase=input.value;
    if(!phrase)return error.textContent='أدخل العبارة كاملة';
    submit.disabled=true;error.textContent='جارٍ التحقق من الخادم...';
    try{
      const result=await apiRequest('/auth/owner/claim',{method:'POST',body:JSON.stringify({phrase})});
      if(!result.user||result.user.role!=='owner')throw new Error('لم يؤكد الخادم صلاحية المالك');
      applyServerUser(result.user);
      error.style.color='#86efac';
      error.textContent='تم تفعيل صلاحية المالك على الحساب';
      input.value='';
      setTimeout(()=>{close();if(typeof render==='function')render();toast('تم تفعيل حساب المالك')},700);
    }catch(err){
      error.style.color='#fca5a5';error.textContent=err.message||'تعذر تفعيل المالك';
      input.value='';input.focus();
    }finally{submit.disabled=false}
  };
  submit.onclick=activate;
  input.addEventListener('keydown',e=>{if(e.key==='Enter')activate();if(e.key==='Escape')close()});
  overlay.addEventListener('click',e=>{if(e.target===overlay)close()});
  input.focus();
}"""
if html.count(anchor) != 1:
    raise SystemExit(f"Expected exactly one eagle placeholder, found {html.count(anchor)}")
path.write_text(html.replace(anchor, replacement, 1), encoding="utf-8")
print("Connected five-tap eagle gesture to authenticated owner claim endpoint")
