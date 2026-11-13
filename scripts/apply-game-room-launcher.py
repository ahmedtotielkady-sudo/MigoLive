#!/usr/bin/env python3
"""Install MigoLive display cleanup and in-room game launcher."""
from pathlib import Path

p = Path("index.html")
if not p.exists():
    raise SystemExit("index.html is missing")
html = p.read_text(encoding="utf-8")
# Expose the signed-in user's actual profile data to local game iframes.
profile_anchor = "function U(){return DB.users[me]}"
profile_getter = """function U(){return DB.users[me]}
window.__migoGetGameProfile=function(){
 try{const u=U();return {name:u&&u.name?u.name:"",avatar:u&&typeof okAv==="function"&&okAv(u)?u.avatar:"",coins:u&&Number.isFinite(Number(u.coins))?Number(u.coins):0}}
 catch(_){return {name:"",avatar:"",coins:0}}
};"""
if profile_anchor in html and "window.__migoGetGameProfile" not in html:
    html = html.replace(profile_anchor, profile_getter, 1)
elif "window.__migoGetGameProfile" not in html:
    raise SystemExit("Could not expose profile bridge: user function not found")

# Register Big Warrior in the app's real Games tab and load it as a local HTML game.
gm_anchor = "cleopatra:{n:'ذهب كليوباترا',i:'👑',d:'سلوت 5×4 · عملات المحفظة'}};"
gm_replacement = "cleopatra:{n:'ذهب كليوباترا',i:'👑',d:'سلوت 5×4 · عملات المحفظة'},warrior:{n:'المحارب الكبير',i:'🦁',d:'الأسد ضد النمر · عملات المحفظة'}};"
if gm_anchor in html:
    html = html.replace(gm_anchor, gm_replacement, 1)
elif "warrior:{n:'المحارب الكبير'" not in html:
    raise SystemExit("Could not register Big Warrior in the Games list")

open_anchor = "let gameSource;if(k==='cleopatra'){const response=await fetch('games/cleopatra-gold.html');if(!response.ok)throw new Error('تعذر تحميل اللعبة محلياً');gameSource=await response.text()}else{gameSource=dec(GB[k])}"
open_replacement = "let gameSource;if(k==='cleopatra'||k==='warrior'){const file=k==='cleopatra'?'cleopatra-gold.html':'big-warrior.html';const response=await fetch('games/'+file);if(!response.ok)throw new Error('تعذر تحميل اللعبة محلياً');gameSource=await response.text()}else{gameSource=dec(GB[k])}"
if open_anchor in html:
    html = html.replace(open_anchor, open_replacement, 1)
elif "k==='warrior'?" not in html:
    raise SystemExit("Could not route Big Warrior to its local HTML file")


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
body.migo-game-open [style*="position: fixed"][style*="bottom"],
body.migo-game-open .safe-area-bottom,body.migo-game-open .bottom-navigation{
 display:none!important;visibility:hidden!important;pointer-events:none!important;height:0!important
}
/* One consistent floating exit control for every game launch path. Align it with the in-game coin row. */
body.migo-game-open #migo-game-overlay .migo-game-head{display:flex!important;position:absolute!important;z-index:20;top:calc(env(safe-area-inset-top,0px) + 52px);right:22px;left:auto;width:auto;height:auto;min-height:0;padding:0;background:transparent;border:0;align-items:center;justify-content:flex-end;pointer-events:none}
body.migo-game-open #migo-game-overlay .migo-game-head b{display:none!important}
body.migo-game-open #migo-game-overlay .migo-game-head button{pointer-events:auto;border:2px solid #e6bd58;border-radius:16px;background:linear-gradient(145deg,#64152f,#3b0922);color:#fff;padding:9px 18px;font-size:16px;font-weight:900;min-height:46px;box-shadow:0 3px 12px #0007}
@media(max-width:420px){body.migo-game-open #migo-game-overlay .migo-game-head{right:14px;top:calc(env(safe-area-inset-top,0px) + 52px)}body.migo-game-open #migo-game-overlay .migo-game-head button{padding:7px 13px;font-size:14px}}

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
  {name:"سلوت 777",url:"slot-777.html"},
  {name:"ذهب كليوباترا",url:"games/cleopatra-gold.html"},
  {name:"المحارب الكبير",url:"games/big-warrior.html"}
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
   const visuals={"عجلة الحيوانات":["🐯","اختر حيوانك"],"عاصفة المحيط":["🌊","سلوت 5×6"],"سلوت 777":["🎰","سلوت 3×5"],"ذهب كليوباترا":["👑","سلوت 5×4 · رصيد المحفظة"]};
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
 function openGame(g,source="room"){
  ensureUI();picker.hidden=true;
  const frame=overlay.querySelector("iframe");
  frame.onload=()=>{
   try{
    const profile=typeof window.__migoGetGameProfile==="function"?window.__migoGetGameProfile():{name:"",avatar:"",coins:0};
    frame.contentWindow.postMessage({t:"me",name:profile.name||"",avatar:profile.avatar||""},"*");
    frame.contentWindow.postMessage({t:"bal",v:Number(profile.coins)||0},"*");
   }catch(err){console.warn("Migo game profile delivery:",err)}
  };
  frame.src=g.url;overlay.querySelector("b").textContent=g.name;
  overlay.classList.remove("room-origin");
  const head=overlay.querySelector(".migo-game-head");
  head.classList.remove("room-origin");
  head.querySelector("button").textContent="خروج من اللعبة";
  overlay.hidden=false;document.body.classList.add("migo-game-open");
  try{history.pushState({migoGame:true,source},"","#migo-game")}catch(_){}
 }
 function closeGame(fromHistory=false){
  if(!overlay||overlay.hidden)return;
  overlay.querySelector("iframe").src="about:blank";
  overlay.hidden=true;
  document.body.classList.remove("migo-game-open");
  // Keep the voice room mounted and visible underneath the game layer.
  if(!fromHistory&&location.hash==="#migo-game"){try{history.back()}catch(_){}}
 }
 // Bridge the game iframe to the app's actual user wallet. The legacy wallet
 // listener only trusts #gf, so this separate overlay iframe needs its own bridge.
 window.addEventListener("message",e=>{
  if(!overlay||e.source!==overlay.querySelector("iframe").contentWindow)return;
  const d=e.data||{};
  try{
   if(d.t==="get"){
    const profile=typeof window.__migoGetGameProfile==="function"?window.__migoGetGameProfile():{name:"",avatar:"",coins:0};
    e.source.postMessage({t:"bal",v:Number(profile.coins)||0},"*");
    e.source.postMessage({t:"me",name:profile.name||"",avatar:profile.avatar||""},"*");
   }else if(d.t==="set"&&Number.isFinite(d.v)&&d.v>=0){
    const u=typeof U==="function"?U():null;
    if(!u)return;
    u.coins=Math.floor(d.v);
    if(typeof save==="function")save();
    const coinNode=document.querySelector("#mycoins");
    if(coinNode)coinNode.textContent=u.coins;
    window.dispatchEvent(new CustomEvent("migo:wallet-updated",{detail:{coins:u.coins}}));
   }else if(d.t==="wallet"){
    window.dispatchEvent(new CustomEvent("migo:open-wallet"));
   }
  }catch(err){console.warn("Migo game wallet bridge:",err)}
 });
 window.addEventListener("popstate",()=>{if(overlay&&!overlay.hidden)closeGame(true)});
 function isRoomGameButton(button){
  if(!button||!button.closest("#room-float-panel"))return false;
  const label=[button.textContent,button.getAttribute("aria-label"),button.title,
    button.dataset.action,button.className].filter(Boolean).join(" ").toLowerCase();
  return /🎮|gamepad|game|الألعاب|العاب|لعبة/.test(label);
 }
 function gameFromLink(button){
  if(!button)return null;
  const raw=button.getAttribute("href")||button.dataset.game||button.dataset.url||"";
  const label=[button.textContent,button.getAttribute("aria-label"),button.title,raw].filter(Boolean).join(" ").toLowerCase();
  return games.find(g=>raw.includes(g.url)||label.includes(g.name.toLowerCase())||
    (g.name==="عجلة الحيوانات"&&/wheel-animals/.test(raw))||
    (g.name==="عاصفة المحيط"&&/slot-ocean-storm/.test(raw))||
    (g.name==="سلوت 777"&&/slot-777/.test(raw)));
 }
 function bindGamesEverywhere(){
  if(document.documentElement.dataset.migoGamesEverywhere==="1")return;
  document.documentElement.dataset.migoGamesEverywhere="1";
  document.addEventListener("click",e=>{
   const el=e.target&&e.target.closest&&e.target.closest("a,button,[role=button]");
   if(!el||el.closest("#migo-game-overlay,#migo-game-picker,#room-float-panel"))return;
   const game=gameFromLink(el);
   if(!game)return;
   e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
   openGame(game,"section");
  },true);
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
 const mo=new MutationObserver(()=>{bindRoomGameAction();bindGamesEverywhere()});
 function start(){ensureUI();cleanText();sync();bindGamesEverywhere();mo.observe(document.body,{subtree:true,childList:true});}
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

# Slightly compact the warrior game's controls and fighter cards without changing artwork.
warrior = Path("games/big-warrior.html")
if not warrior.exists():
    raise SystemExit("games/big-warrior.html is missing")
warrior_html = warrior.read_text(encoding="utf-8")
warrior_style_id = "migo-big-warrior-compact-v1"
warrior_css = r"""
<style id="migo-big-warrior-compact-v1">
/* Mild 8–10% size reduction; preserve the original game artwork and layout. */
#app{padding:8px 12px 11px}
.prize{margin:7px auto 4px;padding:3px 22px}
.prize b{font-size:23px}
.arena{gap:8px}
.card{height:82%;border-width:2px}
.card .fighter{font-size:84px}
.card .name{font-size:16px;padding:3px 0}
.drawbtn{margin-top:4px;padding:3px 19px;font-size:14px}
.status{margin:6px auto;padding:3px 18px;font-size:13px}
.bet{gap:7px}
.step{width:48px;font-size:27px}
.go{font-size:18px;padding:5px 0}
.go small{font-size:15px}
.note{font-size:10px;margin-top:4px}
@media(max-height:640px){
 .card{height:80%}
 .card .fighter{font-size:58px}
 .prize b{font-size:20px}
 .status{margin:4px auto}
}
</style>
"""
if warrior_style_id not in warrior_html:
    if "</head>" not in warrior_html:
        raise SystemExit("Missing </head> in big-warrior.html")
    warrior_html = warrior_html.replace("</head>", warrior_css + "\n</head>", 1)
    warrior.write_text(warrior_html, encoding="utf-8")
print("Installed MigoLive display cleanup, game launcher, and compact warrior layout")
