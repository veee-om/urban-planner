const socket = io();

const GRID_SIZE = 10;
const ITEM_META = {
  house: { label: "House", symbol: "H", colorClass: "house" },
  school: { label: "School", symbol: "S", colorClass: "school" },
  hospital: { label: "Hospital", symbol: "+", colorClass: "hospital" },
  industry: { label: "Industry", symbol: "I", colorClass: "industry" },
};

const state = {
  room: null,
  board: Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(null)),
  placementsLeft: {
    house: 0,
    school: 0,
    hospital: 0,
    industry: 0,
  },
  selectedItem: "house",
  timerInterval: null,
};

const ui = {
  lobbyPanel: document.getElementById("lobbyPanel"),
  gamePanel: document.getElementById("gamePanel"),
  playerName: document.getElementById("playerName"),
  roomCodeInput: document.getElementById("roomCodeInput"),
  createRoomBtn: document.getElementById("createRoomBtn"),
  joinRoomBtn: document.getElementById("joinRoomBtn"),
  lobbyMessage: document.getElementById("lobbyMessage"),
  connectionStatus: document.getElementById("connectionStatus"),
  roomCodeLabel: document.getElementById("roomCodeLabel"),
  grid: document.getElementById("grid"),
  itemPalette: document.getElementById("itemPalette"),
  placementHint: document.getElementById("placementHint"),
  playersList: document.getElementById("playersList"),
  timerLabel: document.getElementById("timerLabel"),
  phasePill: document.getElementById("phasePill"),
  resultsList: document.getElementById("resultsList"),
  leaderLabel: document.getElementById("leaderLabel"),
  winnerBoardWrap: document.getElementById("winnerBoardWrap"),
  winnerBoard: document.getElementById("winnerBoard"),
  startRoundBtn: document.getElementById("startRoundBtn"),
};

function showMessage(text, isError = false) {
  ui.lobbyMessage.textContent = text;
  ui.lobbyMessage.classList.toggle("error", isError);
}

function getPlayerName() {
  return ui.playerName.value.trim();
}

function renderPalette() {
  ui.itemPalette.innerHTML = "";
  Object.entries(ITEM_META).forEach(([key, meta]) => {
    const left = state.placementsLeft[key] ?? 0;
    const button = document.createElement("button");
    button.className = `palette-item ${meta.colorClass} ${state.selectedItem === key ? "selected" : ""}`;
    button.innerHTML = `<strong>${meta.label}</strong><span>${left} left</span>`;
    button.disabled = left <= 0 || state.room?.phase !== "playing";
    button.addEventListener("click", () => {
      state.selectedItem = key;
      renderPalette();
      updatePlacementHint();
    });
    ui.itemPalette.appendChild(button);
  });
}

function renderGrid() {
  ui.grid.innerHTML = "";
  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let col = 0; col < GRID_SIZE; col += 1) {
      const cellType = state.board[row][col];
      const button = document.createElement("button");
      button.className = `cell ${cellType ? ITEM_META[cellType].colorClass : ""}`;
      button.dataset.row = String(row);
      button.dataset.col = String(col);
      button.innerHTML = cellType ? `<span>${ITEM_META[cellType].symbol}</span>` : "";
      button.disabled = state.room?.phase !== "playing" || Boolean(cellType);
      button.addEventListener("click", () => placeItem(row, col));
      ui.grid.appendChild(button);
    }
  }
}

function renderPlayers() {
  if (!state.room) {
    ui.playersList.innerHTML = "";
    return;
  }

  ui.playersList.innerHTML = "";
  state.room.players.forEach((player) => {
    const card = document.createElement("div");
    card.className = "player-card";
    const placementText = Object.entries(player.placementsLeft || {})
      .map(([key, value]) => `${ITEM_META[key].label}: ${value}`)
      .join(" | ");

    card.innerHTML = `
      <div class="player-title-row">
        <strong>${player.name}${player.isHost ? " (Host)" : ""}</strong>
        <span>${player.score ?? 0} pts</span>
      </div>
      <p>${placementText}</p>
    `;
    ui.playersList.appendChild(card);
  });
}

function renderWinnerBoard(board) {
  ui.winnerBoard.innerHTML = "";
  if (!board) {
    ui.winnerBoardWrap.classList.add("hidden");
    return;
  }

  ui.winnerBoardWrap.classList.remove("hidden");
  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let col = 0; col < GRID_SIZE; col += 1) {
      const type = board[row][col];
      const cell = document.createElement("div");
      cell.className = `mini-cell ${type ? ITEM_META[type].colorClass : ""}`;
      cell.textContent = type ? ITEM_META[type].symbol : "";
      ui.winnerBoard.appendChild(cell);
    }
  }
}

function renderResults() {
  const results = state.room?.results;
  if (!results || results.length === 0) {
    ui.resultsList.className = "results-list empty-state";
    ui.resultsList.textContent = "Finish a round to see scores.";
    ui.leaderLabel.textContent = "Waiting";
    renderWinnerBoard(null);
    return;
  }

  ui.resultsList.className = "results-list";
  ui.resultsList.innerHTML = "";
  results.forEach((entry, index) => {
    const card = document.createElement("div");
    card.className = `result-card ${index === 0 ? "winner" : ""}`;
    const details = entry.breakdown.length > 0 ? entry.breakdown.join(" | ") : "Balanced build with no bonuses yet.";
    card.innerHTML = `
      <div class="player-title-row">
        <strong>${index === 0 ? "Winner - " : ""}${entry.name}</strong>
        <span>${entry.score} pts</span>
      </div>
      <p>${details}</p>
    `;
    ui.resultsList.appendChild(card);
  });

  ui.leaderLabel.textContent = `${results[0].name} leads`;
  renderWinnerBoard(state.room.winnerBoard);
}

function updatePlacementHint() {
  const item = ITEM_META[state.selectedItem];
  const left = state.placementsLeft[state.selectedItem] ?? 0;

  if (!state.room) {
    ui.placementHint.textContent = "";
    return;
  }

  if (state.room.phase !== "playing") {
    ui.placementHint.textContent = "Waiting for the host to start the next round.";
    return;
  }

  ui.placementHint.textContent = `${item.label} selected. ${left} placements remaining this round.`;
}

function setTimer(endsAt) {
  clearInterval(state.timerInterval);

  if (!endsAt) {
    ui.timerLabel.textContent = "--:--";
    return;
  }

  const renderTime = () => {
    const remaining = Math.max(0, endsAt - Date.now());
    const seconds = Math.ceil(remaining / 1000);
    const minutesPart = String(Math.floor(seconds / 60)).padStart(2, "0");
    const secondsPart = String(seconds % 60).padStart(2, "0");
    ui.timerLabel.textContent = `${minutesPart}:${secondsPart}`;
  };

  renderTime();
  state.timerInterval = setInterval(renderTime, 250);
}

function updateScreenState() {
  const hasRoom = Boolean(state.room);
  ui.gamePanel.classList.toggle("hidden", !hasRoom);
  ui.lobbyPanel.classList.toggle("hidden", hasRoom);

  if (!hasRoom) {
    return;
  }

  ui.roomCodeLabel.textContent = state.room.code;
  ui.phasePill.textContent = state.room.phase[0].toUpperCase() + state.room.phase.slice(1);

  const currentPlayer = state.room.players.find((player) => player.id === socket.id);
  const isHost = currentPlayer?.isHost;
  ui.startRoundBtn.classList.toggle("hidden", !isHost);
  ui.startRoundBtn.textContent = state.room.phase === "results" ? "Play Again" : "Start Round";
  ui.startRoundBtn.disabled = state.room.phase === "playing";

  setTimer(state.room.phase === "playing" ? state.room.endsAt : null);
  renderPlayers();
  renderPalette();
  renderGrid();
  renderResults();
  updatePlacementHint();
}

function placeItem(row, col) {
  if (!state.room || state.room.phase !== "playing") {
    return;
  }

  socket.emit("game:place", { row, col, type: state.selectedItem }, (response) => {
    if (!response?.ok && response?.message) {
      ui.placementHint.textContent = response.message;
    }
  });
}

function createRoom() {
  socket.emit("room:create", { name: getPlayerName() }, (response) => {
    if (!response?.ok) {
      showMessage(response?.message || "Could not create room.", true);
      return;
    }

    showMessage(`Room ${response.roomCode} created. Share it with friends.`);
  });
}

function joinRoom() {
  socket.emit(
    "room:join",
    { code: ui.roomCodeInput.value.trim(), name: getPlayerName() },
    (response) => {
      if (!response?.ok) {
        showMessage(response?.message || "Could not join room.", true);
        return;
      }

      showMessage(`Joined room ${response.roomCode}.`);
    }
  );
}

socket.on("connect", () => {
  ui.connectionStatus.textContent = "Online";
  ui.connectionStatus.classList.add("good");
});

socket.on("disconnect", () => {
  ui.connectionStatus.textContent = "Disconnected";
  ui.connectionStatus.classList.remove("good");
});

socket.on("room:update", (room) => {
  state.room = room;
  updateScreenState();
});

socket.on("board:update", ({ grid, placementsLeft }) => {
  state.board = grid;
  state.placementsLeft = placementsLeft;
  renderPalette();
  renderGrid();
  updatePlacementHint();
});

ui.createRoomBtn.addEventListener("click", createRoom);
ui.joinRoomBtn.addEventListener("click", joinRoom);
ui.startRoundBtn.addEventListener("click", () => {
  socket.emit("game:start", {}, (response) => {
    if (!response?.ok && response?.message) {
      ui.placementHint.textContent = response.message;
    }
  });
});

ui.roomCodeInput.addEventListener("input", () => {
  ui.roomCodeInput.value = ui.roomCodeInput.value.toUpperCase();
});

renderPalette();
renderGrid();
