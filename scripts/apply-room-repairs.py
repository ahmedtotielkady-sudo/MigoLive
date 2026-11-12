#!/usr/bin/env python3
from pathlib import Path

path = Path("index.html")
if not path.exists():
    raise SystemExit("index.html is missing")
html = path.read_text(encoding="utf-8")

style_id = 'mygo-room-modal-layer-fix-v1'
if style_id not in html:
    marker = '</style>\n\n<style id="mygo-global-reachability-scroll-fix-v1">'
    patch = '''</style>

<style id="mygo-room-modal-layer-fix-v1">
/* Room overlay is z-index 9000. Room settings and dialogs are siblings of it,
   so they must be above it to receive taps in Android WebView. */
#rs{z-index:10020!important;pointer-events:auto!important}
.dlg{z-index:10030!important;pointer-events:auto!important}
.dlg .dlgc,.dlg button,.dlg input,.dlg label{pointer-events:auto!important;touch-action:manipulation}
#room-float-panel .room-compose,#room-float-panel .room-compose button{pointer-events:auto!important;touch-action:manipulation}
#room-float-panel button{touch-action:manipulation;-webkit-tap-highlight-color:transparent}
</style>

<style id="mygo-global-reachability-scroll-fix-v1">'''
    if marker not in html:
        raise SystemExit("Could not find CSS insertion marker; refusing unsafe patch")
    html = html.replace(marker, patch, 1)

needle = "}\ndocument.querySelectorAll('#tabs button').forEach(b=>b.onclick=()=>nav(b.dataset.t));"
replacement = """}
function refreshRoomUI(){
  const panel=$('#room-float-panel');
  if(room&&panel){renderRoom(panel);const coins=$('#mycoins');if(coins&&U())coins.textContent=U().coins;}
  else render();
}
document.querySelectorAll('#tabs button').forEach(b=>b.onclick=()=>nav(b.dataset.t));"""
if "function refreshRoomUI()" not in html:
    if needle not in html:
        raise SystemExit("Could not find render() insertion marker; refusing unsafe patch")
    html = html.replace(needle, replacement, 1)

replacements = [
    ("if(s&&a!=='unlock'&&a!=='ban'&&prot(r,s)){sel=null;toast('عضو VIP محمي من إجراءات الأدمن');return render()}",
     "if(s&&a!=='unlock'&&a!=='ban'&&prot(r,s)){sel=null;toast('عضو VIP محمي من إجراءات الأدمن');return refreshRoomUI()}"),
    ("if(adm&&s!==me&&(s||r.lock.includes(i))){sel=i;return render()}",
     "if(adm&&s!==me&&(s||r.lock.includes(i))){sel=i;return refreshRoomUI()}"),
    ("sel=null;save();render()})}\n  m.querySelectorAll('[data-s]')",
     "sel=null;save();refreshRoomUI()})}\n  m.querySelectorAll('[data-s]')"),
    ("save();render()});\n  const send=()=>",
     "save();refreshRoomUI()});\n  const send=()=>"),
    ("sfx('msg');r.chat=r.chat.slice(-60);save();render();$('#mi').focus()",
     "sfx('msg');r.chat=r.chat.slice(-60);save();refreshRoomUI();$('#mi').focus()"),
    ("r.chat=r.chat.slice(-60);save();render()};\n  $('#mic').onclick",
     "r.chat=r.chat.slice(-60);save();refreshRoomUI()};\n  $('#mic').onclick"),
    ("talk=!talk;render()};\n  $('#gift').onclick",
     "talk=!talk;refreshRoomUI()};\n  $('#gift').onclick"),
    ("DB.gifts=DB.gifts.slice(0,3000);r.chat=r.chat.slice(-60);save();render();giftFx",
     "DB.gifts=DB.gifts.slice(0,3000);r.chat=r.chat.slice(-60);save();refreshRoomUI();giftFx"),
    ("save();render();\n  };\n  if(adm)",
     "save();refreshRoomUI();\n  };\n  if(adm)")
]
for old, new in replacements:
    if new not in html:
        if old in html:
            html = html.replace(old, new, 1)
        else:
            # Do not fail when a specific action was already changed upstream.
            continue


mini_style_id = 'mygo-room-mini-upper-left-v1'
if mini_style_id not in html:
    mini_style = '''
<style id="mygo-room-mini-upper-left-v1">
/* Compact minimized room shortcut at the upper-left. */
#room-float.minimized{
  inset:calc(env(safe-area-inset-top,0px) + 8px) auto auto 8px!important;
  width:auto!important;height:auto!important;padding:0!important;
  background:transparent!important;z-index:9500!important;
}
#room-float.minimized #room-float-panel{display:none!important}
#room-float.minimized #room-float-mini{
  display:flex!important;flex-direction:column;align-items:center;justify-content:center;
  width:76px!important;min-width:76px!important;height:64px!important;min-height:64px!important;
  padding:5px!important;border-radius:13px!important;border:1px solid #d8b66a!important;
  font-size:12px!important;line-height:1.2!important;text-align:center!important;
  background:linear-gradient(145deg,#39205f,#170d31)!important;
  box-shadow:0 4px 16px #0009!important;
}
#room-float.minimized #room-float-mini small{display:block;font-size:11px;font-weight:700}
</style>
'''
    if "</head>" not in html:
        raise SystemExit("Could not find </head> for minimized-room style")
    html = html.replace("</head>", mini_style + "\\n</head>", 1)
    html = html.replace(
        'aria-label="العودة إلى الغرفة">🎙️ العودة إلى الغرفة</button>',
        'aria-label="العودة إلى الغرفة">🎙️<small>الغرفة</small></button>',
        1
    )


# Keep the minimized room alive while returning to normal app navigation.
old_render = "const mini=roomFloat.querySelector('#room-float-mini');if(mini)mini.onclick=restoreRoom;renderRoom($('#room-float-panel'));"
new_render = "const mini=roomFloat.querySelector('#room-float-mini');if(mini)bindRoomMini(mini);renderRoom($('#room-float-panel'));"
if old_render in html:
    html = html.replace(old_render, new_render, 1)

old_room_functions = """function minimizeRoom(){if(!room)return;roomMinimized=true;const o=$('#room-float');if(o)o.classList.add('minimized');const m=o&&o.querySelector('#room-float-mini');if(m)m.onclick=restoreRoom;}
function restoreRoom(){if(!room)return;roomMinimized=false;const o=$('#room-float');if(o)o.classList.remove('minimized');if(location.hash!=='#room-'+room.id){try{history.pushState({migoRoom:true},'','#room-'+room.id)}catch(e){}}renderRoom($('#room-float-panel'));}"""
new_room_functions = """function bindRoomMini(mini){
  if(!mini||mini.dataset.dragBound==='1')return;
  mini.dataset.dragBound='1';
  let sx=0,sy=0,bx=0,by=0,active=false,moved=false;
  mini.addEventListener('pointerdown',e=>{
    if(e.button!==undefined&&e.button!==0)return;
    const r=mini.getBoundingClientRect();sx=e.clientX;sy=e.clientY;bx=r.left;by=r.top;active=true;moved=false;
    mini.style.position='fixed';mini.style.left=bx+'px';mini.style.top=by+'px';mini.style.right='auto';mini.style.bottom='auto';
    try{mini.setPointerCapture(e.pointerId)}catch(_){}
    e.preventDefault();
  });
  mini.addEventListener('pointermove',e=>{
    if(!active)return;
    const dx=e.clientX-sx,dy=e.clientY-sy;
    if(Math.abs(dx)>4||Math.abs(dy)>4)moved=true;
    if(!moved)return;
    const r=mini.getBoundingClientRect();
    mini.style.left=Math.max(0,Math.min(innerWidth-r.width,bx+dx))+'px';
    mini.style.top=Math.max(0,Math.min(innerHeight-r.height,by+dy))+'px';
  });
  const end=e=>{
    if(!active)return;active=false;
    try{mini.releasePointerCapture(e.pointerId)}catch(_){}
    if(moved){mini.dataset.justDragged='1';setTimeout(()=>delete mini.dataset.justDragged,350)}
  };
  mini.addEventListener('pointerup',end);mini.addEventListener('pointercancel',end);
  mini.onclick=e=>{if(mini.dataset.justDragged==='1'){e.preventDefault();e.stopPropagation();return}restoreRoom()};
}
function minimizeRoom(){if(!room)return;roomMinimized=true;render();}
function restoreRoom(){
  if(!room)return;
  roomMinimized=false;
  const o=$('#room-float'),m=o&&o.querySelector('#room-float-mini');
  if(o)o.classList.remove('minimized');
  if(m){m.style.position='';m.style.left='';m.style.top='';m.style.right='';m.style.bottom='';}
  if(location.hash!=='#room-'+room.id){try{history.pushState({migoRoom:true},'','#room-'+room.id)}catch(e){}}
  renderRoom($('#room-float-panel'));
}"""
if old_room_functions in html:
    html = html.replace(old_room_functions, new_room_functions, 1)

old_popstate = "if(room){try{history.pushState({migoRoom:true},'','#'+(roomMinimized?tab:'room-'+room.id))}catch(e){}showRoomCloseChoice();return}route()"
new_popstate = "if(room){if(roomMinimized){route();return}try{history.pushState({migoRoom:true},'','#room-'+room.id)}catch(e){}showRoomCloseChoice();return}route()"
if old_popstate in html:
    html = html.replace(old_popstate, new_popstate, 1)

mini_drag_style_id = 'mygo-room-mini-draggable-v1'
if mini_drag_style_id not in html:
    mini_drag_style = '''<style id="mygo-room-mini-draggable-v1">
#room-float.minimized #room-float-mini{
  position:fixed!important;left:8px!important;top:calc(env(safe-area-inset-top,0px) + 8px)!important;
  right:auto!important;bottom:auto!important;touch-action:none!important;cursor:grab!important;
  user-select:none!important;-webkit-user-select:none!important;z-index:99999!important;
}
#room-float.minimized #room-float-mini:active{cursor:grabbing!important}
</style>'''
    html = html.replace("</head>", mini_drag_style + "\\n</head>", 1)


# Hide the Android/WebView keyboard before switching between the app and room.
keyboard_fix_id = 'mygo-room-keyboard-dismiss-v1'
if keyboard_fix_id not in html:
    keyboard_fix = '''
function hideRoomKeyboard(){
  try{
    const active=document.activeElement;
    if(active&&active!==document.body&&active!==document.documentElement&&
       (active.matches('input,textarea,select,[contenteditable="true"]')||active.isContentEditable)){
      active.blur();
    }
  }catch(_){}
  try{
    const keyboard=window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.Keyboard;
    if(keyboard&&typeof keyboard.hide==='function')keyboard.hide();
  }catch(_){}
}
'''
    minimize_old = "function minimizeRoom(){if(!room)return;roomMinimized=true;render();}"
    minimize_new = "function minimizeRoom(){if(!room)return;hideRoomKeyboard();roomMinimized=true;render();}"
    if minimize_old in html:
        html = html.replace(minimize_old, minimize_new, 1)
    restore_old = """function restoreRoom(){
  if(!room)return;
  roomMinimized=false;
  const o=$('#room-float'),m=o&&o.querySelector('#room-float-mini');
  if(o)o.classList.remove('minimized');
  if(m){m.style.position='';m.style.left='';m.style.top='';m.style.right='';m.style.bottom='';}
  if(location.hash!=='#room-'+room.id){try{history.pushState({migoRoom:true},'','#room-'+room.id)}catch(e){}}
  renderRoom($('#room-float-panel'));
}"""
    restore_new = """function restoreRoom(){
  if(!room)return;
  hideRoomKeyboard();
  roomMinimized=false;
  const o=$('#room-float'),m=o&&o.querySelector('#room-float-mini');
  if(o)o.classList.remove('minimized');
  if(m){m.style.position='';m.style.left='';m.style.top='';m.style.right='';m.style.bottom='';}
  if(location.hash!=='#room-'+room.id){try{history.pushState({migoRoom:true},'','#room-'+room.id)}catch(e){}}
  renderRoom($('#room-float-panel'));
}"""
    if restore_old in html:
        html = html.replace(restore_old, restore_new, 1)
    if minimize_new not in html or restore_new not in html:
        raise SystemExit("Could not safely patch room keyboard dismissal")
    anchor = "function bindRoomMini(mini){"
    if anchor not in html:
        raise SystemExit("Could not find room mini interaction insertion point")
    html = html.replace(anchor, keyboard_fix + "\n" + anchor, 1)
    html = html.replace("</head>", '<style id="mygo-room-keyboard-dismiss-v1">#room-float.minimized{will-change:transform}#room-float-panel{overscroll-behavior:contain}</style>\n</head>', 1)


# When the room is minimized, restore the app shell and bottom navigation.
minimized_nav_fix_id = 'mygo-minimized-room-app-navigation-v1'
if minimized_nav_fix_id not in html:
    old_state = "document.body.classList.toggle('inroom',!!room);"
    new_state = "document.body.classList.toggle('inroom',!!room&&!roomMinimized);"
    if old_state not in html:
        raise SystemExit("Could not find room app-shell state marker")
    html = html.replace(old_state, new_state, 1)
    html = html.replace(
        "b.dataset.t)&&!room));",
        "b.dataset.t)&&(!room||roomMinimized)));",
        1
    )
    nav_css = '''<style id="mygo-minimized-room-app-navigation-v1">
/* Minimized room remains alive, while the normal app pages and bottom tabs are usable. */
body:not(.inroom) #tabs{display:flex!important;visibility:visible!important;pointer-events:auto!important}
body:not(.inroom) #main{padding-bottom:calc(88px + env(safe-area-inset-bottom,0px))!important}
#room-float.minimized{pointer-events:none!important}
#room-float.minimized #room-float-mini{pointer-events:auto!important}
</style>'''
    html = html.replace("</head>", nav_css + "\\n</head>", 1)


# Fix drag positioning: the previous CSS used !important left/top values,
# which overrode normal inline coordinates and pinned the mini-window in place.
drag_layout_fix_id = 'mygo-room-drag-layout-polish-v2'
if drag_layout_fix_id not in html:
    old_drag = """function bindRoomMini(mini){
  if(!mini||mini.dataset.dragBound==='1')return;
  mini.dataset.dragBound='1';
  let sx=0,sy=0,bx=0,by=0,active=false,moved=false;
  mini.addEventListener('pointerdown',e=>{
    if(e.button!==undefined&&e.button!==0)return;
    const r=mini.getBoundingClientRect();sx=e.clientX;sy=e.clientY;bx=r.left;by=r.top;active=true;moved=false;
    mini.style.position='fixed';mini.style.left=bx+'px';mini.style.top=by+'px';mini.style.right='auto';mini.style.bottom='auto';
    try{mini.setPointerCapture(e.pointerId)}catch(_){}
    e.preventDefault();
  });
  mini.addEventListener('pointermove',e=>{
    if(!active)return;
    const dx=e.clientX-sx,dy=e.clientY-sy;
    if(Math.abs(dx)>4||Math.abs(dy)>4)moved=true;
    if(!moved)return;
    const r=mini.getBoundingClientRect();
    mini.style.left=Math.max(0,Math.min(innerWidth-r.width,bx+dx))+'px';
    mini.style.top=Math.max(0,Math.min(innerHeight-r.height,by+dy))+'px';
  });
  const end=e=>{
    if(!active)return;active=false;
    try{mini.releasePointerCapture(e.pointerId)}catch(_){}
    if(moved){mini.dataset.justDragged='1';setTimeout(()=>delete mini.dataset.justDragged,350)}
  };
  mini.addEventListener('pointerup',end);mini.addEventListener('pointercancel',end);
  mini.onclick=e=>{if(mini.dataset.justDragged==='1'){e.preventDefault();e.stopPropagation();return}restoreRoom()};
}"""
    new_drag = """function bindRoomMini(mini){
  if(!mini||mini.dataset.dragBound==='1')return;
  mini.dataset.dragBound='1';
  let sx=0,sy=0,bx=0,by=0,active=false,moved=false,pid=null;
  const place=(x,y)=>{
    const r=mini.getBoundingClientRect();
    const nx=Math.max(4,Math.min(window.innerWidth-r.width-4,x));
    const ny=Math.max(4,Math.min(window.innerHeight-r.height-4,y));
    mini.style.setProperty('position','fixed','important');
    mini.style.setProperty('left',nx+'px','important');
    mini.style.setProperty('top',ny+'px','important');
    mini.style.setProperty('right','auto','important');
    mini.style.setProperty('bottom','auto','important');
  };
  mini.addEventListener('pointerdown',e=>{
    if(e.pointerType==='mouse'&&e.button!==0)return;
    const r=mini.getBoundingClientRect();
    sx=e.clientX;sy=e.clientY;bx=r.left;by=r.top;active=true;moved=false;pid=e.pointerId;
    mini.style.setProperty('touch-action','none');
    try{mini.setPointerCapture(e.pointerId)}catch(_){}
    e.preventDefault();e.stopPropagation();
  },{passive:false});
  window.addEventListener('pointermove',e=>{
    if(!active||pid!==e.pointerId)return;
    const dx=e.clientX-sx,dy=e.clientY-sy;
    if(Math.abs(dx)>3||Math.abs(dy)>3)moved=true;
    if(moved){place(bx+dx,by+dy);e.preventDefault()}
  },{passive:false});
  const end=e=>{
    if(!active|| (e.pointerId!==undefined&&pid!==e.pointerId))return;
    active=false;pid=null;
    if(moved){mini.dataset.justDragged='1';setTimeout(()=>delete mini.dataset.justDragged,500)}
  };
  window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);
  mini.onclick=e=>{
    if(mini.dataset.justDragged==='1'){e.preventDefault();e.stopPropagation();return}
    restoreRoom();
  };
}"""
    if old_drag not in html:
        raise SystemExit("Could not find existing draggable mini-window function")
    html = html.replace(old_drag,new_drag,1)
    # Remove the fixed !important coordinates that pinned the mini-window.
    html = html.replace(
        "position:fixed!important;left:8px!important;top:calc(env(safe-area-inset-top,0px) + 8px)!important;\\n  right:auto!important;bottom:auto!important;",
        "position:fixed!important;left:8px;top:calc(env(safe-area-inset-top,0px) + 8px);\\n  right:auto;bottom:auto;",
        1
    )
    room_css = '''<style id="mygo-room-interior-organized-v1">
/* Clear room hierarchy: title, host, seats, chat, and fixed composer. */
#room-float:not(.minimized) #room-float-panel{
  display:block!important;box-sizing:border-box!important;
  padding:calc(env(safe-area-inset-top,0px) + 8px) 12px calc(88px + env(safe-area-inset-bottom,0px))!important;
  background:linear-gradient(180deg,#4a2b30 0%,#8b5038 34%,#3a2529 100%)!important;
}
#room-float-panel .mygo-room-top{
  min-height:44px!important;height:auto!important;gap:6px!important;
  padding:5px 7px!important;margin:0 0 8px!important;border:1px solid #ffffff30!important;
  border-radius:14px!important;box-sizing:border-box!important;
}
#room-float-panel .room-title-card{max-width:48%!important}
#room-float-panel .mygo-room-stage{
  height:96px!important;min-height:96px!important;margin:0 0 8px!important;
  border-radius:16px!important;background:linear-gradient(135deg,#ffffff16,#ffffff08)!important;
  border:1px solid #ffffff22!important;
}
#room-float-panel .mygo-room-host{gap:3px!important}
#room-float-panel .rbg{
  margin:0 0 10px!important;padding:8px!important;border-radius:16px!important;
  background:#24182045!important;border:1px solid #ffffff28!important;
}
#room-float-panel .seats,#room-float-panel .seats.many{
  display:grid!important;grid-template-columns:repeat(5,minmax(0,1fr))!important;
  gap:12px 5px!important;width:100%!important;max-height:34dvh!important;
  overflow-y:auto!important;overflow-x:hidden!important;padding:6px 2px 10px!important;
  align-content:start!important;overscroll-behavior:contain!important;
}
#room-float-panel .seats .seat{
  min-width:0!important;width:100%!important;display:flex!important;
  flex-direction:column!important;align-items:center!important;gap:4px!important;
  font-size:10px!important;line-height:1.2!important;
}
#room-float-panel .seats .seat .av{
  width:clamp(38px,10vw,50px)!important;height:clamp(38px,10vw,50px)!important;
  margin:0 auto!important;flex:none!important;
}
#room-float-panel #ch{
  height:auto!important;min-height:110px!important;max-height:23dvh!important;
  overflow-y:auto!important;padding:10px!important;margin:0 0 10px!important;
  border:1px solid #ffffff28!important;border-radius:15px!important;
  background:#21151d88!important;overscroll-behavior:contain!important;
}
#room-float-panel .room-compose{
  position:fixed!important;left:0!important;right:0!important;bottom:0!important;
  width:100%!important;max-width:none!important;transform:none!important;
  z-index:999!important;padding:9px 10px calc(9px + env(safe-area-inset-bottom,0px))!important;
  box-sizing:border-box!important;background:#21151df2!important;
  border-top:1px solid #ffffff26!important;backdrop-filter:blur(14px)!important;
}
#room-float-panel .room-compose .row{gap:5px!important}
#room-float-panel .room-compose button{width:38px!important;min-width:38px!important;flex:0 0 38px!important}
#room-float-panel .room-compose #mi{min-width:0!important;flex:1 1 auto!important;width:auto!important}
@media(max-width:360px){
  #room-float-panel .seats,#room-float-panel .seats.many{grid-template-columns:repeat(4,minmax(0,1fr))!important}
  #room-float-panel .room-compose button{width:34px!important;min-width:34px!important;flex-basis:34px!important}
}
</style>'''
    html = html.replace("</head>",room_css + "\\n</head>",1)


# Premium purple-and-gold room and microphone treatment.
room_premium_id = "mygo-room-premium-purple-gold-v1"
if room_premium_id not in html:
    premium_css = r"""
#room-float:not(.minimized) #room-float-panel{
  background:
    radial-gradient(ellipse at 50% 18%,#54318b 0%,#281548 48%,#10091f 100%)!important;
  color:#fff7e8!important;
}
#room-float-panel .mygo-room-top{
  background:linear-gradient(110deg,#24113f,#452568 55%,#24113f)!important;
  border:1px solid #d9b76b99!important;box-shadow:0 5px 18px #0006!important;
}
#room-float-panel .mygo-room-stage{
  background:
    radial-gradient(ellipse at 50% 100%,#b78335aa 0%,transparent 60%),
    linear-gradient(145deg,#3b205f,#1a102d)!important;
  border:1px solid #e5c477!important;
  box-shadow:inset 0 0 22px #d6a84a22,0 8px 20px #0005!important;
}
#room-float-panel .mygo-room-host .av,
#room-float-panel .mygo-room-stage .av{
  border:2px solid #f2d58b!important;
  box-shadow:0 0 0 4px #d5a94b33,0 0 22px #e8bd62aa!important;
}
#room-float-panel .rbg{
  background:linear-gradient(145deg,#211334dd,#382052dd)!important;
  border:1px solid #c9a45b88!important;
  box-shadow:inset 0 1px #ffffff18,0 8px 22px #0004!important;
}
#room-float-panel .seats .seat .av{
  border:2px solid #c49a4d!important;
  background:radial-gradient(circle at 35% 25%,#67458d,#24143c)!important;
  box-shadow:0 0 0 3px #d8b15b22,0 4px 12px #0008!important;
  position:relative!important;overflow:visible!important;
}
#room-float-panel .seats .seat:has(.av):not(:has(img)) .av{
  color:#f4d88d!important;
}
#room-float-panel .seats .seat .av img{
  border-radius:50%!important;border:1px solid #f0d18a!important;
}
#room-float-panel .seats .seat{color:#fff1d0!important;text-shadow:0 1px 3px #000!important}
#room-float-panel .seats .seat:has(.av.talking) .av,
#room-float-panel .seats .seat.talking .av{
  border-color:#ffe7a0!important;
  box-shadow:0 0 0 4px #f4d36b55,0 0 0 8px #e5a83c33,0 0 24px #ffdc78!important;
  animation:migoMicPulse 1.15s ease-in-out infinite!important;
}
#room-float-panel #ch{
  background:linear-gradient(145deg,#180e29ee,#29183fee)!important;
  border:1px solid #c9a45b88!important;color:#fff4df!important;
}
#room-float-panel .room-compose{
  background:linear-gradient(100deg,#170d28f7,#302044f7)!important;
  border-top:1px solid #d9b76b!important;
}
#room-float-panel .room-compose button{
  border:1px solid #d7b35f!important;border-radius:12px!important;
  background:linear-gradient(145deg,#70469a,#392052)!important;color:#fff0c8!important;
}
#room-float-panel .room-compose #mi{
  background:#160d25!important;border:1px solid #a98950!important;color:#fff!important;
  border-radius:13px!important;
}
#room-float.minimized #room-float-mini{
  background:linear-gradient(145deg,#5b3788,#1a0d30)!important;
  border:1px solid #e4c476!important;color:#ffe7a6!important;
}
@keyframes migoMicPulse{
  0%,100%{filter:brightness(1);transform:scale(1)}
  50%{filter:brightness(1.3);transform:scale(1.045)}
}
@media(prefers-reduced-motion:reduce){
  #room-float-panel .seats .seat .av{animation:none!important}
}"""
    premium_style = '<style id="' + room_premium_id + '">' + premium_css + '</style>\\n'
    if "</head>" not in html:
        raise SystemExit("Could not find </head> for premium room styling")
    html = html.replace("</head>", premium_style + "</head>", 1)

path.write_text(html, encoding="utf-8")
print("Applied MigoLive room modal and interaction fixes.")
