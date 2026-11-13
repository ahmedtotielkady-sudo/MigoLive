#!/usr/bin/env python3
"""Install MigoLive display cleanup and in-room game launcher."""
from pathlib import Path

p = Path("index.html")
if not p.exists():
    raise SystemExit("index.html is missing")
html = p.read_text(encoding="utf-8")

style_id = "migo-game-room-launcher-style-v1"
script_id = "migo-game-room-launcher-script-v1"

css = r"""
<style id="migo-game-room-launcher-style-v1">
/* Games open as an immersive layer; app tabs are hidden until the game closes. */
body.migo-game-open #tabs,
body.migo-game-open nav#tabs,
body.migo-game-open .bottom-nav,
body.migo-game-open #bottom-nav,
body.migo-game-open .app-bottom-nav {display:none!important}
body.migo-game-open #main{visibility:hidden!important}
body.migo-game-open #room-float{visibility:hidden!important}
body.migo-game-open #migo-game-overlay{visibility:visible!important}
body.migo-game-open #migo-game-overlay iframe{height:100dvh!important;min-height:100dvh!important}
body.migo-game-open #migo-game-overlay .migo-game-head{display:none!important}
body.migo-game-open #migo-game-overlay{inset:0!important;padding:0!important}
body.migo-game-open #main{padding-bottom:0!important}
#migo-game-overlay{position:fixed;inset:0;z-index:2147483000;background:#10051d;display:flex;flex-direction:column}
#migo-game-overlay[hidden]{display:none!important}
#migo-game-overlay .migo-game-head{height:48px;min-height:48px;display:flex;align-items:center;justify-content:space-between;padding:0 12px;background:#19082c;color:#ffe18a;border-bottom:1px solid #d6a83c}
#migo-game-overlay .migo-game-head button{background:#3a102b;color:#fff;border:1px solid #e6bd58;border-radius:12px;padding:7px 14px;font-weight:800}
#migo-game-overlay iframe{border:0;display:block;flex:1;width:100%;height:100%;background:#10051d}
#migo-game-picker{position:fixed;inset:0;z-index:2147482999;background:#090313d9;display:flex;align-items:center;justify-content:center;padding:22px}
#migo-game-picker[hidden]{display:none!important}
#migo-game-picker .migo-picker-card{width:min(420px,100%);border:1px solid #d9aa4b;border-radius:22px;padding:18px;background:linear-gradient(145deg,#38135e,#170b2c);color:#fff;text-align:center}
#migo-game-picker .migo-picker-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:14px}
#migo-game-picker button{padding:13px 8px;border:1px solid #d9aa4b;border-radius:14px;background:#240d40;color:#ffe6a2;font-weight:800}
#migo-game-picker .migo-picker-close{margin-top:12px;background:#54132e;color:#fff}
/* Improve tap response without changing existing visual design. */
#migo-game-overlay button,#migo-game-picker button{touch-action:manipulation;-webkit-tap-highlight-color:transparent;min-height:44px}
body.migo-game-open{overflow:hidden!important;overscroll-behavior:none}
</style>
"""

js = r"""
<script id="migo-game-room-launcher-script-v1">
(()=>{
 if(window.__migoGameRoomLauncherInstalled)return;
 window.__migoGameRoomLauncherInstalled=true;
 const games=[
  {name:"عجلة الحيوانات",url:"wheel-animals.html"},
  {name:"عاصفة المحيط",url:"slot-ocean-storm.html"},
  {name:"سلوت 777",url:"slot-777.html"}
 ];
 const cleanText=()=>{
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
  for(const n of nodes){
   const v=n.nodeValue||"";
   if(/^(?:\s*(?:\\n|n\\n|\\\\n)\s*)+$/.test(v)){n.nodeValue="";continue}
   n.nodeValue=v.replace(/(?:\s*\\n\s*){2,}/g," ").replace(/(?:^|\s)n\\n(?=\s|$)/g," ");
  }
 };
 let picker,overlay;
 function ensureUI(){
  if(!picker){
   picker=document.createElement("div");picker.id="migo-game-picker";picker.hidden=true;
   picker.innerHTML='<div class="migo-picker-card"><b>اختار لعبة</b><div class="migo-picker-grid"></div><button class="migo-picker-close">إغلاق</button></div>';
   const grid=picker.querySelector(".migo-picker-grid");
   games.forEach(g=>{const b=document.createElement("button");b.textContent=g.name;b.addEventListener("click",()=>openGame(g));grid.appendChild(b)});
   picker.querySelector(".migo-picker-close").onclick=()=>picker.hidden=true;
   document.body.appendChild(picker);
  }
  if(!overlay){
   overlay=document.createElement("div");overlay.id="migo-game-overlay";overlay.hidden=true;
   overlay.innerHTML='<div class="migo-game-head"><b>اللعبة</b><button type="button">رجوع ✕</button></div><iframe allow="fullscreen; autoplay"></iframe>';
   overlay.querySelector("button").onclick=closeGame;
   document.body.appendChild(overlay);
  }
 }
 function openPicker(){ensureUI();picker.hidden=false}
 function openGame(g){
  ensureUI();picker.hidden=true;
  const frame=overlay.querySelector("iframe");
  frame.src=g.url;overlay.querySelector("b").textContent=g.name;
  overlay.hidden=false;document.body.classList.add("migo-game-open");
  try{history.pushState({migoGame:true},"","#migo-game")}catch(_){}
 }
 function closeGame(fromHistory=false){
  if(!overlay||overlay.hidden)return;
  overlay.querySelector("iframe").src="about:blank";
  overlay.hidden=true;
  document.body.classList.remove("migo-game-open");
  // Keep the voice room mounted and visible underneath the game layer.
  if(!fromHistory&&location.hash==="#migo-game"){try{history.back()}catch(_){}}
 }
 window.addEventListener("popstate",()=>{if(overlay&&!overlay.hidden)closeGame(true)});
 function isRoomGameButton(button){
  if(!button||!button.closest("#room-float-panel"))return false;
  const label=[button.textContent,button.getAttribute("aria-label"),button.title,
    button.dataset.action,button.className].filter(Boolean).join(" ").toLowerCase();
  return /🎮|gamepad|game|الألعاب|العاب|لعبة|العاب/.test(label);
 }
 // The gamepad action inside the room composer opens the game picker in-place.
 // Do not hijack the global Games tab: it must continue to show the Games page.
 function bindRoomGameAction(){
  if(document.documentElement.dataset.migoRoomGameAction==="1")return;
  document.documentElement.dataset.migoRoomGameAction="1";
  document.addEventListener("click",e=>{
   const button=e.target&&e.target.closest&&e.target.closest("button,[role=button],a");
   if(!isRoomGameButton(button))return;
   e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
   openPicker();
  },true);
  document.querySelectorAll("#migo-room-game-launcher").forEach(x=>x.remove());
 }
 function sync(){
  bindRoomGameAction();
  const active=!!(overlay&&!overlay.hidden);
  document.body.classList.toggle("migo-game-open",active);
 }
 // Clean once, then watch only for tab replacement/navigation.
 const mo=new MutationObserver(()=>bindGamesTab());
 function start(){ensureUI();cleanText();sync();mo.observe(document.body,{subtree:true,childList:true});}
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();
 window.MigoRoomGames={openPicker,openGame,closeGame};
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
print("Installed MigoLive display cleanup and in-room game launcher")
