/* MigoLive real-time room audio bridge.
 * Socket.IO controls room membership, seats and microphone leases.
 * LiveKit transports audio media; it never trusts local UI state for publish rights.
 */
(() => {
  "use strict";

  const origin = API_BASE.replace(/\/api\/?$/, "");
  let socketLoader;
  let voiceSession = null;
  let connectingRoom = null;
  const migrationPromises = new Map();

  function currentToken() {
    try { return localStorage.getItem("migolive_token") || ""; } catch (_) { return ""; }
  }

  function loadSocketClient() {
    if (window.io) return Promise.resolve();
    if (socketLoader) return socketLoader;
    socketLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = origin + "/socket.io/socket.io.js";
      script.async = true;
      script.onload = () => window.io ? resolve() : reject(new Error("تعذر تحميل اتصال الغرف"));
      script.onerror = () => reject(new Error("تعذر تحميل اتصال الغرف"));
      document.head.appendChild(script);
    });
    return socketLoader;
  }

  function emitAck(socket, event, payload) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("انتهت مهلة استجابة الغرفة")), 10000);
      socket.emit(event, payload || {}, response => {
        clearTimeout(timer);
        if (!response || response.ok !== true) {
          const errors = {
            NOT_ROOM_MEMBER: "يجب الانضمام إلى الغرفة أولاً",
            SPEAKER_SEAT_REQUIRED: "اجلس على مقعد متحدث قبل فتح المايك",
            MIC_ALREADY_ACTIVE: "الميكروفون مستخدم من اتصال آخر",
            SEAT_OCCUPIED: "المقعد مشغول بالفعل",
            SEATS_FULL: "لا توجد مقاعد متاحة",
            FORBIDDEN: "ليست لديك صلاحية تنفيذ هذا الإجراء",
            LIVEKIT_NOT_CONNECTED: "تعذر تفعيل اتصال الصوت"
          };
          return reject(new Error(errors[response && response.error] || "تعذر تنفيذ العملية"));
        }
        resolve(response);
      });
    });
  }

  function localKeyForUid(uid, displayName) {
    const n = Number(uid);
    let key = Object.keys(DB.users || {}).find(k => Number(DB.users[k] && DB.users[k].uid) === n);
    if (key) return key;
    key = "remote-" + String(n);
    if (!DB.users[key]) {
      DB.users[key] = {
        name: String(displayName || ("مستخدم " + n)),
        uid: n, role: "user", coins: 0, avatar: "", friends: [], blocked: []
      };
    }
    return key;
  }

  function syncSeats(snapshot) {
    if (!room || !Array.isArray(snapshot)) return;
    const count = Array.isArray(room.seats) ? room.seats.length : 24;
    const next = Array(count).fill(null);
    for (const item of snapshot) {
      const index = Number(item && item.seat) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= count) continue;
      next[index] = localKeyForUid(item.uid);
    }
    room.seats = next;
    save();
    if (typeof renderRoom === "function") renderRoom(document.querySelector("#room-float-panel"));
  }

  function voiceBadge() {
    let badge = document.getElementById("migo-voice-status");
    const host = document.querySelector(".room-title-card");
    if (!host) return null;
    if (!badge) {
      badge = document.createElement("small");
      badge.id = "migo-voice-status";
      badge.style.cssText = "display:block;font-size:9px;color:#ffd36a;line-height:1.2;margin-top:2px";
      host.appendChild(badge);
    }
    return badge;
  }

  function setVoiceStatus(message, good) {
    const badge = voiceBadge();
    if (badge) {
      badge.textContent = message;
      badge.style.color = good ? "#a3e635" : "#ffc24a";
    }
  }

  function attachRemoteAudio(track, participant) {
    if (!track || !window.LivekitClient || track.kind !== window.LivekitClient.Track.Kind.Audio) return;
    const root = document.getElementById("migo-live-audio") || (() => {
      const el = document.createElement("div");
      el.id = "migo-live-audio";
      el.style.cssText = "position:fixed;width:1px;height:1px;overflow:hidden;opacity:.01;pointer-events:none;left:-10px;bottom:-10px";
      document.body.appendChild(el);
      return el;
    })();
    const audio = track.attach();
    audio.autoplay = true;
    audio.playsInline = true;
    audio.dataset.participant = participant && participant.identity || "";
    root.appendChild(audio);
    const play = audio.play();
    if (play && typeof play.catch === "function") play.catch(() => {
      setVoiceStatus("اضغط داخل الغرفة لتفعيل صوت المستمعين", false);
    });
  }

  async function connectVoiceRoom(targetRoom) {
    if (!targetRoom || !currentToken()) return;
    const roomCode = Number(targetRoom.id);
    if (!Number.isSafeInteger(roomCode)) throw new Error("رقم الغرفة غير صحيح");
    if (voiceSession && voiceSession.roomCode === roomCode && voiceSession.socket.connected) return;
    if (connectingRoom === roomCode) return;
    connectingRoom = roomCode;
    let pendingSocket = null;
    try {
      if (voiceSession) await disconnectVoiceRoom(true);
      setVoiceStatus("جارٍ الاتصال بالصوت...", false);
      // Membership is established by the room-list click handler or room creation.
      // Do not join again here: private rooms would be prompted for a password twice.
      await loadSocketClient();
      const socket = window.io(origin, {
        auth: { token: currentToken() },
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: 8,
        timeout: 12000
      });
      pendingSocket = socket;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("تعذر الاتصال بخادم الغرف")), 15000);
        socket.once("connect", () => { clearTimeout(timer); resolve(); });
        socket.once("connect_error", error => { clearTimeout(timer); reject(error); });
      });
      const joined = await emitAck(socket, "room:join", { roomCode });
      voiceSession = { roomCode, socket, liveRoom: null, closing: false };
      syncSeats(joined.seats || []);
      socket.on("seats:state", data => syncSeats(data && data.seats));
      socket.on("room:peer-joined", data => {
        if (!room || !data || !data.uid) return;
        const key = localKeyForUid(data.uid, data.displayName);
        if (!room.online.includes(key)) room.online.push(key);
        renderRoom(document.querySelector("#room-float-panel"));
      });
      socket.on("room:peer-left", data => {
        if (!room || !data || !data.uid) return;
        const key = localKeyForUid(data.uid);
        room.online = (room.online || []).filter(x => x !== key);
        renderRoom(document.querySelector("#room-float-panel"));
      });
      socket.on("mic:state", data => {
        if (!room || !data) return;
        const key = localKeyForUid(data.uid);
        room.talkingUsers = room.talkingUsers || [];
        room.talkingUsers = data.enabled
          ? [...new Set(room.talkingUsers.concat(key))]
          : room.talkingUsers.filter(x => x !== key);
        if (key === me) talk = data.enabled === true;
        if (room.owner === key) {
          room.hostTalk = data.enabled === true;
          room.hostUser = data.enabled ? key : null;
        }
        renderRoom(document.querySelector("#room-float-panel"));
      });
      socket.on("host:mute-state", data => {
        if (!room || !data) return;
        const key = localKeyForUid(data.uid);
        room.muted = room.muted || [];
        room.muted = data.muted
          ? [...new Set(room.muted.concat(key))]
          : room.muted.filter(x => x !== key);
        if (key === me && data.muted) setLocalMicrophone(false).catch(() => {});
        renderRoom(document.querySelector("#room-float-panel"));
      });
      socket.on("room:host-changed", data => {
        if (!room || !data) return;
        room.owner = localKeyForUid(data.ownerUid);
        renderRoom(document.querySelector("#room-float-panel"));
      });
      socket.on("room:kicked", data => {
        if (!room || Number(data && data.roomCode) !== roomCode) return;
        toast("تم إخراجك من الغرفة");
        const oldLeave = originalLeaveRoom;
        disconnectVoiceRoom(true).finally(() => {
          if (typeof oldLeave === "function") oldLeave(true);
          if (typeof render === "function") render();
        });
      });
      socket.on("disconnect", () => {
        if (voiceSession && voiceSession.roomCode === roomCode) {
          setVoiceStatus("انقطع اتصال الغرفة — جارٍ إعادة الاتصال", false);
          setLocalMicrophone(false).catch(() => {});
        }
      });
      socket.on("connect", () => {
        if (!voiceSession || voiceSession.roomCode !== roomCode) return;
        socket.emit("room:join", { roomCode }, response => {
          if (response && response.ok) syncSeats(response.seats || []);
        });
      });

      if (!window.LivekitClient || !window.LivekitClient.Room) {
        setVoiceStatus("مكتبة الصوت غير متاحة", false);
        throw new Error("تعذر تحميل مكتبة الصوت المباشر");
      }
      const tokenData = await apiRequest("/rooms/livekit/" + roomCode + "/token", { method: "POST" });
      const lk = new window.LivekitClient.Room({ adaptiveStream: true, dynacast: true });
      const events = window.LivekitClient.RoomEvent;
      lk.on(events.TrackSubscribed, (track, _publication, participant) => attachRemoteAudio(track, participant));
      lk.on(events.TrackUnsubscribed, track => track.detach().forEach(el => el.remove()));
      lk.on(events.Disconnected, () => {
        if (voiceSession && voiceSession.roomCode === roomCode) setVoiceStatus("الصوت غير متصل", false);
      });
      await lk.connect(tokenData.serverUrl, tokenData.token);
      if (voiceSession && voiceSession.roomCode === roomCode) voiceSession.liveRoom = lk;
      setVoiceStatus("الصوت المباشر متصل", true);
    } catch (error) {
      setVoiceStatus("الصوت غير متاح", false);
      toast(error.message || "تعذر الاتصال بالصوت الحقيقي");
      if (voiceSession && voiceSession.roomCode === roomCode && !voiceSession.liveRoom) {
        try { voiceSession.socket.disconnect(); } catch (_) {}
        voiceSession = null;
      } else if (pendingSocket && (!voiceSession || voiceSession.roomCode !== roomCode)) {
        try { pendingSocket.disconnect(); } catch (_) {}
      }
    } finally {
      connectingRoom = null;
    }
  }

  async function setLocalMicrophone(enabled) {
    const session = voiceSession;
    if (!session || !session.liveRoom) throw new Error("اتصال الصوت لم يكتمل بعد");
    if (!enabled) {
      try { await session.liveRoom.localParticipant.setMicrophoneEnabled(false); } catch (_) {}
    }
    const response = await emitAck(session.socket, "mic:state", { enabled: enabled === true, transport: "livekit" });
    if (enabled && response.enabled !== true) throw new Error("المايك مكتوم أو لا تملك مقعد متحدث صالحًا");
    if (enabled) {
      try {
        await session.liveRoom.localParticipant.setMicrophoneEnabled(true);
      } catch (error) {
        try { await emitAck(session.socket, "mic:state", { enabled: false, transport: "livekit" }); } catch (_) {}
        throw new Error("تعذر تشغيل الميكروفون. تحقق من إذن المايك في الهاتف");
      }
    }
    talk = enabled === true;
    if (room) {
      if (room.owner === me) {
        room.hostTalk = talk;
        room.hostUser = talk ? me : null;
      }
      room.talkingUsers = room.talkingUsers || [];
      room.talkingUsers = talk
        ? [...new Set(room.talkingUsers.concat(me))]
        : room.talkingUsers.filter(x => x !== me);
    }
    renderRoom(document.querySelector("#room-float-panel"));
    return response;
  }

  async function disconnectVoiceRoom(skipApiLeave) {
    const session = voiceSession;
    if (!session || session.closing) return;
    session.closing = true;
    voiceSession = null;
    try {
      if (session.liveRoom) {
        try { await session.liveRoom.localParticipant.setMicrophoneEnabled(false); } catch (_) {}
        try { await session.liveRoom.disconnect(); } catch (_) {}
      }
      if (session.socket) {
        if (!skipApiLeave) {
          try { await emitAck(session.socket, "seat:leave", {}); } catch (_) {}
        }
        session.socket.disconnect();
      }
      if (!skipApiLeave) {
        try {
          const result = await apiRequest("/rooms/" + session.roomCode + "/leave", { method: "POST", body: JSON.stringify({}) });
          if (room && result.ownerUid) room.owner = localKeyForUid(result.ownerUid);
        } catch (_) {}
      }
    } finally {
      const audio = document.getElementById("migo-live-audio");
      if (audio) audio.replaceChildren();
      talk = false;
    }
  }

  async function migrateLocalRoom(localRoom) {
    const oldId = Number(localRoom.id);
    if (migrationPromises.has(oldId)) return migrationPromises.get(oldId);
    const task = (async () => {
      const created = await apiRequest("/rooms", {
        method: "POST",
        body: JSON.stringify({ name: localRoom.name, description: "", isPrivate: false, capacity: 24 })
      });
      const newId = Number(created.room && created.room.id);
      if (!Number.isSafeInteger(newId)) throw new Error("تعذر إنشاء الغرفة أونلاين");
      localRoom.id = newId;
      localRoom.serverManaged = true;
      localRoom.members = [me];
      localRoom.seats = Array(SEATMAX).fill(null);
      localRoom.online = [me];
      save();
      try { history.replaceState(null, "", "#room-" + newId); } catch (_) {}
      return localRoom;
    })();
    migrationPromises.set(oldId, task);
    try { return await task; }
    finally { migrationPromises.delete(oldId); }
  }

  async function refreshRemoteRooms(container) {
    if (!currentToken()) return;
    try {
      const data = await apiRequest("/rooms");
      const remoteIds = new Set();
      for (const remote of data.rooms || []) {
        const id = Number(remote.id);
        if (!Number.isSafeInteger(id)) continue;
        remoteIds.add(id);
        const ownerKey = localKeyForUid(remote.ownerUid, "مضيف الغرفة");
        let local = DB.rooms.find(x => Number(x.id) === id);
        if (!local) {
          local = normRoom({
            id, name: remote.name, owner: ownerKey,
            seats: Array(SEATMAX).fill(null), members: [], online: [],
            admins: [], hosts: [], muted: [], smute: [], lock: [],
            chat: [], serverManaged: true
          });
          DB.rooms.push(local);
        }
        local.name = remote.name;
        local.owner = ownerKey;
        local.serverManaged = true;
        local.membersCount = remote.membersCount;
        local.serverMember = remote.isMember === true;
        local.pass = remote.isPrivate ? true : false;
        if (local.seats.length !== SEATMAX) local.seats = Array(SEATMAX).fill(null);
      }
      save();
      if (container && container.isConnected && tab === "rooms" && !room) originalRRooms(container);
    } catch (_) { /* Preserve cached rooms when the API is temporarily offline. */ }
  }

  function wrapRoomList() {
    const originalRRooms = rRooms;
    const originalBindRooms = bindRooms;
    window.__migoOriginalRRooms = originalRRooms;
    rRooms = function (container) {
      originalRRooms(container);
      refreshRemoteRooms(container);
      const create = document.getElementById("mk");
      if (create) create.onclick = async () => {
        const name = document.getElementById("nr").value.trim();
        if (!name) return toast("اكتب اسم الغرفة");
        create.disabled = true;
        try {
          const result = await apiRequest("/rooms", {
            method: "POST",
            body: JSON.stringify({ name, description: "", isPrivate: false, capacity: 24 })
          });
          const id = Number(result.room && result.room.id);
          const createdRoom = normRoom({
            id, name, owner: me, seats: Array(SEATMAX).fill(null),
            members: [me], online: [me], chat: [], serverManaged: true, serverMember: true
          });
          DB.rooms = DB.rooms.filter(x => Number(x.id) !== id);
          DB.rooms.unshift(createdRoom);
          save();
          nav("room-" + id);
        } catch (error) { toast(error.message || "تعذر إنشاء الغرفة"); }
        finally { create.disabled = false; }
      };
    };
    bindRooms = function () {
      originalBindRooms();
      document.querySelectorAll("[data-r]").forEach(card => {
        card.onclick = async event => {
          if (event.target && event.target.dataset && event.target.dataset.fav) return;
          const id = Number(card.dataset.r);
          const target = DB.rooms.find(x => Number(x.id) === id);
          if (!target) return;
          if (!target.serverManaged) {
            if (target.owner === me) {
              try { await migrateLocalRoom(target); }
              catch (error) { toast(error.message || "تعذر تحويل الغرفة إلى غرفة أونلاين"); return; }
            } else {
              toast("الغرفة القديمة محفوظة محليًا؛ اطلب من مالكها إنشاء غرفة أونلاين جديدة");
              return;
            }
          }
          let password = target.pass && typeof target.pass === "string" ? target.pass : "";
          if (target.pass === true) {
            password = window.prompt("أدخل كلمة مرور الغرفة") || "";
            if (!password) return;
          }
          try {
            if (!target.serverMember) {
              await apiRequest("/rooms/" + id + "/join", {
                method: "POST",
                body: JSON.stringify({ password })
              });
              target.serverMember = true;
            }
            nav("room-" + id);
          } catch (error) { toast(error.message || "تعذر الانضمام إلى الغرفة"); }
        };
      });
    };
  }

  const originalLeaveRoom = leaveRoom;
  window.__migoOriginalLeaveRoom = originalLeaveRoom;
  leaveRoom = function (silent) {
    disconnectVoiceRoom(false);
    return originalLeaveRoom(silent);
  };

  const originalRoomEnter = roomEnter;
  roomEnter = function (targetRoom) {
    originalRoomEnter(targetRoom);
    if (!targetRoom) return;
    if (!targetRoom.serverManaged && targetRoom.owner === me) {
      migrateLocalRoom(targetRoom)
        .then(migrated => connectVoiceRoom(migrated))
        .catch(error => { setVoiceStatus("الغرفة غير متصلة", false); toast(error.message || "تعذر إنشاء غرفة أونلاين"); });
    } else if (targetRoom.serverManaged) {
      connectVoiceRoom(targetRoom);
    } else {
      setVoiceStatus("غرفة محلية — الصوت غير متصل", false);
    }
  };

  const originalRenderRoom = renderRoom;
  renderRoom = function (container) {
    originalRenderRoom(container);
    if (!container || !container.isConnected) return;
    const badge = voiceBadge();
    if (badge && voiceSession && voiceSession.liveRoom) setVoiceStatus("الصوت المباشر متصل", true);
    const mic = container.querySelector("#mic");
    if (mic) mic.onclick = async () => {
      if (!voiceSession || !voiceSession.liveRoom) return toast("انتظر اتصال الصوت أولاً");
      if (!room || (!room.seats.includes(me) && room.owner !== me)) return toast("اجلس على مقعد متحدث أولاً");
      const muted = room.muted || [];
      if (muted.includes(me)) return toast("تم كتمك من مالك الغرفة");
      try { await setLocalMicrophone(!talk); }
      catch (error) { toast(error.message || "تعذر تشغيل الميكروفون"); }
    };
    const host = container.querySelector("#hostMic");
    if (host) host.onclick = async () => {
      if (!room || room.owner !== me) return toast("مايك المضيف مخصص لمالك الغرفة");
      if (!voiceSession || !voiceSession.liveRoom) return toast("انتظر اتصال الصوت أولاً");
      try { await setLocalMicrophone(!talk); }
      catch (error) { toast(error.message || "تعذر تشغيل مايك المضيف"); }
    };
    container.querySelectorAll("[data-s]").forEach(button => {
      button.onclick = async () => {
        if (!voiceSession) return toast("اتصال الغرفة غير جاهز");
        const index = Number(button.dataset.s);
        const occupied = room && room.seats[index];
        try {
          if (occupied === me) {
            await emitAck(voiceSession.socket, "seat:leave", {});
            if (talk) await setLocalMicrophone(false);
          } else if (!occupied) {
            await emitAck(voiceSession.socket, "seat:take", { seat: index + 1 });
          } else {
            toast("المقعد مشغول");
          }
        } catch (error) { toast(error.message || "تعذر تحديث المقعد"); }
      };
    });
    container.querySelectorAll("[data-s]").forEach(button => {
      const index = Number(button.dataset.s);
      const key = room && room.seats[index];
      button.classList.toggle("talk", !!(key && room.talkingUsers && room.talkingUsers.includes(key)));
    });
    const hostButton = container.querySelector("#hostMic");
    if (hostButton) hostButton.classList.toggle("talking", !!(room && room.hostTalk));
    container.querySelectorAll("[data-a]").forEach(button => {
      const action = button.dataset.a;
      if (action !== "mute" && action !== "kick" && action !== "ban" && action !== "kicklock") return;
      button.onclick = async () => {
        const targetKey = room && room.seats[Number(sel)];
        const target = targetKey && DB.users[targetKey];
        if (!target || !voiceSession) return toast("اتصال الغرفة غير جاهز");
        try {
          if (action === "mute") {
            await emitAck(voiceSession.socket, "host:mute", {
              uid: target.uid, muted: !(room.muted || []).includes(targetKey)
            });
          } else {
            await emitAck(voiceSession.socket, "host:kick", { uid: target.uid });
            if (action === "kicklock") room.lock.push(Number(sel));
          }
          sel = null;
          renderRoom(container);
        } catch (error) { toast(error.message || "تعذر تنفيذ أمر الغرفة"); }
      };
    });
  };

  wrapRoomList();
  window.migoVoiceRoom = {
    connect: connectVoiceRoom,
    disconnect: disconnectVoiceRoom,
    setMicrophoneEnabled: setLocalMicrophone
  };
})();
