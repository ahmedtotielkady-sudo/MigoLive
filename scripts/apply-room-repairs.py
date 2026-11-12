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

path.write_text(html, encoding="utf-8")
print("Applied MigoLive room modal and interaction fixes.")
