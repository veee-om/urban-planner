const socket = io();

const ITEM_META = {
  house: { label: "House", colorClass: "house", scoreColor: "#16a34a" },
  school: { label: "School", colorClass: "school", scoreColor: "#2563eb" },
  hospital: { label: "Hospital", colorClass: "hospital", scoreColor: "#dc2626" },
  industry: { label: "Industry", colorClass: "industry", scoreColor: "#111827" },
};
const ZONE_STYLE = {
  hospital: { radius: 55000, color: "#dc2626", fillColor: "#f87171" },
  industry: { radius: 35000, color: "#111827", fillColor: "#6b7280" },
};

const state = {
  room: null,
  placements: [],
  placementsLeft: {
    house: 0,
    school: 0,
    hospital: 0,
    industry: 0,
  },
  selectedItem: "house",
  currentScore: 0,
  timerInterval: null,
  map: null,
  markersLayer: null,
  zonesLayer: null,
};

const ui = {
  landingScreen: document.getElementById("landingScreen"),
  waitingScreen: document.getElementById("waitingScreen"),
  gameScreen: document.getElementById("gameScreen"),
  playerName: document.getElementById("playerName"),
  roomCodeInput: document.getElementById("roomCodeInput"),
  createRoomBtn: document.getElementById("createRoomBtn"),
  joinRoomBtn: document.getElementById("joinRoomBtn"),
  lobbyMessage: document.getElementById("lobbyMessage"),
  connectionStatus: document.getElementById("connectionStatus"),
  waitingRoomCode: document.getElementById("waitingRoomCode"),
  waitingPhase: document.getElementById("waitingPhase"),
  startRoundBtn: document.getElementById("startRoundBtn"),
  playersList: document.getElementById("playersList"),
  resultsList: document.getElementById("resultsList"),
  winnerSummary: document.getElementById("winnerSummary"),
  leaderLabel: document.getElementById("leaderLabel"),
  roomCodeLabel: document.getElementById("roomCodeLabel"),
  phasePill: document.getElementById("phasePill"),
  timerLabel: document.getElementById("timerLabel"),
  itemPalette: document.getElementById("itemPalette"),
  placementHint: document.getElementById("placementHint"),
  placedItemsList: document.getElementById("placedItemsList"),
  currentScoreLabel: document.getElementById("currentScoreLabel"),
  map: document.getElementById("map"),
};

function showMessage(text, isError = false) {
  ui.lobbyMessage.textContent = text;
  ui.lobbyMessage.classList.toggle("error", isError);
}

function getPlayerName() {
  return ui.playerName.value.trim();
}

function getCurrentPlayer() {
  return state.room?.players.find((player) => player.id === socket.id) || null;
}

function createMarkerIcon(type) {
  const meta = ITEM_META[type];
  return L.divIcon({
    className: "custom-marker-shell",
    html: `<div class="custom-marker ${meta.colorClass} marker-pop"><span></span></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -10],
  });
}

function ensureMap() {
  if (state.map) {
    return;
  }

  state.map = L.map("map", {
    zoomControl: true,
    minZoom: 4,
  }).setView([22.9734, 78.6569], 5);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(state.map);

  state.zonesLayer = L.layerGroup().addTo(state.map);
  state.markersLayer = L.layerGroup().addTo(state.map);

  state.map.on("click", (event) => {
    placeItem(event.latlng.lat, event.latlng.lng);
  });
}

function renderPalette() {
  ui.itemPalette.innerHTML = "";
  Object.entries(ITEM_META).forEach(([key, meta]) => {
    const left = state.placementsLeft[key] ?? 0;
    const isSelected = state.selectedItem === key;
    const button = document.createElement("button");
    button.className = `palette-item ${meta.colorClass} ${isSelected ? "selected" : ""}`;
    button.disabled = left <= 0 || state.room?.phase !== "playing";
    button.innerHTML = `
      <span class="palette-badge">${isSelected ? "Selected" : "Select"}</span>
      <strong>${meta.label}</strong>
      <span class="palette-count">${left} left</span>
    `;
    button.addEventListener("click", () => {
      state.selectedItem = key;
      renderPalette();
      updatePlacementHint();
    });
    ui.itemPalette.appendChild(button);
  });
}

function renderPlacedItems() {
  if (state.placements.length === 0) {
    ui.placedItemsList.className = "placed-items-list empty-state";
    ui.placedItemsList.textContent = "Click on the map to place your first marker.";
    return;
  }

  ui.placedItemsList.className = "placed-items-list";
  ui.placedItemsList.innerHTML = "";
  state.placements.forEach((placement, index) => {
    const row = document.createElement("div");
    row.className = "placed-item";
    row.innerHTML = `
      <div class="placed-item-title">
        <span class="legend-dot ${ITEM_META[placement.type].colorClass}-dot"></span>
        <strong>${index + 1}. ${ITEM_META[placement.type].label}</strong>
      </div>
      <span>${placement.lat.toFixed(3)}, ${placement.lng.toFixed(3)}</span>
    `;
    ui.placedItemsList.appendChild(row);
  });
}

function renderMapPlacements() {
  ensureMap();
  state.markersLayer.clearLayers();
  state.zonesLayer.clearLayers();

  if (state.placements.length > 0) {
    const bounds = [];
    state.placements.forEach((placement) => {
      const marker = L.marker([placement.lat, placement.lng], {
        icon: createMarkerIcon(placement.type),
      }).addTo(state.markersLayer);

      marker.bindTooltip(ITEM_META[placement.type].label, {
        direction: "top",
        offset: [0, -10],
      });

      bounds.push([placement.lat, placement.lng]);

      if (placement.type === "hospital" || placement.type === "industry") {
        const zone = ZONE_STYLE[placement.type];
        L.circle([placement.lat, placement.lng], {
          radius: zone.radius,
          color: zone.color,
          fillColor: zone.fillColor,
          fillOpacity: 0.16,
          weight: 1.5,
        }).addTo(state.zonesLayer);
      }
    });

    if (bounds.length === 1) {
      state.map.setView(bounds[0], 7, { animate: true });
    } else {
      state.map.fitBounds(bounds, {
        padding: [40, 40],
        animate: true,
      });
    }
  } else {
    state.map.setView([22.9734, 78.6569], 5, { animate: true });
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
    const placementsRemaining = Object.entries(player.placementsLeft)
      .map(([key, value]) => `${ITEM_META[key].label[0]}:${value}`)
      .join("  ");

    card.innerHTML = `
      <div class="player-title-row">
        <strong>${player.name}${player.isHost ? " (Host)" : ""}</strong>
        <span>${player.score} pts</span>
      </div>
      <p>${player.placementsUsed} placed | ${placementsRemaining}</p>
    `;
    ui.playersList.appendChild(card);
  });
}

function renderResults() {
  const results = state.room?.results;
  if (!results || results.length === 0) {
    ui.resultsList.className = "results-list empty-state";
    ui.resultsList.textContent = "Finish a round to see scores.";
    ui.leaderLabel.textContent = "Waiting";
    ui.winnerSummary.classList.add("hidden");
    ui.winnerSummary.innerHTML = "";
    return;
  }

  ui.resultsList.className = "results-list";
  ui.resultsList.innerHTML = "";
  results.forEach((entry, index) => {
    const card = document.createElement("div");
    card.className = `result-card ${index === 0 ? "winner" : ""}`;
    card.innerHTML = `
      <div class="player-title-row">
        <strong>${index === 0 ? "Winner - " : ""}${entry.name}</strong>
        <span>${entry.score} pts</span>
      </div>
      <p>${entry.breakdown.length > 0 ? entry.breakdown.join(" | ") : "No adjacency bonuses or penalties."}</p>
    `;
    ui.resultsList.appendChild(card);
  });

  const winner = results[0];
  ui.leaderLabel.textContent = `${winner.name} leads`;
  ui.winnerSummary.classList.remove("hidden");
  ui.winnerSummary.innerHTML = `
    <strong>Best layout summary</strong>
    <p>${winner.name} placed ${winner.stats.houses} houses, ${winner.stats.schools} schools, ${winner.stats.hospitals} hospitals, and ${winner.stats.industries} industries.</p>
  `;
}

function updatePlacementHint() {
  if (!state.room) {
    ui.placementHint.textContent = "";
    return;
  }

  if (state.room.phase !== "playing") {
    ui.placementHint.textContent = "Waiting for the round to begin.";
    return;
  }

  const item = ITEM_META[state.selectedItem];
  const left = state.placementsLeft[state.selectedItem] ?? 0;
  ui.placementHint.textContent = `${item.label} selected. Click on the map to place it. ${left} left this round.`;
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
  const phase = state.room?.phase || null;
  const showLanding = !state.room;
  const showWaiting = phase === "lobby" || phase === "results";
  const showGame = phase === "playing";

  ui.landingScreen.classList.toggle("hidden", !showLanding);
  ui.waitingScreen.classList.toggle("hidden", !showWaiting);
  ui.gameScreen.classList.toggle("hidden", !showGame);

  if (!state.room) {
    return;
  }

  ui.waitingRoomCode.textContent = state.room.code;
  ui.roomCodeLabel.textContent = state.room.code;
  ui.waitingPhase.textContent = phase[0].toUpperCase() + phase.slice(1);
  ui.phasePill.textContent = phase[0].toUpperCase() + phase.slice(1);

  const currentPlayer = getCurrentPlayer();
  const isHost = currentPlayer?.isHost;
  ui.startRoundBtn.classList.toggle("hidden", !isHost);
  ui.startRoundBtn.disabled = phase === "playing";
  ui.startRoundBtn.textContent = phase === "results" ? "Start Next Round" : "Start Round";

  setTimer(phase === "playing" ? state.room.endsAt : null);
  renderPlayers();
  renderResults();
  renderPalette();
  renderPlacedItems();
  renderMapPlacements();
  updatePlacementHint();

  if (showGame) {
    window.setTimeout(() => state.map.invalidateSize(), 80);
  }
}

function placeItem(lat, lng) {
  if (!state.room || state.room.phase !== "playing") {
    return;
  }

  socket.emit("game:place", { lat, lng, type: state.selectedItem }, (response) => {
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
    showMessage(`Room ${response.roomCode} created. Share it with your team.`);
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

socket.on("board:update", ({ placements, placementsLeft, currentScore }) => {
  state.placements = placements;
  state.placementsLeft = placementsLeft;
  state.currentScore = currentScore;
  ui.currentScoreLabel.textContent = String(currentScore);
  renderPalette();
  renderPlacedItems();
  renderMapPlacements();
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

ensureMap();
renderPalette();
renderPlacedItems();
