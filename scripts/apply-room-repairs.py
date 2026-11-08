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

path.write_text(html, encoding="utf-8")
print("Applied MigoLive room modal and interaction fixes.")
