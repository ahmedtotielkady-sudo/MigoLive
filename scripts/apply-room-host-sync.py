#!/usr/bin/env python3
"""Keep the room UI's owner identity synchronized with server-side host promotion."""
from pathlib import Path

path = Path("index.html")
html = path.read_text(encoding="utf-8")
anchor = """  window.MigoRoomAudio.on('seats', payload=>{
    const active=room;
    if(!active||!active.serverRoom)return;
    applyServerSeatSnapshot(active,payload?.seats||[]);
  });
}"""
addition = anchor + """
if(!window.__migoHostChangedListenerBound&&window.MigoRoomAudio){
  window.__migoHostChangedListenerBound=true;
  window.MigoRoomAudio.on('host-changed', payload=>{
    const active=room;
    const uid=Number(payload?.ownerUid);
    if(!active||!active.serverRoom||!Number.isSafeInteger(uid))return;
    let key=Object.keys(DB.users).find(k=>Number(DB.users[k]?.uid)===uid);
    if(!key){
      key='server-uid-'+uid;
      DB.users[key]={uid,name:'مستخدم '+uid,displayName:'مستخدم '+uid,role:'user',coins:0,serverShadow:true};
    }
    active.owner=key;
    active.ownerUid=uid;
    if(uid===Number(U()?.uid))active.owner=me;
    save();
    if(room===active)render();
  });
}"""
count = html.count(anchor)
if count != 1:
    raise SystemExit(f"Expected exactly one room seat listener anchor, found {count}")
if "__migoHostChangedListenerBound" in html:
    raise SystemExit("Host-change listener already exists; refusing duplicate injection")
path.write_text(html.replace(anchor, addition, 1), encoding="utf-8")
print("Added server host-change UI synchronization")
