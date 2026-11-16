/* MigoLive room audio: LiveKit SFU media + authenticated Socket.IO room controls.
 * Existing UI API: join, takeSeat, leaveSeat, startMic, stopMic, leave, on, setUid, getState.
 * Never put LiveKit API secrets in this client. Tokens are issued by MigoLive API.
 */
(() => {
  'use strict';
  if (window.MigoRoomAudio) return;
  const API_ORIGIN = 'https://migolive-api-production.up.railway.app';
  const LIVEKIT_SDK = 'https://cdn.jsdelivr.net/npm/livekit-client@2.23.0/dist/livekit-client.umd.min.js';
  const state = {
    socket: null, roomCode: null, uid: null, lkRoom: null,
    micEnabled: false, socketLoading: null, sdkLoading: null, joining: null, leaving: false
  };
  const listeners = new Map();
  function emit(name, detail = {}) {
    window.dispatchEvent(new CustomEvent('migolive:audio:' + name, { detail }));
    (listeners.get(name) || []).forEach(fn => { try { fn(detail); } catch (_) {} });
  }
  function on(name, fn) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
    return () => listeners.get(name)?.delete(fn);
  }
  function token() { return localStorage.getItem('migolive_token') || ''; }
  function loadSocketClient() {
    if (window.io) return Promise.resolve(window.io);
    if (state.socketLoading) return state.socketLoading;
    state.socketLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = API_ORIGIN + '/socket.io/socket.io.js';
      script.async = true;
      script.onload = () => window.io ? resolve(window.io) : reject(new Error('مكتبة اتصال الغرفة غير متاحة'));
      script.onerror = () => reject(new Error('تعذر تحميل مكتبة اتصال الغرفة'));
      document.head.appendChild(script);
    }).catch(e => { state.socketLoading = null; throw e; });
    return state.socketLoading;
  }
  function loadLivekitClient() {
    if (window.LivekitClient?.Room) return Promise.resolve(window.LivekitClient);
    if (state.sdkLoading) return state.sdkLoading;
    state.sdkLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = LIVEKIT_SDK;
      script.async = true;
      script.onload = () => window.LivekitClient?.Room
        ? resolve(window.LivekitClient)
        : reject(new Error('مكتبة LiveKit لم تبدأ'));
      script.onerror = () => reject(new Error('تعذر تحميل مكتبة LiveKit'));
      document.head.appendChild(script);
    }).catch(e => { state.sdkLoading = null; throw e; });
    return state.sdkLoading;
  }
  function socketAck(event, payload) {
    return new Promise((resolve, reject) => {
      if (!state.socket?.connected) return reject(new Error('الاتصال بالغرفة غير متاح'));
      state.socket.timeout(10000).emit(event, payload, (err, result) => {
        if (err) return reject(new Error('انتهت مهلة الاتصال بالخادم'));
        if (!result?.ok) {
          const messages = {
            MIC_ALREADY_ACTIVE: 'هذا الحساب يستخدم الميكروفون بالفعل من اتصال آخر',
            SPEAKER_SEAT_REQUIRED: 'يجب أن تصعد إلى مقعد المايك أولاً',
            NOT_ROOM_MEMBER: 'لم تعد عضواً في الغرفة',
            LIVEKIT_NOT_CONNECTED: 'اتصال LiveKit غير جاهز، حاول دخول الغرفة من جديد'
          };
          return reject(new Error(messages[result?.error] || result?.error || 'رفض الخادم الطلب'));
        }
        resolve(result);
      });
    });
  }
  async function fetchLivekitToken(roomCode) {
    const response = await fetch(API_ORIGIN + '/api/rooms/livekit/' + roomCode + '/token', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token() },
      cache: 'no-store'
    });
    let data = null;
    try { data = await response.json(); } catch (_) {}
    if (!response.ok || !data?.ok || !data.token || !data.serverUrl) {
      throw new Error(data?.message || 'تعذر الحصول على تصريح اتصال LiveKit');
    }
    return data;
  }
  function audioId(identity) {
    return 'migo-livekit-audio-' + String(identity).replace(/[^a-zA-Z0-9_-]/g, '');
  }
  function removeAudio(identity) {
    document.getElementById(audioId(identity))?.remove();
    emit('peer-left', { peerId: identity });
  }
  function attachAudio(track, participant) {
    const id = audioId(participant.identity);
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('audio');
      el.id = id;
      el.autoplay = true;
      el.playsInline = true;
      el.style.display = 'none';
      document.body.appendChild(el);
    }
    track.attach(el);
    const p = el.play();
    if (p?.catch) p.catch(() => emit('playback-blocked', { peerId: participant.identity }));
  }
  async function disconnectLivekit() {
    const room = state.lkRoom;
    state.lkRoom = null;
    state.micEnabled = false;
    if (room) {
      try { await room.disconnect(); } catch (_) {}
    }
    document.querySelectorAll('[id^="migo-livekit-audio-"]').forEach(el => el.remove());
  }
  async function connectLivekit(roomCode) {
    const sdk = await loadLivekitClient();
    const credentials = await fetchLivekitToken(roomCode);
    await disconnectLivekit();
    const room = new sdk.Room({ adaptiveStream: true, dynacast: true });
    state.lkRoom = room;
    room.on(sdk.RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      if (track.kind === sdk.Track.Kind.Audio) attachAudio(track, participant);
    });
    room.on(sdk.RoomEvent.TrackUnsubscribed, (_track, _publication, participant) => removeAudio(participant.identity));
    room.on(sdk.RoomEvent.ParticipantConnected, participant => emit('peer-joined', {
      peerId: participant.identity, uid: Number(participant.identity.replace('migo-user-', '')) || null
    }));
    room.on(sdk.RoomEvent.ParticipantDisconnected, participant => removeAudio(participant.identity));
    room.on(sdk.RoomEvent.Reconnecting, () => emit('network-warning', { message: 'جارٍ إعادة الاتصال بالصوت' }));
    room.on(sdk.RoomEvent.Reconnected, () => emit('reconnected', { roomCode }));
    room.on(sdk.RoomEvent.Disconnected, () => {
      if (!state.leaving && state.roomCode === roomCode) {
        state.micEnabled = false;
        emit('mic', { enabled: false });
        emit('network-warning', { message: 'انقطع اتصال LiveKit بالصوت' });
      }
    });
    try {
      await room.connect(credentials.serverUrl, credentials.token, { autoSubscribe: true });
      // Android WebView may require a user gesture to unlock playback.
      try { await room.startAudio(); } catch (_) { emit('playback-blocked', {}); }
      emit('peer-state', { state: 'connected', peerCount: room.remoteParticipants.size });
    } catch (error) {
      await disconnectLivekit();
      throw error;
    }
  }
  async function ensureSocket() {
    const io = await loadSocketClient();
    if (!state.socket) {
      state.socket = io(API_ORIGIN, {
        transports: ['websocket', 'polling'],
        auth: callback => callback({ token: token() }),
        reconnection: true,
        autoConnect: false
      });
      state.socket.on('connect_error', e => emit('error', { message: e.message || 'تعذر الاتصال بالغرفة' }));
      state.socket.on('connect', async () => {
        const roomCode = state.roomCode;
        if (!roomCode || state.leaving) return;
        try {
          const result = await socketAck('room:join', { roomCode });
          state.uid = Number(result.uid) || state.uid;
          await connectLivekit(roomCode);
          state.micEnabled = false;
          emit('mic', { enabled: false });
          emit('reconnected', { roomCode, seats: result.seats || [] });
          emit('seats', { seats: result.seats || [] });
        } catch (e) {
          emit('error', { message: 'تعذر إعادة دخول غرفة الصوت: ' + e.message });
        }
      });
      state.socket.on('seats:state', p => emit('seats', p));
      state.socket.on('room:peer-joined', p => emit('peer-joined', p));
      state.socket.on('room:peer-left', p => emit('member-left', p));
      state.socket.on('host:mute-state', p => {
        if (state.uid && Number(p.uid) === Number(state.uid) && p.muted) {
          stopMic().catch(e => emit('error', { message: e.message }));
        }
        emit('mute-state', p);
      });
      state.socket.on('room:kicked', async p => { await leave(); emit('kicked', p); });
      state.socket.on('room:closed', async p => { await leave(); emit('room-closed', p); });
      state.socket.on('room:host-changed', p => emit('host-changed', p));
    }
    if (!state.socket.connected) {
      await new Promise((resolve, reject) => {
        const socket = state.socket;
        const timer = setTimeout(() => { cleanup(); reject(new Error('تعذر الاتصال بخادم الغرف')); }, 12000);
        const cleanup = () => {
          clearTimeout(timer);
          socket.off('connect', connected);
          socket.off('connect_error', failed);
        };
        const connected = () => { cleanup(); resolve(); };
        const failed = e => { cleanup(); reject(new Error(e.message || 'فشل الاتصال')); };
        socket.once('connect', connected);
        socket.once('connect_error', failed);
        socket.connect();
      });
    }
  }
  async function join(roomCode) {
    if (state.joining) return state.joining;
    state.joining = (async () => {
      if (!token()) throw new Error('سجّل الدخول أولاً');
      const code = Number(roomCode);
      if (!Number.isSafeInteger(code) || code < 1) throw new Error('رقم الغرفة غير صحيح');
      if (state.roomCode === code && state.socket?.connected && state.lkRoom?.state === 'connected') {
        return { ok: true, roomCode: code, alreadyJoined: true };
      }
      if (state.roomCode) await leave();
      await ensureSocket();
      const result = await socketAck('room:join', { roomCode: code });
      state.uid = Number(result.uid) || null;
      state.roomCode = code;
      try { await connectLivekit(code); }
      catch (e) { await leave(); throw e; }
      emit('joined', { roomCode: code, peers: result.peers || [], seats: result.seats || [] });
      emit('seats', { seats: result.seats || [] });
      return result;
    })();
    try { return await state.joining; }
    finally { state.joining = null; }
  }
  async function takeSeat(seat) {
    if (!state.roomCode) throw new Error('ادخل الغرفة أولاً');
    return socketAck('seat:take', { seat: Number(seat) });
  }
  async function leaveSeat() {
    if (!state.roomCode) throw new Error('ادخل الغرفة أولاً');
    await stopMic();
    return socketAck('seat:leave', {});
  }
  async function waitPublishPermission() {
    const room = state.lkRoom;
    for (let i = 0; i < 30; i++) {
      if (room !== state.lkRoom || !room) throw new Error('انقطع اتصال LiveKit');
      if (room.localParticipant.permissions?.canPublish) return;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error('لم تصل صلاحية المايك من LiveKit بعد');
  }
  async function startMic() {
    if (!state.roomCode || !state.lkRoom || state.lkRoom.state !== 'connected') {
      throw new Error('ادخل غرفة الصوت أولاً');
    }
    if (state.micEnabled) return true;
    const result = await socketAck('mic:state', { enabled: true, transport: 'livekit' });
    if (result.forcedMuted) {
      await socketAck('mic:state', { enabled: false, transport: 'livekit' }).catch(() => {});
      throw new Error('مالك الغرفة كتم الميكروفون الخاص بك');
    }
    try {
      await waitPublishPermission();
      await state.lkRoom.localParticipant.setMicrophoneEnabled(true, {
        echoCancellation: true, noiseSuppression: true, autoGainControl: true
      });
      state.micEnabled = true;
      emit('mic', { enabled: true });
      return true;
    } catch (error) {
      try { await state.lkRoom?.localParticipant.setMicrophoneEnabled(false); } catch (_) {}
      await socketAck('mic:state', { enabled: false, transport: 'livekit' }).catch(() => {});
      state.micEnabled = false;
      emit('mic', { enabled: false });
      throw error;
    }
  }
  async function stopMic() {
    state.micEnabled = false;
    try { await state.lkRoom?.localParticipant.setMicrophoneEnabled(false); } catch (_) {}
    if (state.socket?.connected && state.roomCode) {
      try { await socketAck('mic:state', { enabled: false, transport: 'livekit' }); } catch (_) {}
    }
    emit('mic', { enabled: false });
    return true;
  }
  async function leave() {
    state.leaving = true;
    try {
      await stopMic();
      state.roomCode = null;
      await disconnectLivekit();
      if (state.socket) { state.socket.disconnect(); state.socket = null; }
      emit('left', {});
    } finally { state.leaving = false; }
  }
  window.MigoRoomAudio = Object.freeze({
    join, takeSeat, leaveSeat, startMic, stopMic, leave, on,
    setUid: uid => { state.uid = Number(uid) || null; },
    getState: () => ({
      roomCode: state.roomCode,
      connected: !!state.socket?.connected && state.lkRoom?.state === 'connected',
      micEnabled: state.micEnabled,
      peerCount: state.lkRoom?.remoteParticipants.size || 0
    })
  });
})();
