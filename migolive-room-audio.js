/* MigoLive room audio client: WebRTC mesh for small rooms.
 * The host UI must call join(roomCode), startMic(), stopMic(), leave().
 * Configure TURN before relying on calls across restrictive mobile networks.
 */
(() => {
  'use strict';
  if (window.MigoRoomAudio) return;
  const API_ORIGIN = 'https://migolive-api-production.up.railway.app';
  const state = { socket: null, roomCode: null, stream: null, peers: new Map(), muted: false, loading: null, uid: null, iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  const listeners = new Map();
  const emit = (name, detail) => {
    window.dispatchEvent(new CustomEvent('migolive:audio:' + name, { detail }));
    (listeners.get(name) || []).forEach(fn => { try { fn(detail); } catch (_) {} });
  };
  const on = (name, fn) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
    return () => listeners.get(name)?.delete(fn);
  };
  function token() { return localStorage.getItem('migolive_token') || ''; }
  function loadSocketClient() {
    if (window.io) return Promise.resolve(window.io);
    if (state.loading) return state.loading;
    state.loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = API_ORIGIN + '/socket.io/socket.io.js';
      script.async = true;
      script.onload = () => window.io ? resolve(window.io) : reject(new Error('تعذر تحميل مكتبة الاتصال الصوتي'));
      script.onerror = () => reject(new Error('فشل تحميل مكتبة الاتصال الصوتي'));
      document.head.appendChild(script);
    });
    return state.loading;
  }
  function socketAck(event, payload) {
    return new Promise((resolve, reject) => {
      if (!state.socket?.connected) return reject(new Error('الاتصال بالغرفة غير متاح'));
      state.socket.timeout(8000).emit(event, payload, (err, result) => {
        if (err) return reject(new Error('انتهت مهلة الاتصال بالخادم'));
        if (!result?.ok) {
          const messages = { MIC_ALREADY_ACTIVE: 'هذا الحساب يستخدم الميكروفون بالفعل من جهاز أو اتصال آخر', SPEAKER_SEAT_REQUIRED: 'يجب أن تصعد إلى مقعد المايك أولاً', NOT_ROOM_MEMBER: 'لم تعد عضواً في هذه الغرفة' };
          return reject(new Error(messages[result?.error] || result?.error || 'رفض الخادم الطلب'));
        }
        resolve(result);
      });
    });
  }
  async function loadIceConfig() {
    try {
      const response = await fetch(API_ORIGIN + '/api/rooms/ice-config', {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token() },
        cache: 'no-store'
      });
      if (!response.ok) throw new Error('تعذر تحميل إعدادات الاتصال الصوتي');
      const data = await response.json();
      if (data?.ok && Array.isArray(data.iceServers) && data.iceServers.length) {
        state.iceServers = data.iceServers;
        if (!data.turnAvailable) emit('network-warning', {
          message: 'الصوت يعمل بإعداد STUN فقط؛ يلزم إعداد TURN لتحسين الاتصال بين شبكات الهاتف المختلفة'
        });
        return;
      }
      throw new Error('إعدادات ICE غير مكتملة');
    } catch (error) {
      state.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
      emit('network-warning', { message: error.message || 'تعذر تحميل TURN، سيتم استخدام STUN فقط' });
    }
  }
  function iceConfig() {
    return { iceServers: state.iceServers };
  }
  function attachAudio(peerId, stream) {
    let el = document.getElementById('migo-audio-' + peerId);
    if (!el) {
      el = document.createElement('audio');
      el.id = 'migo-audio-' + peerId;
      el.autoplay = true;
      el.playsInline = true;
      el.style.display = 'none';
      document.body.appendChild(el);
    }
    el.srcObject = stream;
    const p = el.play();
    if (p?.catch) p.catch(() => emit('playback-blocked', { peerId }));
  }
  function removePeer(peerId) {
    const pc = state.peers.get(peerId);
    if (pc) { try { pc.close(); } catch (_) {} }
    state.peers.delete(peerId);
    document.getElementById('migo-audio-' + peerId)?.remove();
    emit('peer-left', { peerId });
  }
  async function sendSignal(event, peerId, data) {
    await socketAck(event, { to: peerId, ...data });
  }
  async function makePeer(peerId, initiator) {
    if (state.peers.has(peerId)) return state.peers.get(peerId);
    const pc = new RTCPeerConnection(iceConfig());
    state.peers.set(peerId, pc);
    if (state.stream) state.stream.getTracks().forEach(track => pc.addTrack(track, state.stream));
    pc.onicecandidate = e => {
      if (e.candidate) sendSignal('rtc:ice', peerId, { candidate: e.candidate.toJSON() }).catch(err => emit('error', { message: err.message }));
    };
    pc.ontrack = e => { if (e.streams?.[0]) attachAudio(peerId, e.streams[0]); };
    pc.onconnectionstatechange = () => {
      emit('peer-state', { peerId, state: pc.connectionState });
      if (['failed', 'closed'].includes(pc.connectionState)) removePeer(peerId);
    };
    if (initiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendSignal('rtc:offer', peerId, { description: pc.localDescription });
    }
    return pc;
  }
  async function join(roomCode) {
    if (!token()) throw new Error('سجّل الدخول أولاً');
    if (!Number.isSafeInteger(Number(roomCode))) throw new Error('رقم الغرفة غير صحيح');
    await loadIceConfig();
    if (state.roomCode === Number(roomCode) && state.socket?.connected) return { ok: true, roomCode: state.roomCode, alreadyJoined: true };
    if (state.roomCode && state.roomCode !== Number(roomCode)) await leave();
    const io = await loadSocketClient();
    if (!state.socket) {
      state.socket = io(API_ORIGIN, { transports: ['websocket', 'polling'], auth: callback => callback({ token: token() }), reconnection: true });
      state.socket.on('connect_error', e => emit('error', { message: e.message || 'تعذر الاتصال الصوتي' }));
      // A transport reconnect creates a fresh server-side socket with no room membership.
      // Rejoin the persisted room and rebuild peer connections after reconnection.
      state.socket.on('connect', async () => {
        const roomCode = state.roomCode;
        if (!roomCode) return;
        try {
          await loadIceConfig();
          const result = await socketAck('room:join', { roomCode });
          state.uid = Number(result.uid) || state.uid;
          for (const id of [...state.peers.keys()]) removePeer(id);
          for (const peerId of result.peers || []) await makePeer(peerId, true);
          emit('reconnected', { roomCode, peers: result.peers || [], seats: result.seats || [] });
          emit('seats', { seats: result.seats || [] });
        } catch (error) {
          emit('error', { message: 'انقطع الاتصال ولم نتمكن من إعادة دخول الغرفة: ' + error.message });
        }
      });
      state.socket.on('seats:state', p => emit('seats', p));
      state.socket.on('room:peer-joined', async peer => {
        try { await makePeer(peer.socketId, false); emit('peer-joined', peer); }
        catch (e) { emit('error', { message: e.message }); }
      });
      state.socket.on('room:peer-left', p => { if (p.socketId) removePeer(p.socketId); emit('member-left', p); });
      state.socket.on('rtc:offer', async p => {
        try {
          const pc = await makePeer(p.from, false);
          await pc.setRemoteDescription(p.description);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await sendSignal('rtc:answer', p.from, { description: pc.localDescription });
        } catch (e) { emit('error', { message: e.message }); }
      });
      state.socket.on('rtc:answer', async p => {
        try { const pc = state.peers.get(p.from); if (pc) await pc.setRemoteDescription(p.description); }
        catch (e) { emit('error', { message: e.message }); }
      });
      state.socket.on('rtc:ice', async p => {
        try { const pc = state.peers.get(p.from); if (pc && p.candidate) await pc.addIceCandidate(p.candidate); }
        catch (e) { emit('error', { message: e.message }); }
      });
      state.socket.on('host:mute-state', p => {
        if (state.uid && Number(p.uid) === Number(state.uid) && p.muted) stopMic();
        emit('mute-state', p);
      });
      state.socket.on('room:kicked', async p => { await leave(); emit('kicked', p); });
      state.socket.on('room:closed', async p => { await leave(); emit('room-closed', p); });
      state.socket.on('room:host-changed', p => { emit('host-changed', p); });
    }
    if (!state.socket.connected) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(new Error('تعذر الاتصال بخادم الصوت')); }, 12000);
        const cleanup = () => { clearTimeout(timer); state.socket.off('connect', connected); state.socket.off('connect_error', failed); };
        const connected = () => { cleanup(); resolve(); };
        const failed = e => { cleanup(); reject(new Error(e.message || 'فشل الاتصال')); };
        state.socket.once('connect', connected);
        state.socket.once('connect_error', failed);
        state.socket.connect();
      });
    }
    const result = await socketAck('room:join', { roomCode: Number(roomCode) });
    state.uid = Number(result.uid) || null;
    state.roomCode = Number(roomCode);
    for (const peerId of result.peers || []) await makePeer(peerId, true);
    emit('joined', { roomCode: state.roomCode, peers: result.peers || [], seats: result.seats || [] });
    emit('seats', { seats: result.seats || [] });
    return result;
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
  async function startMic() {
    if (!state.roomCode) throw new Error('ادخل الغرفة أولاً');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('الميكروفون غير مدعوم في هذا الجهاز أو السياق');

    // Ask the server to reserve this account's single active mic before opening
    // the device or attaching audio tracks to peer connections.
    const micResult = await socketAck('mic:state', { enabled: true });
    if (micResult.forcedMuted) {
      try { await socketAck('mic:state', { enabled: false }); } catch (_) {}
      throw new Error('مالك الغرفة كتم الميكروفون الخاص بك');
    }
    try {
      if (!state.stream) {
        state.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false
        });
        for (const pc of state.peers.values()) {
          state.stream.getTracks().forEach(track => pc.addTrack(track, state.stream));
        }
        for (const [peerId, pc] of state.peers) {
          if (pc.signalingState === 'stable') {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            await sendSignal('rtc:offer', peerId, { description: pc.localDescription });
          }
        }
      }
      state.muted = false;
      state.stream.getAudioTracks().forEach(track => { track.enabled = true; });
      emit('mic', { enabled: true });
      return true;
    } catch (error) {
      try { await socketAck('mic:state', { enabled: false }); } catch (_) {}
      if (state.stream) state.stream.getAudioTracks().forEach(track => { track.enabled = false; });
      state.muted = true;
      throw error;
    }
  }
  async function stopMic() {
    state.muted = true;
    if (state.stream) {
      state.stream.getAudioTracks().forEach(t => { t.enabled = false; });
    }
    if (state.socket?.connected && state.roomCode) {
      try { await socketAck('mic:state', { enabled: false }); } catch (_) {}
    }
    emit('mic', { enabled: false });
    return true;
  }
  async function leave() {
    await stopMic();
    for (const id of [...state.peers.keys()]) removePeer(id);
    if (state.stream) { state.stream.getTracks().forEach(t => t.stop()); state.stream = null; }
    state.roomCode = null;
    if (state.socket) { state.socket.disconnect(); state.socket = null; }
    emit('left', {});
  }
  window.MigoRoomAudio = Object.freeze({ join, takeSeat, leaveSeat, startMic, stopMic, leave, on, setUid: uid => { state.uid = Number(uid) || null; }, getState: () => ({ roomCode: state.roomCode, connected: !!state.socket?.connected, micEnabled: !!state.stream?.getAudioTracks().some(t => t.enabled), peerCount: state.peers.size }) });
})();