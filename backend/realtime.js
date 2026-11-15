const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Room = require("./models/Room");
const User = require("./models/User");
const MicLease = require("./models/MicLease");

function attachRealtime(httpServer, allowedOrigins) {
  const io = new Server(httpServer, {
    cors: {
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error("Origin is not allowed by CORS"));
      },
      methods: ["GET", "POST"]
    },
    transports: ["websocket", "polling"],
    pingInterval: 25000,
    pingTimeout: 20000
  });

  io.use((socket, next) => {
    try {
      const token = String(socket.handshake.auth?.token || "");
      if (!token) return next(new Error("AUTH_REQUIRED"));
      socket.auth = jwt.verify(token, process.env.JWT_SECRET, {
        issuer: "migolive-api", audience: "migolive-app"
      });
      next();
    } catch (_error) { next(new Error("INVALID_TOKEN")); }
  });

  const socketRooms = new Map();
  const mutedUsers = new Map();
  // MongoDB-backed microphone leases enforce one active mic across all API replicas.
  // The local map is only used to renew leases owned by this process.
  const activeMicSockets = new Map();
  const MIC_LEASE_MS = 45_000;
  const MIC_RENEW_MS = 15_000;

  function micKey(roomCode, userId) {
    return String(roomCode) + ":" + String(userId);
  }

  async function acquireMic(roomCode, userId, socketId) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + MIC_LEASE_MS);
    try {
      const lease = await MicLease.findOneAndUpdate(
        {
          roomCode: Number(roomCode),
          userId,
          $or: [{ socketId }, { expiresAt: { $lte: now } }]
        },
        { $set: { socketId, expiresAt } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      ).lean();
      if (!lease || lease.socketId !== socketId) return false;
      activeMicSockets.set(micKey(roomCode, userId), { roomCode: Number(roomCode), userId: String(userId), socketId });
      return true;
    } catch (error) {
      // A concurrent upsert for the unique room/account key means another socket won.
      if (error && error.code === 11000) return false;
      throw error;
    }
  }

  async function releaseMic(roomCode, userId, socketId) {
    const key = micKey(roomCode, userId);
    const local = activeMicSockets.get(key);
    if (!socketId || (local && local.socketId === socketId)) activeMicSockets.delete(key);
    const filter = { roomCode: Number(roomCode), userId };
    if (socketId) filter.socketId = socketId;
    await MicLease.deleteOne(filter);
  }

  const micLeaseRenewal = setInterval(async () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + MIC_LEASE_MS);
    for (const lease of activeMicSockets.values()) {
      try {
        const result = await MicLease.updateOne(
          { roomCode: lease.roomCode, userId: lease.userId, socketId: lease.socketId },
          { $set: { expiresAt } }
        );
        if (!result.matchedCount) activeMicSockets.delete(micKey(lease.roomCode, lease.userId));
      } catch (error) {
        console.error("Mic lease renewal failed:", error.message);
      }
    }
  }, MIC_RENEW_MS);
  if (typeof micLeaseRenewal.unref === "function") micLeaseRenewal.unref();

  async function memberContext(socket, roomCode) {
    const room = await Room.findOne({ roomCode: Number(roomCode), status: "open" })
      .select("roomCode owner members speakerSeats").lean();
    if (!room || !room.members.some(id => String(id) === socket.auth.sub)) return null;
    const user = await User.findById(socket.auth.sub).select("uid displayName role").lean();
    if (!user) return null;
    return { room, user, isOwner: String(room.owner) === socket.auth.sub, isAdmin: user.role === "admin" || user.role === "owner" };
  }

async function seatSnapshot(room) {
    const source = Array.isArray(room.speakerSeats) ? room.speakerSeats : [];
    const ids = [...new Set(source.map(s => String(s.userId)))];
    const users = await User.find({ _id: { $in: ids } }).select("_id uid").lean();
    const uidById = new Map(users.map(u => [String(u._id), u.uid]));
    // A user can occupy only one speaker seat. Prefer the last valid seat
    // if legacy data contains duplicates, and never emit duplicate UI entries.
    const byUser = new Map();
    const usedSeats = new Set();
    for (const s of source) {
      const key = String(s.userId);
      const uid = uidById.get(key);
      const seat = Number(s.seat);
      if (!uid || !Number.isInteger(seat) || seat < 1 || seat > 25) continue;
      if (byUser.has(key)) {
        const previous = byUser.get(key);
        usedSeats.delete(previous.seat);
      }
      if (usedSeats.has(seat)) continue;
      byUser.set(key, { seat, uid });
      usedSeats.add(seat);
    }
    return [...byUser.values()];
  }

    function emitRoom(roomCode, event, payload, exceptSocket) {
    const target = io.to("room:" + roomCode);
    if (exceptSocket) target.except(exceptSocket).emit(event, payload);
    else target.emit(event, payload);
  }

  io.on("connection", socket => {
    socket.on("room:join", async (payload = {}, ack = () => {}) => {
      try {
        const roomCode = Number(payload.roomCode);
        if (!Number.isSafeInteger(roomCode)) return ack({ ok: false, error: "INVALID_ROOM" });
        const ctx = await memberContext(socket, roomCode);
        if (!ctx) return ack({ ok: false, error: "NOT_ROOM_MEMBER" });
        const key = String(roomCode);
        const previous = socketRooms.get(socket.id);
        if (previous && previous !== key) {
          await releaseMic(previous, socket.auth.sub, socket.id);
          socket.leave("room:" + previous);
          emitRoom(previous, "room:peer-left", { socketId: socket.id, uid: socket.auth.uid });
          try {
            const previousRoom = await Room.findOneAndUpdate(
              { roomCode: Number(previous), status: "open" },
              { $pull: { speakerSeats: { userId: ctx.user._id } } },
              { new: true }
            ).select("speakerSeats").lean();
            if (previousRoom) emitRoom(previous, "seats:state", {
              seats: await seatSnapshot(previousRoom)
            });
            emitRoom(previous, "mic:state", { uid: ctx.user.uid, enabled: false });
            emitRoom(previous, "hand:state", { uid: ctx.user.uid, raised: false });
          } catch (_cleanupError) { /* switching rooms must continue */ }
        }
        socketRooms.set(socket.id, key);
        socket.data.roomCode = roomCode;
        socket.data.uid = ctx.user.uid;
        socket.data.displayName = ctx.user.displayName;
        socket.join("room:" + key);
        const peers = [...(io.sockets.adapter.rooms.get("room:" + key) || [])]
          .filter(id => id !== socket.id);
        ack({ ok: true, roomCode, socketId: socket.id, uid: ctx.user.uid, peers, seats: await seatSnapshot(ctx.room) });
        socket.to("room:" + key).emit("room:peer-joined", {
          socketId: socket.id, uid: ctx.user.uid, displayName: ctx.user.displayName
        });
      } catch (_error) { ack({ ok: false, error: "SERVER_ERROR" }); }
    });

    for (const event of ["rtc:offer", "rtc:answer", "rtc:ice"]) {
      socket.on(event, async (payload = {}, ack = () => {}) => {
        try {
          const roomCode = socket.data.roomCode;
          const target = String(payload.to || "");
          const targetSocket = io.sockets.sockets.get(target);
          if (!roomCode || !targetSocket || targetSocket.data.roomCode !== roomCode) {
            return ack({ ok: false, error: "PEER_NOT_IN_ROOM" });
          }
          // Re-check both memberships against MongoDB for every signaling packet.
          // This prevents a socket removed from a room from continuing to exchange
          // WebRTC offers, answers, or ICE candidates using stale socket state.
          const [senderContext, targetContext] = await Promise.all([
            memberContext(socket, roomCode),
            memberContext(targetSocket, roomCode)
          ]);
          if (!senderContext || !targetContext) {
            return ack({ ok: false, error: "NOT_ROOM_MEMBER" });
          }
          targetSocket.emit(event, {
            from: socket.id,
            description: payload.description,
            candidate: payload.candidate
          });
          return ack({ ok: true });
        } catch (_error) {
          return ack({ ok: false, error: "SERVER_ERROR" });
        }
      });
    }

    socket.on("seat:take", async (payload = {}, ack = () => {}) => {
      try {
        const roomCode = socket.data.roomCode;
        const seat = Number(payload.seat);
        if (!roomCode || !Number.isInteger(seat) || seat < 1 || seat > 25) {
          return ack({ ok: false, error: "INVALID_SEAT" });
        }
        const ctx = await memberContext(socket, roomCode);
        if (!ctx) return ack({ ok: false, error: "NOT_ROOM_MEMBER" });
        const userId = ctx.user._id;
        const room = await Room.findOneAndUpdate(
          {
            roomCode, status: "open",
            speakerSeats: { $not: { $elemMatch: { seat, userId: { $ne: userId } } } },
            $or: [
              { speakerSeats: { $elemMatch: { userId } } },
              { $expr: { $lt: [
                { $size: { $ifNull: ["$speakerSeats", []] } },
                25
              ] } }
            ]
          },
          [{
            $set: {
              speakerSeats: {
                $concatArrays: [
                  { $filter: {
                    input: { $ifNull: ["$speakerSeats", []] },
                    as: "speaker",
                    cond: { $ne: ["$speaker.userId", userId] }
                  } },
                  [{ seat, userId }]
                ]
              }
            }
          }],
          { new: true }
        );
        if (!room) {
          const current = await Room.findOne({ roomCode, status: "open" }).select("speakerSeats").lean();
          if (!current) return ack({ ok: false, error: "ROOM_NOT_FOUND" });
          if ((current.speakerSeats || []).some(s => s.seat === seat && String(s.userId) !== String(userId))) {
            return ack({ ok: false, error: "SEAT_OCCUPIED" });
          }
          return ack({ ok: false, error: "SEATS_FULL" });
        }
        const seats = await seatSnapshot(room);
        emitRoom(roomCode, "seats:state", { seats });
        return ack({ ok: true, seats });
      } catch (_error) { return ack({ ok: false, error: "SERVER_ERROR" }); }
    });

    socket.on("seat:leave", async (_payload = {}, ack = () => {}) => {
      try {
        const roomCode = socket.data.roomCode;
        const ctx = roomCode && await memberContext(socket, roomCode);
        if (!ctx) return ack({ ok: false, error: "NOT_ROOM_MEMBER" });
        const room = await Room.findOneAndUpdate(
          { roomCode, status: "open" },
          { $pull: { speakerSeats: { userId: ctx.user._id } } },
          { new: true }
        );
        if (!room) return ack({ ok: false, error: "ROOM_NOT_FOUND" });
        await releaseMic(roomCode, ctx.user._id, socket.id);
        const seats = await seatSnapshot(room);
        emitRoom(roomCode, "seats:state", { seats });
        emitRoom(roomCode, "mic:state", { uid: ctx.user.uid, enabled: false });
        return ack({ ok: true, seats });
      } catch (_error) { return ack({ ok: false, error: "SERVER_ERROR" }); }
    });

    socket.on("mic:state", async (payload = {}, ack = () => {}) => {
      try {
        const roomCode = socket.data.roomCode;
        if (!roomCode) return ack({ ok: false, error: "NOT_IN_ROOM" });
        const ctx = await memberContext(socket, roomCode);
        if (!ctx) return ack({ ok: false, error: "NOT_ROOM_MEMBER" });
        const room = await Room.findOne({ roomCode, status: "open" }).select("owner speakerSeats").lean();
        if (!room) return ack({ ok: false, error: "ROOM_NOT_FOUND" });
        const isOwner = String(room.owner) === String(ctx.user._id);
        const hasSeat = (room.speakerSeats || []).some(s => String(s.userId) === String(ctx.user._id));
        const muted = mutedUsers.get(String(roomCode) + ":" + socket.auth.sub) === true;
        if (payload.enabled === true && !isOwner && !hasSeat) {
          return ack({ ok: false, error: "SPEAKER_SEAT_REQUIRED" });
        }
        const enabled = payload.enabled === true && !muted;
        if (enabled) {
          const acquired = await acquireMic(roomCode, ctx.user._id, socket.id);
          if (!acquired) return ack({ ok: false, error: "MIC_ALREADY_ACTIVE" });
        } else {
          await releaseMic(roomCode, ctx.user._id, socket.id);
        }
        emitRoom(roomCode, "mic:state", { uid: ctx.user.uid, enabled });
        ack({ ok: true, enabled, forcedMuted: muted });
      } catch (_error) { ack({ ok: false, error: "SERVER_ERROR" }); }
    });

    socket.on("hand:raise", async (payload = {}, ack = () => {}) => {
      try {
        const roomCode = socket.data.roomCode;
        const ctx = roomCode && await memberContext(socket, roomCode);
        if (!ctx) return ack({ ok: false, error: "NOT_ROOM_MEMBER" });
        emitRoom(roomCode, "hand:state", { uid: ctx.user.uid, raised: payload.raised === true });
        ack({ ok: true });
      } catch (_error) { ack({ ok: false, error: "SERVER_ERROR" }); }
    });

    socket.on("host:mute", async (payload = {}, ack = () => {}) => {
      try {
        const roomCode = socket.data.roomCode;
        const ctx = roomCode && await memberContext(socket, roomCode);
        if (!ctx || (!ctx.isOwner && !ctx.isAdmin)) return ack({ ok: false, error: "FORBIDDEN" });
        const targetUid = Number(payload.uid);
        if (!Number.isSafeInteger(targetUid) || targetUid < 1) return ack({ ok: false, error: "INVALID_USER" });
        const target = await User.findOne({ uid: targetUid }).select("_id uid").lean();
        if (!target) return ack({ ok: false, error: "USER_NOT_FOUND" });
        const room = await Room.findOne({ roomCode, status: "open", members: target._id }).select("_id owner").lean();
        if (!room) return ack({ ok: false, error: "USER_NOT_IN_ROOM" });
        if (String(room.owner) === String(target._id)) return ack({ ok: false, error: "CANNOT_MUTE_OWNER" });
        const mute = payload.muted === true;
        mutedUsers.set(String(roomCode) + ":" + String(target._id), mute);
        if (mute) await releaseMic(roomCode, target._id);
        emitRoom(roomCode, "host:mute-state", { uid: targetUid, muted: mute });
        ack({ ok: true });
      } catch (_error) { ack({ ok: false, error: "SERVER_ERROR" }); }
    });

    socket.on("host:kick", async (payload = {}, ack = () => {}) => {
      try {
        const roomCode = socket.data.roomCode;
        const ctx = roomCode && await memberContext(socket, roomCode);
        if (!ctx || (!ctx.isOwner && !ctx.isAdmin)) return ack({ ok: false, error: "FORBIDDEN" });
        const targetUid = Number(payload.uid);
        if (!Number.isSafeInteger(targetUid) || targetUid < 1) return ack({ ok: false, error: "INVALID_TARGET" });
        const target = await User.findOne({ uid: targetUid }).select("_id uid").lean();
        if (!target || String(target._id) === String(ctx.room.owner)) return ack({ ok: false, error: "INVALID_TARGET" });
        const updated = await Room.updateOne({ _id: ctx.room._id, members: target._id }, { $pull: { members: target._id, speakerSeats: { userId: target._id } } });
        if (!updated.modifiedCount) return ack({ ok: false, error: "USER_NOT_IN_ROOM" });
        mutedUsers.delete(String(roomCode) + ":" + String(target._id));
        await releaseMic(roomCode, target._id);
        const refreshedRoom = await Room.findById(ctx.room._id).select("speakerSeats").lean();
        emitRoom(roomCode, "seats:state", { seats: await seatSnapshot(refreshedRoom || { speakerSeats: [] }) });
        emitRoom(roomCode, "mic:state", { uid: targetUid, enabled: false });
        emitRoom(roomCode, "hand:state", { uid: targetUid, raised: false });
        const targetSocketIds = [...(io.sockets.adapter.rooms.get("room:" + roomCode) || [])]
          .filter(id => io.sockets.sockets.get(id)?.auth?.sub === String(target._id));
        for (const id of targetSocketIds) {
          const peer = io.sockets.sockets.get(id);
          peer.emit("room:kicked", { roomCode });
          peer.leave("room:" + roomCode);
          socketRooms.delete(id);
          peer.data.roomCode = null;
        }
        emitRoom(roomCode, "room:peer-left", { uid: targetUid, reason: "kicked" });
        ack({ ok: true });
      } catch (_error) { ack({ ok: false, error: "SERVER_ERROR" }); }
    });

    socket.on("disconnect", async () => {
      const roomCode = socketRooms.get(socket.id);
      if (roomCode) {
        await releaseMic(roomCode, socket.auth.sub, socket.id);
        emitRoom(roomCode, "room:peer-left", { socketId: socket.id, uid: socket.auth.uid });
        emitRoom(roomCode, "mic:state", { uid: socket.auth.uid, enabled: false });
        emitRoom(roomCode, "hand:state", { uid: socket.auth.uid, raised: false });
        try {
          const user = await User.findById(socket.auth.sub).select("_id").lean();
          if (user) {
            const room = await Room.findOneAndUpdate(
              { roomCode, status: "open" },
              { $pull: { speakerSeats: { userId: user._id } } },
              { new: true }
            ).select("speakerSeats").lean();
            if (room) emitRoom(roomCode, "seats:state", {
              seats: await seatSnapshot(room)
            });
          }
        } catch (_error) { /* disconnect cleanup is best-effort */ }
      }
      socketRooms.delete(socket.id);
      socket.data.roomCode = null;
    });
  });

  return io;
}

module.exports = { attachRealtime };
