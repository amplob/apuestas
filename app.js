const PLAYERS = ["Albert", "Aniol", "Marc", "Roger", "Pere", "Gerard", "Yaiza"];
const ADMIN_TOKEN = "token";
const USER_PASSWORDS = {
  Albert: "qmv",
  Aniol: "rtp",
  Marc: "xla",
  Roger: "bne",
  Pere: "kud",
  Gerard: "fsm",
  Yaiza: "hzo",
};

const STORAGE_KEY = "carrera-apuestas-v1";
const APP_CONFIG = window.APP_CONFIG || {};
const REMOTE_DB_URL = APP_CONFIG.remoteDbUrl || "";

const state = {
  currentUser: null,
  bets: {}, // { usuario: [orden] }
  scores: {}, // { usuario: numero }
  resultOrder: [...PLAYERS],
};

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
    : [...PLAYERS];
  state.currentUser = input.currentUser || null;
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw);
    normalizeState(parsed);
  } catch {
    // Ignorar estado invalido y continuar con valores por defecto.
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

function updateSummary() {
  summaryBodyEl.innerHTML = "";
  PLAYERS.forEach((user) => {
    const tr = document.createElement("tr");
    const bet = state.bets[user];
    const score = Object.prototype.hasOwnProperty.call(state.scores, user)
      ? state.scores[user]
      : null;
    tr.innerHTML = `
      <td>${user}</td>
      <td>${bet ? bet.join(" -> ") : "Sin apuesta"}</td>
      <td>${score === null ? "null" : score}</td>
    `;
    summaryBodyEl.appendChild(tr);
  });
}

function fillUserSelect() {
  userSelect.innerHTML = "";
  PLAYERS.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    userSelect.appendChild(option);
  });
}

function showUserDialog() {
  fillUserSelect();
  userSelect.value = state.currentUser || PLAYERS[0];
  userDialog.showModal();
}

function setCurrentUser(name) {
  state.currentUser = name;
  currentUserEl.textContent = name;

  const existingBet = state.bets[name] || [...PLAYERS];
  createTokens(betListEl, existingBet, true);
  saveState();
}

async function saveBet() {
  if (!state.currentUser) {
    setMessage(betMessageEl, "Selecciona usuario antes de apostar.", true);
    showUserDialog();
    return;
  }

  const pass = userPassEl.value.trim().toLowerCase();
  const expected = USER_PASSWORDS[state.currentUser];

  if (pass !== expected) {
    setMessage(betMessageEl, "Clave incorrecta para este usuario.", true);
    return;
  }

  state.bets[state.currentUser] = getOrderFromContainer(betListEl);
  saveState();
  const remoteSaved = await saveStateRemote();
  updateSummary();
  if (remoteSaved) {
    setMessage(betMessageEl, `Apuesta guardada para ${state.currentUser}.`);
  } else if (REMOTE_DB_URL) {
    setMessage(
      betMessageEl,
      "Apuesta guardada en este navegador, pero fallo guardado remoto.",
      true
    );
  } else {
    setMessage(
      betMessageEl,
      `Apuesta guardada para ${state.currentUser} (solo local).`
    );
  }
  userPassEl.value = "";
}

async function evaluateScores() {
  const token = adminTokenEl.value.trim();
  if (token !== ADMIN_TOKEN) {
    setMessage(adminMessageEl, "Token admin incorrecto.", true);
    return;
  }

  const result = getOrderFromContainer(resultListEl);
  state.resultOrder = result;

  const usersWithBet = PLAYERS.filter((u) => Array.isArray(state.bets[u]));
  if (usersWithBet.length === 0) {
    setMessage(adminMessageEl, "No hay apuestas guardadas para evaluar.", true);
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
  PLAYERS.forEach((user) => {
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
    setMessage(adminMessageEl, "Evaluación completada.");
  } else if (REMOTE_DB_URL) {
    setMessage(
      adminMessageEl,
      "Evaluación completada localmente, pero no se pudo guardar remoto.",
      true
    );
  } else {
    setMessage(adminMessageEl, "Evaluación completada (solo local).");
  }
}

async function init() {
  loadState();
  const remoteLoaded = await loadStateRemote();
  createTokens(resultListEl, state.resultOrder, true);
  updateSummary();

  if (state.currentUser) {
    setCurrentUser(state.currentUser);
  } else {
    currentUserEl.textContent = "-";
    createTokens(betListEl, [...PLAYERS], true);
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

  // Requisito: al entrar, siempre preguntar por el usuario que va a votar.
  showUserDialog();

  if (!REMOTE_DB_URL) {
    setMessage(
      adminMessageEl,
      "Sin base remota configurada: los datos se guardan solo en el navegador.",
      true
    );
  } else if (!remoteLoaded) {
    setMessage(
      adminMessageEl,
      "No se pudo leer estado remoto, usando copia local si existe.",
      true
    );
  }
}

init();
