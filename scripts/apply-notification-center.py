#!/usr/bin/env python3
"""Install MigoLive local notification center and category shortcuts."""
from pathlib import Path

p = Path("index.html")
if not p.exists():
    raise SystemExit("index.html is missing")
html = p.read_text(encoding="utf-8")
style_id = "migo-notification-center-style-v1"
script_id = "migo-notification-center-script-v1"

css = r"""
<style id="migo-notification-center-style-v1">
#migo-notice-shortcuts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;padding:12px 10px;margin:8px 0 12px;direction:rtl}
#migo-notice-shortcuts .migo-ns-item{position:relative;display:flex;flex-direction:column;align-items:center;gap:7px;min-width:0;border:0;background:transparent;color:inherit;font:inherit;padding:0;touch-action:manipulation}
#migo-notice-shortcuts .migo-ns-icon{width:58px;height:58px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:27px;box-shadow:0 5px 14px #0002}
#migo-notice-shortcuts .migo-ns-item:nth-child(1) .migo-ns-icon{background:linear-gradient(145deg,#45d7bd,#13bda0)}
#migo-notice-shortcuts .migo-ns-item:nth-child(2) .migo-ns-icon{background:linear-gradient(145deg,#82d9f6,#56bde8)}
#migo-notice-shortcuts .migo-ns-item:nth-child(3) .migo-ns-icon{background:linear-gradient(145deg,#f6d72c,#e8aa00)}
#migo-notice-shortcuts .migo-ns-item:nth-child(4) .migo-ns-icon{background:linear-gradient(145deg,#ffb33b,#ff812f)}
#migo-notice-shortcuts .migo-ns-label{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;color:#777}
#migo-notice-shortcuts .migo-ns-count{position:absolute;top:-3px;right:calc(50% - 37px);min-width:19px;height:19px;padding:0 4px;border-radius:20px;background:#f04f61;color:#fff;font-size:11px;line-height:19px;font-weight:900}
#migo-notice-panel{position:fixed;inset:0;z-index:2147482500;background:#0008;display:flex;align-items:stretch;justify-content:center;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)}
#migo-notice-panel[hidden],#migo-notice-shortcuts[hidden]{display:none!important}
#migo-notice-panel .migo-np-sheet{width:100%;max-width:560px;background:#fff;color:#25212b;display:flex;flex-direction:column;overflow:hidden}
#migo-notice-panel .migo-np-head{display:flex;align-items:center;justify-content:space-between;padding:18px 16px;border-bottom:1px solid #eee;font-weight:900;font-size:20px}
#migo-notice-panel .migo-np-close{border:0;background:transparent;font-size:25px;color:#777;padding:5px 10px}
#migo-notice-panel .migo-np-tabs{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;padding:10px;border-bottom:1px solid #eee}
#migo-notice-panel .migo-np-tabs button{border:0;border-radius:12px;background:#f4f2f7;padding:9px 2px;font-size:11px;color:#665b75}
#migo-notice-panel .migo-np-tabs button.active{background:#eee2ff;color:#7838aa;font-weight:900}
#migo-notice-panel .migo-np-list{overflow:auto;overscroll-behavior:contain;flex:1}
#migo-notice-panel .migo-np-row{display:flex;align-items:center;gap:12px;padding:14px 15px;border-bottom:1px solid #f0edf2;text-align:right;width:100%;background:#fff;border-left:0;border-right:0;border-top:0;color:inherit}
#migo-notice-panel .migo-np-row.unread{background:#faf6ff}
#migo-notice-panel .migo-np-bullet{width:43px;height:43px;flex:0 0 43px;border-radius:50%;display:grid;place-items:center;background:#e6f7ff;font-size:22px}
#migo-notice-panel .migo-np-copy{min-width:0;flex:1}
#migo-notice-panel .migo-np-copy b{display:block;font-size:14px;margin-bottom:4px}
#migo-notice-panel .migo-np-copy small{display:block;color:#8c8791;font-size:12px;line-height:1.5}
#migo-notice-panel .migo-np-empty{text-align:center;color:#999;padding:45px 15px}
@media(prefers-reduced-motion:no-preference){#migo-notice-panel .migo-np-sheet{animation:migoNoticeIn .18s ease-out}@keyframes migoNoticeIn{from{transform:translateY(14px);opacity:.7}to{transform:none;opacity:1}}}
#migo-notice-shortcuts button,#migo-notice-panel button{touch-action:manipulation;-webkit-tap-highlight-color:transparent}
</style>
"""

js = r"""
<script id="migo-notification-center-script-v1">
(()=>{
 if(window.MigoNotifications)return;
 const KEY="migo_notifications_local_v1",MAX=250;
 const categories=[
  {id:"system",label:"إشعارات النظام",icon:"📢"},
  {id:"family",label:"العائلة",icon:"👨‍👩‍👧"},
  {id:"recharge",label:"مساعد نشاط الشحن",icon:"💰"},
  {id:"agency",label:"مساعد وكالة",icon:"🪙"}
 ];
 const read=()=>{try{const a=JSON.parse(localStorage.getItem(KEY)||"[]");return Array.isArray(a)?a.slice(-MAX):[]}catch(_){return[]}};
 let items=read(),active="all",panel=null,shortcuts=null;
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 function account(){
  try{
   if(typeof U==="function"){const u=U();if(u)return String(u.id||u._id||u.username||u.phone||u.name||"local-user")}
  }catch(_){}
  for(const k of ["migo_user_id","currentUserId","userId","migo_current_user"]){try{const v=localStorage.getItem(k);if(v)return v}catch(_){}}
  return "local-user";
 }
 function role(){
  try{if(typeof U==="function"){const u=U()||{};return String(u.role||u.type||"user").toLowerCase()}}catch(_){}
  return "user";
 }
 const mine=()=>items.filter(x=>x.recipient===account());
 const unread=arr=>arr.filter(x=>!x.read).length;
 function save(){try{localStorage.setItem(KEY,JSON.stringify(items.slice(-MAX)))}catch(_){}renderShortcuts()}
 function add(data={}){
  const category=categories.some(c=>c.id===data.category)?data.category:"system";
  const recipient=String(data.recipient||account());
  const item={id:Date.now().toString(36)+Math.random().toString(36).slice(2,7),category,
   title:String(data.title||categories.find(c=>c.id===category).label).slice(0,90),
   body:String(data.body||"").slice(0,400),at:Date.now(),read:false,
   recipient,target:String(data.target||"")};
  items.push(item);items=items.slice(-MAX);save();renderPanel();
  window.dispatchEvent(new CustomEvent("migo:notification-added",{detail:item}));
  return item.id;
 }
 function markRead(id){items=items.map(x=>x.id===id?{...x,read:true}:x);save()}
 function open(target){if(!target)return;try{if(typeof nav==="function")nav(target);else window.dispatchEvent(new CustomEvent("migo:notification-open",{detail:{target}}))}catch(_){}}
 function ensure(){
  if(!shortcuts){
   shortcuts=document.createElement("section");shortcuts.id="migo-notice-shortcuts";
   shortcuts.innerHTML=categories.map(c=>'<button class="migo-ns-item" type="button" data-cat="'+c.id+'"><span class="migo-ns-icon">'+c.icon+'</span><span class="migo-ns-label">'+c.label+'</span><span class="migo-ns-count" hidden>0</span></button>').join("");
   shortcuts.addEventListener("click",e=>{const b=e.target.closest("[data-cat]");if(b)show(b.dataset.cat)});
  }
  if(!panel){
   panel=document.createElement("div");panel.id="migo-notice-panel";panel.hidden=true;
   panel.innerHTML='<div class="migo-np-sheet"><header class="migo-np-head"><span>الإشعارات</span><button class="migo-np-close" type="button" aria-label="إغلاق">×</button></header><nav class="migo-np-tabs"></nav><div class="migo-np-list"></div></div>';
   panel.querySelector(".migo-np-close").onclick=()=>panel.hidden=true;
   panel.addEventListener("click",e=>{if(e.target===panel)panel.hidden=true});
   panel.querySelector(".migo-np-tabs").innerHTML='<button data-filter="all">الكل</button>'+categories.map(c=>'<button data-filter="'+c.id+'">'+c.icon+'</button>').join("");
   panel.querySelector(".migo-np-tabs").addEventListener("click",e=>{const b=e.target.closest("[data-filter]");if(b)show(b.dataset.filter)});
   document.body.appendChild(panel);
  }
  const main=document.querySelector("#main")||document.querySelector("main")||document.body;
  if(shortcuts.parentElement!==main)main.insertBefore(shortcuts,main.firstChild);
 }
 function renderShortcuts(){
  if(!shortcuts)return;
  categories.forEach(c=>{const b=shortcuts.querySelector('[data-cat="'+c.id+'"] .migo-ns-count');const n=unread(mine().filter(x=>x.category===c.id));b.textContent=n>99?"99+":String(n);b.hidden=!n});
 }
 function renderPanel(){
  if(!panel)return;
  const list=panel.querySelector(".migo-np-list"),all=mine(),rows=active==="all"?all:all.filter(x=>x.category===active);
  panel.querySelectorAll("[data-filter]").forEach(b=>b.classList.toggle("active",b.dataset.filter===active));
  if(!rows.length){list.innerHTML='<div class="migo-np-empty">لا توجد إشعارات حتى الآن</div>';return}
  list.innerHTML=rows.slice().reverse().map(x=>{const c=categories.find(z=>z.id===x.category);return '<button class="migo-np-row '+(x.read?"":"unread")+'" data-id="'+esc(x.id)+'" type="button"><span class="migo-np-bullet">'+c.icon+'</span><span class="migo-np-copy"><b>'+esc(x.title)+'</b><small>'+esc(x.body)+'</small><small>'+new Date(x.at).toLocaleString("ar-EG")+'</small></span></button>'}).join("");
  list.querySelectorAll("[data-id]").forEach(b=>b.onclick=()=>{const x=items.find(z=>z.id===b.dataset.id);if(!x)return;markRead(x.id);renderPanel();if(x.target){panel.hidden=true;open(x.target)}});
 }
 function show(filter){ensure();active=filter||"all";panel.hidden=false;renderPanel();items=items.map(x=>x.recipient===account()?{...x,read:true}:x);save();renderPanel()}
 function attach(){
  ensure();
  // Show shortcuts on the messages view only; otherwise keep the home layout untouched.
  const tabs=document.querySelector("#tabs");
  const msg=tabs&&tabs.querySelector('[data-t="messages"]');
  const isMessages=!!(msg&&(msg.classList.contains("active")||msg.getAttribute("aria-selected")==="true"||location.hash.includes("messages")));
  shortcuts.hidden=!isMessages;
  renderShortcuts();
 }
 const api={add,open:show,markRead,getUnread:()=>unread(mine()),list:()=>mine().slice(),categories:()=>categories.slice()};
 window.MigoNotifications=api;
 window.addEventListener("migo:notification",e=>add(e.detail||{}));
 window.addEventListener("storage",e=>{if(e.key===KEY){items=read();renderShortcuts();renderPanel()}});
 const observer=new MutationObserver(attach);
 function start(){ensure();attach();observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:["class","aria-selected"]});}
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();
})();
</script>
"""

if style_id not in html:
    if "</head>" not in html: raise SystemExit("Missing </head>")
    html = html.replace("</head>", css + "\n</head>", 1)
if script_id not in html:
    if "</body>" not in html: raise SystemExit("Missing </body>")
    html = html.replace("</body>", js + "\n</body>", 1)
p.write_text(html, encoding="utf-8")
print("Installed local notification center. App actions can publish via MigoNotifications.add() or migo:notification event.")
