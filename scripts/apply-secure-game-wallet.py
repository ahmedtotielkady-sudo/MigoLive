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
if count != 1:
    raise SystemExit(f"Expected exactly one unsafe wallet bridge, found {count}")
html = html.replace(old, new, 1)
path.write_text(html, encoding="utf-8")
print("Disabled client-side game wallet mutations; server settlement required")
