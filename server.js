const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ROUND_DURATION_MS = 75 * 1000;
const DEFAULT_PLACEMENTS = {
  house: 4,
  school: 2,
  hospital: 2,
  industry: 3,
};
const SCORE_RULES = {
  schoolBoostKm: 40,
  hospitalBoostKm: 55,
  industryPenaltyKm: 35,
  industryClusterKm: 18,
  industryClusterPenalty: 12,
};

const rooms = new Map();

app.use(express.static(path.join(__dirname, "public")));

function clonePlacements() {
  return { ...DEFAULT_PLACEMENTS };
}

function createPlacementId(playerId, count) {
  return `${playerId}-${Date.now()}-${count}`;
}

function haversineDistanceKm(a, b) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const latDelta = toRadians(b.lat - a.lat);
  const lngDelta = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const value =
    Math.sin(latDelta / 2) * Math.sin(latDelta / 2) +
    Math.sin(lngDelta / 2) * Math.sin(lngDelta / 2) * Math.cos(lat1) * Math.cos(lat2);

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function randomRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let index = 0; index < 5; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return rooms.has(code) ? randomRoomCode() : code;
}

function scorePlacements(placements) {
  const houses = placements.filter((placement) => placement.type === "house");
  const schools = placements.filter((placement) => placement.type === "school");
  const hospitals = placements.filter((placement) => placement.type === "hospital");
  const industries = placements.filter((placement) => placement.type === "industry");

  let score = 0;
  const breakdown = [];

  for (const house of houses) {
    const nearSchool = schools.some(
      (target) => haversineDistanceKm(house, target) <= SCORE_RULES.schoolBoostKm
    );
    const nearHospital = hospitals.some(
      (target) => haversineDistanceKm(house, target) <= SCORE_RULES.hospitalBoostKm
    );
    const nearIndustry = industries.some(
      (target) => haversineDistanceKm(house, target) <= SCORE_RULES.industryPenaltyKm
    );

    if (nearSchool) {
      score += 15;
      breakdown.push("House near school +15");
    }
    if (nearHospital) {
      score += 20;
      breakdown.push("House near hospital +20");
    }
    if (nearIndustry) {
      score -= 30;
      breakdown.push("House near industry -30");
    }
  }

  let clusterPenalty = 0;
  for (let index = 0; index < industries.length; index += 1) {
    for (let next = index + 1; next < industries.length; next += 1) {
      if (haversineDistanceKm(industries[index], industries[next]) <= SCORE_RULES.industryClusterKm) {
        clusterPenalty += SCORE_RULES.industryClusterPenalty;
      }
    }
  }

  if (clusterPenalty > 0) {
    score -= clusterPenalty;
    breakdown.push(`Industry cluster penalty -${clusterPenalty}`);
  }

  return {
    score,
    breakdown,
    stats: {
      houses: houses.length,
      schools: schools.length,
      hospitals: hospitals.length,
      industries: industries.length,
    },
  };
}

function summarizePlayer(room, player) {
  const preview = room.phase === "results" ? { score: player.score } : scorePlacements(player.placements);
  return {
    id: player.id,
    name: player.name,
    isHost: player.isHost,
    score: preview.score,
    placementsLeft: player.placementsLeft,
    placementsUsed: player.placements.length,
  };
}

function serializeRoom(room) {
  const players = Array.from(room.players.values()).map((player) => summarizePlayer(room, player));
  const leader = room.results?.[0] || null;

  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    endsAt: room.endsAt,
    players,
    leader,
    results: room.results,
    winnerLayout: room.winnerLayout,
  };
}

function emitRoom(room) {
  io.to(room.code).emit("room:update", serializeRoom(room));
}

function emitBoard(room, socketId) {
  const player = room.players.get(socketId);
  if (!player) {
    return;
  }

  const preview = scorePlacements(player.placements);
  io.to(socketId).emit("board:update", {
    placements: player.placements,
    placementsLeft: player.placementsLeft,
    currentScore: preview.score,
  });
}

function stopTimer(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
}

function finishRound(room) {
  stopTimer(room);
  room.phase = "results";
  room.endsAt = null;

  const results = Array.from(room.players.values()).map((player) => {
    const outcome = scorePlacements(player.placements);
    player.score = outcome.score;
    return {
      id: player.id,
      name: player.name,
      score: outcome.score,
      breakdown: outcome.breakdown,
      placements: player.placements,
      stats: outcome.stats,
    };
  });

  results.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
  room.results = results;
  room.winnerLayout = results[0]?.placements || [];

  emitRoom(room);
}

function startRound(room) {
  stopTimer(room);
  room.phase = "playing";
  room.results = null;
  room.winnerLayout = [];
  room.endsAt = Date.now() + ROUND_DURATION_MS;

  for (const player of room.players.values()) {
    player.placements = [];
    player.placementsLeft = clonePlacements();
    player.score = 0;
    emitBoard(room, player.id);
  }

  room.timer = setTimeout(() => finishRound(room), ROUND_DURATION_MS);
  emitRoom(room);
}

function createPlayer(id, name, isHost) {
  return {
    id,
    name,
    isHost,
    placements: [],
    placementsLeft: clonePlacements(),
    score: 0,
  };
}

function createRoom(hostSocket, playerName) {
  const code = randomRoomCode();
  const room = {
    code,
    hostId: hostSocket.id,
    phase: "lobby",
    players: new Map(),
    endsAt: null,
    timer: null,
    results: null,
    winnerLayout: [],
  };

  room.players.set(hostSocket.id, createPlayer(hostSocket.id, playerName, true));
  rooms.set(code, room);
  hostSocket.join(code);
  return room;
}

function joinRoom(socket, room, playerName) {
  room.players.set(socket.id, createPlayer(socket.id, playerName, false));
  socket.join(room.code);
  emitBoard(room, socket.id);
  emitRoom(room);
}

function cleanupRoom(room) {
  stopTimer(room);
  rooms.delete(room.code);
}

function roomForSocket(socket) {
  for (const room of rooms.values()) {
    if (room.players.has(socket.id)) {
      return room;
    }
  }
  return null;
}

function remainingPlacements(player) {
  return Object.values(player.placementsLeft).reduce((sum, value) => sum + value, 0);
}

io.on("connection", (socket) => {
  socket.on("room:create", ({ name }, callback = () => {}) => {
    const playerName = String(name || "").trim().slice(0, 18);
    if (!playerName) {
      callback({ ok: false, message: "Enter a player name." });
      return;
    }

    const room = createRoom(socket, playerName);
    emitBoard(room, socket.id);
    emitRoom(room);
    callback({ ok: true, roomCode: room.code, playerId: socket.id });
  });

  socket.on("room:join", ({ code, name }, callback = () => {}) => {
    const roomCode = String(code || "").trim().toUpperCase();
    const playerName = String(name || "").trim().slice(0, 18);
    const room = rooms.get(roomCode);

    if (!playerName) {
      callback({ ok: false, message: "Enter a player name." });
      return;
    }

    if (!room) {
      callback({ ok: false, message: "Room not found." });
      return;
    }

    if (room.phase === "playing") {
      callback({ ok: false, message: "Round already in progress." });
      return;
    }

    joinRoom(socket, room, playerName);
    callback({ ok: true, roomCode: room.code, playerId: socket.id });
  });

  socket.on("game:start", (_, callback = () => {}) => {
    const room = roomForSocket(socket);
    if (!room) {
      callback({ ok: false, message: "Join a room first." });
      return;
    }

    if (room.hostId !== socket.id) {
      callback({ ok: false, message: "Only the host can start the round." });
      return;
    }

    if (room.players.size < 2) {
      callback({ ok: false, message: "At least two players are required." });
      return;
    }

    startRound(room);
    callback({ ok: true });
  });

  socket.on("game:place", ({ lat, lng, type }, callback = () => {}) => {
    const room = roomForSocket(socket);
    if (!room || room.phase !== "playing") {
      callback({ ok: false, message: "Round is not active." });
      return;
    }

    const player = room.players.get(socket.id);
    const targetType = String(type || "");

    if (!player || !Object.hasOwn(DEFAULT_PLACEMENTS, targetType)) {
      callback({ ok: false, message: "Invalid placement." });
      return;
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      callback({ ok: false, message: "Invalid map location." });
      return;
    }

    if (player.placementsLeft[targetType] <= 0) {
      callback({ ok: false, message: `No ${targetType} placements left.` });
      return;
    }

    player.placements.push({
      id: createPlacementId(player.id, player.placements.length + 1),
      type: targetType,
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
    });
    player.placementsLeft[targetType] -= 1;

    emitBoard(room, socket.id);
    emitRoom(room);
    callback({ ok: true });

    const everyoneDone = Array.from(room.players.values()).every(
      (currentPlayer) => remainingPlacements(currentPlayer) === 0
    );

    if (everyoneDone) {
      finishRound(room);
    }
  });

  socket.on("disconnect", () => {
    const room = roomForSocket(socket);
    if (!room) {
      return;
    }

    const wasHost = room.hostId === socket.id;
    room.players.delete(socket.id);
    socket.leave(room.code);

    if (room.players.size === 0) {
      cleanupRoom(room);
      return;
    }

    if (wasHost) {
      const nextHost = room.players.values().next().value;
      room.hostId = nextHost.id;
      nextHost.isHost = true;
    }

    emitRoom(room);
  });
});

server.listen(PORT, () => {
  console.log(`Urban Planner by Veee running on port ${PORT}`);
});
