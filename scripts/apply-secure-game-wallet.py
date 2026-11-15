#!/usr/bin/env python3
"""Prevent untrusted game iframes from editing the app's local wallet."""
from pathlib import Path

path = Path("index.html")
html = path.read_text(encoding="utf-8")
old = '''   }else if(d.t==="set"&&Number.isFinite(d.v)&&d.v>=0){
    const u=typeof U==="function"?U():null;
    if(!u)return;
    u.coins=Math.floor(d.v);
    if(typeof save==="function")save();
    const coinNode=document.querySelector("#mycoins");
    if(coinNode)coinNode.textContent=u.coins;
    window.dispatchEvent(new CustomEvent("migo:wallet-updated",{detail:{coins:u.coins}}));
   }else if(d.t==="wallet"){'''
new = '''   }else if(d.t==="set"){
    // Game iframe balances are untrusted. Never accept a client-calculated
    // balance; only a verified server-side settlement may change wallet coins.
    const profile=typeof window.__migoGetGameProfile==="function"?window.__migoGetGameProfile():{coins:0};
    e.source.postMessage({t:"bal",v:Number(profile.coins)||0},"*");
   }else if(d.t==="wallet"){'''
count = html.count(old)
if count == 1:
    html = html.replace(old, new, 1)
elif count == 0 and new in html:
    print("App wallet bridge is already hardened")
else:
    raise SystemExit(f"Expected one unsafe or one hardened app wallet bridge, found unsafe={count}")

# The in-room launcher injects a separate iframe bridge after this script runs.
# Harden that bridge at its source too, so no game can write a client-supplied
# balance through the room overlay path.
launcher_path = Path("scripts/apply-game-room-launcher.py")
launcher = launcher_path.read_text(encoding="utf-8")
launcher_old = '''   }else if(d.t==="set"&&Number.isFinite(d.v)&&d.v>=0){
    const u=typeof U==="function"?U():null;
    if(!u)return;
    u.coins=Math.floor(d.v);
    if(typeof save==="function")save();
    const coinNode=document.querySelector("#mycoins");
    if(coinNode)coinNode.textContent=u.coins;
    window.dispatchEvent(new CustomEvent("migo:wallet-updated",{detail:{coins:u.coins}}));
   }else if(d.t==="wallet"){'''
launcher_new = '''   }else if(d.t==="set"){
    // The game iframe cannot authoritatively set a wallet balance.
    const profile=typeof window.__migoGetGameProfile==="function"?window.__migoGetGameProfile():{coins:0};
    e.source.postMessage({t:"bal",v:Number(profile.coins)||0},"*");
   }else if(d.t==="wallet"){'''
launcher_count = launcher.count(launcher_old)
if launcher_count == 1:
    launcher = launcher.replace(launcher_old, launcher_new, 1)
elif launcher_count == 0 and launcher_new in launcher:
    print("Room-game wallet bridge is already hardened")
else:
    raise SystemExit(f"Expected one unsafe or one hardened room-game wallet bridge, found unsafe={launcher_count}")
launcher_path.write_text(launcher, encoding="utf-8")

path.write_text(html, encoding="utf-8")
print("Disabled client-side wallet writes in both app and in-room game bridges")
