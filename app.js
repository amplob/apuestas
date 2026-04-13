const RACERS = ["Albert", "Aniol", "Marc", "Roger", "Pere", "Gerard", "Yaiza"];
const EXTRA_VOTERS = ["Jose", "Luis", "Cesar", "Flor"];
const VOTERS = [...RACERS, ...EXTRA_VOTERS];
const ADMIN_TOKEN = "kento";

const STORAGE_KEY = "carrera-apuestas-v1";
const APP_CONFIG = window.APP_CONFIG || {};
const REMOTE_DB_URL = APP_CONFIG.remoteDbUrl || "";
const LOCAL_PASSWORD_HASHES = APP_CONFIG.localPasswordHashes || {};

const state = {
  currentUser: null,
  bets: {}, // { usuario: [orden] }
  scores: {}, // { usuario: numero }
  resultOrder: [...RACERS],
  lastBetAt: {}, // { usuario: isoString }
};

let passwordHashes = null;

const currentUserEl = document.getElementById("current-user");
const betListEl = document.getElementById("bet-list");
const resultListEl = document.getElementById("result-list");
const saveBetBtn = document.getElementById("save-bet-btn");
const evaluateBtn = document.getElementById("evaluate-btn");
const userPassEl = document.getElementById("user-pass");
const adminTokenEl = document.getElementById("admin-token");
const betMessageEl = document.getElementById("bet-message");
const adminMessageEl = document.getElementById("admin-message");
const summaryBodyEl = document.getElementById("summary-body");
const betPositionsEl = document.getElementById("bet-positions");
const resultPositionsEl = document.getElementById("result-positions");
const changeUserBtn = document.getElementById("change-user-btn");
const userDialog = document.getElementById("user-dialog");
const userSelect = document.getElementById("user-select");
const userForm = document.getElementById("user-form");

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function normalizeState(input) {
  if (!input || typeof input !== "object") return;

  state.bets = input.bets || {};
  state.scores = input.scores || {};
  state.resultOrder = Array.isArray(input.resultOrder)
    ? input.resultOrder
    : [...RACERS];
  state.currentUser = input.currentUser || null;
  state.lastBetAt = input.lastBetAt || {};
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw);
    normalizeState(parsed);
  } catch {
    // Ignorar estat invalid i continuar amb valors per defecte.
  }
}

async function saveStateRemote() {
  if (!REMOTE_DB_URL) return true;

  try {
    const response = await fetch(`${REMOTE_DB_URL}/state.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return true;
  } catch {
    return false;
  }
}

async function loadStateRemote() {
  if (!REMOTE_DB_URL) return false;

  try {
    const response = await fetch(`${REMOTE_DB_URL}/state.json`, {
      method: "GET",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const remoteState = await response.json();
    normalizeState(remoteState);
    saveState();
    return true;
  } catch {
    return false;
  }
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function formatDateTime(isoDate) {
  if (!isoDate) return "—";
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ca-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function loadPasswordHashes() {
  if (!REMOTE_DB_URL) {
    passwordHashes = LOCAL_PASSWORD_HASHES;
    return Object.keys(passwordHashes).length > 0;
  }
  try {
    const response = await fetch(`${REMOTE_DB_URL}/passwordHashes.json`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    passwordHashes = data && typeof data === "object" ? data : {};
    return true;
  } catch {
    passwordHashes = LOCAL_PASSWORD_HASHES;
    return false;
  }
}

function setMessage(el, text, isError = false) {
  el.textContent = text;
  el.classList.remove("ok", "error");
  if (!text) return;
  el.classList.add(isError ? "error" : "ok");
}

function createTokens(container, order, draggable = true) {
  container.innerHTML = "";
  order.forEach((name) => {
    const token = document.createElement("div");
    token.className = "token";
    token.textContent = name;
    token.dataset.name = name;
    token.draggable = draggable;
    container.appendChild(token);
  });

  if (draggable) enableDragAndDrop(container);
}

function enableDragAndDrop(container) {
  let dragging = null;

  container.querySelectorAll(".token").forEach((token) => {
    token.addEventListener("dragstart", () => {
      dragging = token;
      token.classList.add("dragging");
    });

    token.addEventListener("dragend", () => {
      token.classList.remove("dragging");
      dragging = null;
    });
  });

  container.addEventListener("dragover", (e) => {
    e.preventDefault();
    const after = getDragAfterElement(container, e.clientX);
    if (!dragging) return;
    if (!after) {
      container.appendChild(dragging);
    } else {
      container.insertBefore(dragging, after);
    }
  });
}

function getDragAfterElement(container, x) {
  const draggableElements = [...container.querySelectorAll(".token:not(.dragging)")];
  return draggableElements.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = x - box.left - box.width / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null }
  ).element;
}

function getOrderFromContainer(container) {
  return [...container.querySelectorAll(".token")].map((el) => el.dataset.name);
}

function getPositionMap(order) {
  const pos = {};
  order.forEach((name, i) => {
    pos[name] = i;
  });
  return pos;
}

function getDeltaClass(delta) {
  if (delta === 0) return "delta-0";
  if (delta === 1) return "delta-1";
  if (delta === 2) return "delta-2";
  return "delta-3plus";
}

function renderBetWithDeltas(bet, realPos, showDelta) {
  const chips = bet.map((name, predictedPos) => {
    if (!showDelta || typeof realPos[name] !== "number") {
      return `<span class="runner-chip">${name}</span>`;
    }

    const delta = Math.abs(predictedPos - realPos[name]);
    return `<span class="runner-chip ${getDeltaClass(delta)}">${name} <strong>-${delta}</strong></span>`;
  });

  return `<div class="bet-visual">${chips.join("")}</div>`;
}

function renderPositionLegend() {
  const lastPosition = RACERS.length;
  const slots = RACERS.map((_, index) => {
    const position = lastPosition - index;
    return `${position}º`;
  });

  const text = `${slots.join(" · ")} (esq últim -> dreta primer)`;
  betPositionsEl.textContent = text;
  resultPositionsEl.textContent = text;
}

function updateSummary() {
  summaryBodyEl.innerHTML = "";
  const realPos = getPositionMap(state.resultOrder);

  VOTERS.forEach((user) => {
    const tr = document.createElement("tr");
    const bet = state.bets[user];
    const score = Object.prototype.hasOwnProperty.call(state.scores, user)
      ? state.scores[user]
      : null;
    const betHtml = bet
      ? renderBetWithDeltas(bet, realPos, score !== null)
      : '<span class="no-bet">Sense predicció</span>';
    tr.innerHTML = `
      <td>${user}</td>
      <td>${betHtml}</td>
      <td>${score === null ? "null" : score}</td>
      <td>${formatDateTime(state.lastBetAt[user])}</td>
    `;
    summaryBodyEl.appendChild(tr);
  });
}

function fillUserSelect() {
  userSelect.innerHTML = "";
  VOTERS.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    userSelect.appendChild(option);
  });
}

function showUserDialog() {
  fillUserSelect();
  userSelect.value = state.currentUser || VOTERS[0];
  userDialog.showModal();
}

function setCurrentUser(name) {
  state.currentUser = name;
  currentUserEl.textContent = name;

  const existingBet = state.bets[name] || [...RACERS];
  createTokens(betListEl, existingBet, true);
  saveState();
}

async function saveBet() {
  if (!state.currentUser) {
    setMessage(betMessageEl, "Selecciona usuari abans de predir.", true);
    showUserDialog();
    return;
  }

  const pass = userPassEl.value.trim();
  const passHash = await sha256(`${state.currentUser}:${pass}`);
  const expectedHash = passwordHashes ? passwordHashes[state.currentUser] : null;

  if (!expectedHash || passHash !== expectedHash) {
    setMessage(betMessageEl, "Clau incorrecta per a aquest usuari.", true);
    return;
  }

  state.bets[state.currentUser] = getOrderFromContainer(betListEl);
  state.lastBetAt[state.currentUser] = new Date().toISOString();
  saveState();
  const remoteSaved = await saveStateRemote();
  updateSummary();
  if (remoteSaved) {
    setMessage(betMessageEl, `Predicció guardada per a ${state.currentUser}.`);
  } else if (REMOTE_DB_URL) {
    setMessage(
      betMessageEl,
      "Predicció guardada en aquest navegador, però ha fallat el guardat remot.",
      true
    );
  } else {
    setMessage(
      betMessageEl,
      `Predicció guardada per a ${state.currentUser} (només local).`
    );
  }
  userPassEl.value = "";
}

async function evaluateScores() {
  const token = adminTokenEl.value.trim();
  if (token !== ADMIN_TOKEN) {
    setMessage(adminMessageEl, "Token admin incorrecte.", true);
    return;
  }

  const result = getOrderFromContainer(resultListEl);
  state.resultOrder = result;

  const usersWithBet = VOTERS.filter((u) => Array.isArray(state.bets[u]));
  if (usersWithBet.length === 0) {
    setMessage(adminMessageEl, "No hi ha prediccions guardades per avaluar.", true);
    return;
  }

  const realPos = {};
  result.forEach((name, i) => {
    realPos[name] = i;
  });

  const rawScores = {};
  let minScore = 0;

  usersWithBet.forEach((user) => {
    const bet = state.bets[user];
    let score = 0;
    bet.forEach((name, predictedPos) => {
      score -= Math.abs(predictedPos - realPos[name]);
    });
    rawScores[user] = score;
    if (score < minScore) minScore = score;
  });

  const offset = Math.abs(minScore);
  VOTERS.forEach((user) => {
    if (Object.prototype.hasOwnProperty.call(rawScores, user)) {
      state.scores[user] = rawScores[user] + offset;
    } else {
      state.scores[user] = null;
    }
  });

  saveState();
  const remoteSaved = await saveStateRemote();
  updateSummary();
  if (remoteSaved) {
    setMessage(adminMessageEl, "Avaluació completada.");
  } else if (REMOTE_DB_URL) {
    setMessage(
      adminMessageEl,
      "Avaluació completada localment, però no s'ha pogut guardar remot.",
      true
    );
  } else {
    setMessage(adminMessageEl, "Avaluació completada (només local).");
  }
}

async function init() {
  loadState();
  const remoteLoaded = await loadStateRemote();
  const hashesLoaded = await loadPasswordHashes();
  renderPositionLegend();
  createTokens(resultListEl, state.resultOrder, true);
  updateSummary();

  if (state.currentUser) {
    setCurrentUser(state.currentUser);
  } else {
    currentUserEl.textContent = "-";
    createTokens(betListEl, [...RACERS], true);
  }

  saveBetBtn.addEventListener("click", saveBet);
  evaluateBtn.addEventListener("click", evaluateScores);
  changeUserBtn.addEventListener("click", showUserDialog);

  userForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const selected = userSelect.value;
    setCurrentUser(selected);
    userDialog.close();
    setMessage(betMessageEl, "", false);
  });

  // Requisit: en entrar, sempre preguntar quin usuari vol predir.
  showUserDialog();

  if (!REMOTE_DB_URL) {
    setMessage(
      adminMessageEl,
      "Sense base remota configurada: dades i claus no són compartides.",
      true
    );
  } else if (!hashesLoaded) {
    setMessage(
      adminMessageEl,
      "No s'han pogut carregar les claus hashades de Firebase.",
      true
    );
  } else if (!remoteLoaded) {
    setMessage(
      adminMessageEl,
      "No s'ha pogut llegir l'estat remot, s'usa còpia local si existeix.",
      true
    );
  }
}

init();
