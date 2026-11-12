#!/usr/bin/env python3
"""Install local-only MigoLive room announcement tickers.

Run from the project root:
  python scripts/apply-local-room-announcements.py

The UI and queue are device-local. Transaction code should call:
  MigoRoomAnnouncements.gameWin({ userName, coins, gameName })
  MigoRoomAnnouncements.giftSent({ senderName, receiverName, giftName, coins })
"""
from pathlib import Path

path = Path("index.html")
if not path.exists():
    raise SystemExit("index.html is missing")
html = path.read_text(encoding="utf-8")

style_id = "migo-local-room-announcements-style-v1"
script_id = "migo-local-room-announcements-script-v1"

css = r"""
<style id="migo-local-room-announcements-style-v1">
#migo-local-announcements{display:grid;gap:6px;margin:0 0 9px;width:100%;direction:rtl;position:relative;z-index:4}
#migo-local-announcements .migo-ann{height:43px;min-height:43px;box-sizing:border-box;display:flex;align-items:center;gap:9px;overflow:hidden;padding:0 10px;border-radius:15px;color:#fff;font-size:12px;font-weight:800;white-space:nowrap;position:relative}
#migo-local-announcements .migo-ann:after{content:"";position:absolute;inset:0;pointer-events:none;opacity:.55;background:linear-gradient(100deg,transparent 15%,#ffffff20 48%,transparent 75%);transform:translateX(100%);animation:migoAnnShine 4.5s linear infinite}
#migo-local-announcements .migo-ann.win{border:1px solid #d99aff;background:linear-gradient(100deg,#210b49,#7023a9 48%,#210b49);box-shadow:0 0 12px #bd55ff70}
#migo-local-announcements .migo-ann.gift{border:1px solid #65dfff;background:linear-gradient(100deg,#061e55,#075ba4 48%,#061e55);box-shadow:0 0 12px #20aaff70}
#migo-local-announcements .migo-ann .ico{font-size:22px;flex:0 0 auto}
#migo-local-announcements .migo-ann .msg{overflow:hidden;text-overflow:ellipsis;flex:1}
#migo-local-announcements .migo-ann b{color:#ffe18a}
#migo-local-announcements .migo-ann .tag{font-size:10px;opacity:.8}
@keyframes migoAnnShine{to{transform:translateX(-100%)}}
@media(prefers-reduced-motion:reduce){#migo-local-announcements .migo-ann:after{animation:none}}
</style>
"""

js = r"""
<script id="migo-local-room-announcements-script-v1">
(()=>{
  if(window.MigoRoomAnnouncements)return;
  const KEY="migo_room_global_announcements_v1";
  const MIN_WIN=20000,MIN_GIFT=5000,MAX_ITEMS=40,TTL=24*60*60*1000;
  const safeRead=()=>{try{return JSON.parse(localStorage.getItem(KEY)||"[]").filter(x=>x&&Date.now()-x.at<TTL)}catch(_){return[]}};
  let queue=safeRead(),lastShown={win:"",gift:""};
  const persist=()=>{try{localStorage.setItem(KEY,JSON.stringify(queue.slice(-MAX_ITEMS)))}catch(_){}};
  const clean=v=>String(v??"").replace(/[<>]/g,"").trim().slice(0,70);
  function push(type,data){
    const coins=Math.floor(Number(data?.coins)||0),threshold=type==="win"?MIN_WIN:MIN_GIFT;
    if(coins<threshold)return false;
    const item={id:(Date.now().toString(36)+Math.random().toString(36).slice(2,8)),type,coins,at:Date.now(),
      userName:clean(data.userName||data.senderName||"مستخدم"),
      receiverName:clean(data.receiverName||""),giftName:clean(data.giftName||"هدية"),
      gameName:clean(data.gameName||"الألعاب")};
    queue.push(item);queue=queue.slice(-MAX_ITEMS);persist();renderAll();return true;
  }
  function currentText(type){
    const item=[...queue].reverse().find(x=>x.type===type);
    if(!item)return type==="win"?"بانتظار فائز جديد في الألعاب":"بانتظار هدية مميزة";
    if(type==="win")return 'اللاعب <b>'+escapeHtml(item.userName)+'</b> فاز بـ <b>'+item.coins.toLocaleString("en-US")+'</b> عملة في '+escapeHtml(item.gameName);
    return '<b>'+escapeHtml(item.userName)+'</b> أرسل '+escapeHtml(item.giftName)+' إلى <b>'+escapeHtml(item.receiverName||"مستخدم")+'</b> بقيمة <b>'+item.coins.toLocaleString("en-US")+'</b> عملة';
  }
  function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
  function ensure(panel){
    if(!panel||panel.querySelector("#migo-local-announcements"))return;
    const wrap=document.createElement("div");wrap.id="migo-local-announcements";
    wrap.innerHTML='<div class="migo-ann win"><span class="ico">🏆</span><span class="msg"></span><span class="tag">فوز كبير</span></div><div class="migo-ann gift"><span class="ico">🎁</span><span class="msg"></span><span class="tag">هدية مميزة</span></div>';
    panel.insertBefore(wrap,panel.firstChild);
  }
  function renderPanel(panel){
    ensure(panel);const wrap=panel&&panel.querySelector("#migo-local-announcements");if(!wrap)return;
    wrap.querySelector(".win .msg").innerHTML=currentText("win");
    wrap.querySelector(".gift .msg").innerHTML=currentText("gift");
  }
  function renderAll(){
    document.querySelectorAll("#room-float-panel").forEach(renderPanel);
  }
  const api={
    gameWin(data){return push("win",data||{});},
    giftSent(data){return push("gift",data||{});},
    get thresholds(){return {gameWin:MIN_WIN,gift:MIN_GIFT};},
    clear(){queue=[];persist();renderAll();},
    refresh:renderAll
  };
  window.MigoRoomAnnouncements=api;
  window.addEventListener("migo:game-win",e=>api.gameWin(e.detail));
  window.addEventListener("migo:gift-sent",e=>api.giftSent(e.detail));
  const observer=new MutationObserver(renderAll);
  const start=()=>{renderAll();observer.observe(document.body,{childList:true,subtree:true});};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();
  window.addEventListener("storage",e=>{if(e.key===KEY){queue=safeRead();renderAll();}});
})();
</script>
"""

if style_id not in html:
    if "</head>" not in html: raise SystemExit("Missing </head>; no changes made")
    html=html.replace("</head>",css+"\n</head>",1)
if script_id not in html:
    if "</body>" not in html: raise SystemExit("Missing </body>; no changes made")
    html=html.replace("</body>",js+"\n</body>",1)
path.write_text(html,encoding="utf-8")
print("Installed local room announcement bars. Transaction hooks must call the API shown in the script header.")
