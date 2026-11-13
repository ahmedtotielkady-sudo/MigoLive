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
/* Keep the active room underneath; hide app chrome only while a game is running. */
body.migo-game-open #tabs,body.migo-game-open nav#tabs,body.migo-game-open .bottom-nav,
body.migo-game-open #bottom-nav,body.migo-game-open .app-bottom-nav,
body.migo-game-open .tab-bar,body.migo-game-open .bottom-tabs,
body.migo-game-open .main-tabs,body.migo-game-open .navigation-bar,
body.migo-game-open .app-navigation,body.migo-game-open footer,
body.migo-game-open [role="navigation"],
body.migo-game-open [style*="position: fixed"][style*="bottom"]{
 display:none!important;visibility:hidden!important;pointer-events:none!important
}
body.migo-game-open{overflow:hidden!important;overscroll-behavior:none}
#migo-game-overlay{position:fixed;inset:0;z-index:2147483000;background:#10051d;display:flex;flex-direction:column;padding:0}
#migo-game-overlay[hidden]{display:none!important}
#migo-game-overlay .migo-game-head{display:none!important}
#migo-game-overlay iframe{border:0;display:block;flex:1;width:100%;height:100dvh;min-height:100dvh;background:#10051d}
#migo-game-picker{position:fixed;inset:0;z-index:2147482999;background:#090313d9;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
#migo-game-picker[hidden]{display:none!important}
#migo-game-picker .migo-picker-card{width:min(520px,100%);max-height:calc(100dvh - 32px);overflow:auto;box-sizing:border-box;border:1px solid #d9aa4b;border-radius:24px;padding:18px;background:linear-gradient(160deg,#f7f1ff,#e9ddfa);color:#24123c;text-align:center;box-shadow:0 16px 50px #0006}
#migo-game-picker .migo-picker-title{font-size:22px;font-weight:900;margin:2px 0 14px}
#migo-game-picker .migo-picker-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
#migo-game-picker .migo-game-card{min-width:0;min-height:142px;padding:14px 8px;border:1.5px solid #a65ae7;border-radius:20px;background:linear-gradient(145deg,#fff,#eee5fb);color:#25123c;font:inherit;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;box-shadow:0 6px 16px #5b248522}
#migo-game-picker .migo-game-icon{width:68px;height:68px;border:2px solid #d9aa4b;border-radius:18px;background:#160a29;color:#fff;display:grid;place-items:center;font-size:38px}
#migo-game-picker .migo-game-name{font-size:17px;font-weight:900}
#migo-game-picker .migo-game-desc{font-size:12px;color:#76658c}
#migo-game-picker .migo-picker-close{margin-top:14px;min-width:110px;padding:10px 18px;border:1px solid #d9aa4b;border-radius:15px;background:#54132e;color:#fff;font-weight:800}
#migo-game-overlay button,#migo-game-picker button{touch-action:manipulation;-webkit-tap-highlight-color:transparent;min-height:44px}
@media(max-height:560px){#migo-game-picker .migo-picker-card{padding:10px}#migo-game-picker .migo-game-card{min-height:100px;padding:7px}#migo-game-picker .migo-game-icon{width:48px;height:48px;font-size:28px}}
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
   picker.innerHTML='<div class="migo-picker-card"><div class="migo-picker-title">الألعاب</div><div class="migo-picker-grid"></div><button class="migo-picker-close" type="button">إغلاق</button></div>';
   const grid=picker.querySelector(".migo-picker-grid");
   const visuals={"عجلة الحيوانات":["🐯","اختر حيوانك"],"عاصفة المحيط":["🌊","سلوت 5×6"],"سلوت 777":["🎰","سلوت 3×5"]};
   games.forEach(g=>{const v=visuals[g.name]||["🎮",""];const b=document.createElement("button");b.type="button";b.className="migo-game-card";b.innerHTML='<span class="migo-game-icon">'+v[0]+'</span><span class="migo-game-name"></span><span class="migo-game-desc"></span>';b.querySelector(".migo-game-name").textContent=g.name;b.querySelector(".migo-game-desc").textContent=v[1];b.addEventListener("click",()=>openGame(g));grid.appendChild(b)});
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
 // Any supported game opened through this launcher uses the same full-screen
 // layer, regardless of whether it was launched from the room or Games page.
 window.addEventListener("migo:open-game",e=>{
  const d=e.detail||{};
  const game=games.find(g=>g.url===d.url||g.name===d.name);
  if(game)openGame(game);
 });
 // Clean once, then watch only for tab replacement/navigation.
 const mo=new MutationObserver(()=>{if(!document.documentElement.dataset.migoRoomGameAction)bindRoomGameAction()});
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
