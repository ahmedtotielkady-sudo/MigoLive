#!/usr/bin/env python3
"""Harden game wallet messaging and install the server game request client."""
from pathlib import Path
import json

index = Path("www/index.html")
html = index.read_text(encoding="utf-8")

unsafe = """else if(d.t==='set'&&Number.isFinite(d.v)&&d.v>=0&&d.v<=Number.MAX_SAFE_INTEGER){const next=Math.floor(d.v);if(Number.isSafeInteger(next)){U().coins=next;save();$('#mycoins').textContent=next;}}else if(d.t==='wallet')"""
safe = """else if(d.t==='set'){e.source.postMessage({t:'bal',v:Number(U().coins)||0},'*');}else if(d.t==='wallet')"""
if unsafe in html:
    html = html.replace(unsafe, safe, 1)
elif "U().coins=next;save();" in html:
    raise SystemExit("Found an unrecognized app wallet setter")

unsafe_room = """}else if(d.t==="set"&&Number.isFinite(d.v)&&d.v>=0){
    const u=typeof U==="function"?U():null;
    if(!u)return;
    u.coins=Math.floor(d.v);
    if(typeof save==="function")save();
    const coinNode=document.querySelector("#mycoins");
    if(coinNode)coinNode.textContent=u.coins;
    window.dispatchEvent(new CustomEvent("migo:wallet-updated",{detail:{coins:u.coins}}));
   }else if(d.t==="wallet"){"""
safe_room = """}else if(d.t==="set"){
    const profile=typeof window.__migoGetGameProfile==="function"?window.__migoGetGameProfile():{coins:0};
    e.source.postMessage({t:"bal",v:Number(profile.coins)||0},"*");
   }else if(d.t==="wallet"){"""
if unsafe_room in html:
    html = html.replace(unsafe_room, safe_room, 1)
elif "u.coins=Math.floor(d.v);" in html:
    raise SystemExit("Found an unrecognized room game wallet setter")

helper = r"""<script id="migo-server-game-client-v1">
(()=>{if(window.migoServerGame)return;
 const pending=new Map();
 let retry=null;
 function key(){if(!window.crypto||!crypto.getRandomValues)throw new Error('تعذر تأمين الجولة');const b=new Uint8Array(20);crypto.getRandomValues(b);return 'migo-'+Array.from(b,x=>x.toString(16).padStart(2,'0')).join('')}
 function signature(gameId,action,payload){return String(gameId)+':'+String(action)+':'+JSON.stringify(payload||{})}
 addEventListener('message',e=>{const d=e.data;if(!d||d.t!=='migo:game:response'||typeof d.requestId!=='string')return;const p=pending.get(d.requestId);if(!p)return;pending.delete(d.requestId);clearTimeout(p.timer);if(retry&&retry.requestId===d.requestId)retry=null;if(d.ok)p.resolve(d.result);else p.reject(new Error(d.message||'تعذر تنفيذ الجولة على الخادم'))});
 window.migoServerGame={request(gameId,action,payload){const body=payload||{};const sig=signature(gameId,action,body);if(retry&&retry.signature!==sig)return Promise.reject(new Error('هناك جولة لم يصل تأكيدها بعد؛ أعد المحاولة بنفس الرهان والاختيارات أولاً'));const requestId=retry?retry.requestId:key();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(requestId);retry={signature:sig,requestId};reject(new Error('لم يصل تأكيد الخادم؛ أعد المحاولة بنفس الرهان والاختيارات لتجنب تكرار الخصم'))},20000);pending.set(requestId,{resolve,reject,timer});try{parent.postMessage({t:'migo:game:request',requestId,gameId,action,payload:body},'*')}catch(err){clearTimeout(timer);pending.delete(requestId);retry={signature:sig,requestId};reject(err)}})}};
})();
</script>"""

if "migo-server-game-client-v1" not in html:
    srcdoc = "$('#gf').srcdoc=offlineGameHtml;"
    if srcdoc not in html:
        raise SystemExit("Could not find app game srcdoc assignment")
    inject = "const migoServerGameBridge=" + json.dumps(helper + "</body>").replace("</script>", "<\\/script>") + ";\n  const bridgedGameHtml=offlineGameHtml.replace(/<\\/body>/i,migoServerGameBridge);\n  $('#gf').srcdoc=bridgedGameHtml;"
    html = html.replace(srcdoc, inject, 1)

index.write_text(html, encoding="utf-8")

files = [
    Path("www/slot-777.html"), Path("www/slot-ocean-storm.html"),
    Path("www/wheel-animals.html"), Path("www/games/fruit-luck.html"),
    Path("www/games/cleopatra-gold.html"), Path("www/games/big-warrior.html"),
    Path("www/games/rocket-crash.html")
]
for path in files:
    if not path.is_file() or path.stat().st_size < 1000:
        raise SystemExit(f"Missing or incomplete game asset: {path}")
    source = path.read_text(encoding="utf-8")
    if "migo-server-game-client-v1" not in source:
        if "</body>" not in source:
            raise SystemExit(f"Missing </body> in {path}")
        source = source.replace("</body>", helper + "\n</body>", 1)
        path.write_text(source, encoding="utf-8")

print("Hardened app and room wallet bridges; installed server game client in all seven game assets")
