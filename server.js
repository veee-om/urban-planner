const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const GRID_SIZE = 10;
const ROUND_DURATION_MS = 75 * 1000;
const DEFAULT_PLACEMENTS = {
  house: 4,
  school: 2,
  hospital: 2,
  industry: 3,
};

const rooms = new Map();

app.use(express.static(path.join(__dirname, "public")));

function makeGrid() {
  return Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(null));
}

function clonePlacements() {
  return { ...DEFAULT_PLACEMENTS };
}

function distance(a, b) {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

function randomRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let index = 0; index < 5; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return rooms.has(code) ? randomRoomCode() : code;
}

function extractCells(grid) {
  const cells = [];
  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let col = 0; col < GRID_SIZE; col += 1) {
      const type = grid[row][col];
      if (type) {
        cells.push({ row, col, type });
      }
    }
  }
  return cells;
}

function scoreGrid(grid) {
  const cells = extractCells(grid);
  const houses = cells.filter((cell) => cell.type === "house");
  const schools = cells.filter((cell) => cell.type === "school");
  const hospitals = cells.filter((cell) => cell.type === "hospital");
  const industries = cells.filter((cell) => cell.type === "industry");

  let score = 0;
  const breakdown = [];

  for (const house of houses) {
    const nearSchool = schools.some((target) => distance(house, target) <= 2);
    const nearHospital = hospitals.some((target) => distance(house, target) <= 2);
    const nearIndustry = industries.some((target) => distance(house, target) <= 2);

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
      if (distance(industries[index], industries[next]) <= 1) {
        clusterPenalty += 12;
      }
    }
  }

  if (clusterPenalty > 0) {
    score -= clusterPenalty;
    breakdown.push(`Industry cluster penalty -${clusterPenalty}`);
  }

  return { score, breakdown };
}

function summarizePlayer(player) {
  return {
    id: player.id,
    name: player.name,
    isHost: player.isHost,
    score: player.score,
    placementsLeft: player.placementsLeft,
    readyPlacements: Object.values(player.placementsLeft).reduce((sum, value) => sum + value, 0),
  };
}

function serializeRoom(room) {
  const players = Array.from(room.players.values()).map(summarizePlayer);
  const leader = room.results?.[0] || null;

  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    endsAt: room.endsAt,
    players,
    leader,
    winnerBoard: room.winnerBoard,
    results: room.results,
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
  io.to(socketId).emit("board:update", {
    grid: player.grid,
    placementsLeft: player.placementsLeft,
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
    const outcome = scoreGrid(player.grid);
    player.score = outcome.score;
    return {
      id: player.id,
      name: player.name,
      score: outcome.score,
      breakdown: outcome.breakdown,
      board: player.grid,
    };
  });

  results.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
  room.results = results;
  room.winnerBoard = results[0]?.board || null;

  emitRoom(room);
}

function startRound(room) {
  stopTimer(room);
  room.phase = "playing";
  room.results = null;
  room.winnerBoard = null;
  room.endsAt = Date.now() + ROUND_DURATION_MS;

  for (const player of room.players.values()) {
    player.grid = makeGrid();
    player.placementsLeft = clonePlacements();
    player.score = 0;
    emitBoard(room, player.id);
  }

  room.timer = setTimeout(() => finishRound(room), ROUND_DURATION_MS);
  emitRoom(room);
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
    winnerBoard: null,
  };

  room.players.set(hostSocket.id, {
    id: hostSocket.id,
    name: playerName,
    isHost: true,
    grid: makeGrid(),
    placementsLeft: clonePlacements(),
    score: 0,
  });

  rooms.set(code, room);
  hostSocket.join(code);
  return room;
}

function joinRoom(socket, room, playerName) {
  room.players.set(socket.id, {
    id: socket.id,
    name: playerName,
    isHost: false,
    grid: makeGrid(),
    placementsLeft: clonePlacements(),
    score: 0,
  });
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

  socket.on("game:place", ({ row, col, type }, callback = () => {}) => {
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

    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row >= GRID_SIZE || col >= GRID_SIZE) {
      callback({ ok: false, message: "Cell is out of bounds." });
      return;
    }

    if (player.grid[row][col]) {
      callback({ ok: false, message: "Cell already used." });
      return;
    }

    if (player.placementsLeft[targetType] <= 0) {
      callback({ ok: false, message: `No ${targetType} placements left.` });
      return;
    }

    player.grid[row][col] = targetType;
    player.placementsLeft[targetType] -= 1;

    emitBoard(room, socket.id);
    emitRoom(room);
    callback({ ok: true });

    const everyoneDone = Array.from(room.players.values()).every(
      (currentPlayer) => Object.values(currentPlayer.placementsLeft).reduce((sum, value) => sum + value, 0) === 0
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
