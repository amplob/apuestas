const RACERS = ["Albert", "Aniol", "Marc", "Roger", "Pere", "Gerard", "Yaiza"];
const EXTRA_VOTERS = ["Jose", "Luis", "Cesar", "Flor"];
const VOTERS = [...RACERS, ...EXTRA_VOTERS];
const ADMIN_TOKEN = "kento";
const ADMIN_SESSION_KEY = "carrera-admin-unlocked";

const STORAGE_KEY = "carrera-apuestas-v1";
const ORDER_VERSION = 2;
const APP_CONFIG = window.APP_CONFIG || {};
const REMOTE_DB_URL = APP_CONFIG.remoteDbUrl || "";
const LOCAL_PASSWORD_HASHES = APP_CONFIG.localPasswordHashes || {};

const state = {
  bets: {},
  scores: {},
  resultOrder: [...RACERS],
  lastBetAt: {},
  orderVersion: ORDER_VERSION,
};

let passwordHashes = null;

const betListEl = document.getElementById("bet-list");
const resultListEl = document.getElementById("result-list");
const saveBetBtn = document.getElementById("save-bet-btn");
const evaluateBtn = document.getElementById("evaluate-btn");
const userPassEl = document.getElementById("user-pass");
const betMessageEl = document.getElementById("bet-message");
const adminMessageEl = document.getElementById("admin-message");
const summaryBodyEl = document.getElementById("summary-body");
const betPositionsEl = document.getElementById("bet-positions");
const resultPositionsEl = document.getElementById("result-positions");
const podiumEl = document.getElementById("podium");
const podiumHintEl = document.getElementById("podium-hint");
const adminGateCard = document.getElementById("admin-gate-card");
const adminPanelCard = document.getElementById("admin-panel-card");
const adminGateTokenEl = document.getElementById("admin-gate-token");
const adminUnlockBtn = document.getElementById("admin-unlock-btn");
const adminGateMessageEl = document.getElementById("admin-gate-message");

function cleanStatePayload(src) {
  const s = src || {};
  return {
    bets: { ...(s.bets || {}) },
    scores: { ...(s.scores || {}) },
    resultOrder: Array.isArray(s.resultOrder) ? [...s.resultOrder] : [...RACERS],
    lastBetAt: { ...(s.lastBetAt || {}) },
    orderVersion: ORDER_VERSION,
  };
}

function migrateIfNeeded(obj) {
  if (!obj || typeof obj !== "object") return;
  if (obj.orderVersion === ORDER_VERSION) return;

  if (Array.isArray(obj.resultOrder) && obj.resultOrder.length === RACERS.length) {
    obj.resultOrder = [...obj.resultOrder].reverse();
  }
  const bets = { ...(obj.bets || {}) };
  for (const u of VOTERS) {
    const b = bets[u];
    if (Array.isArray(b) && b.length === RACERS.length) {
      bets[u] = [...b].reverse();
    }
  }
  obj.bets = bets;
  obj.orderVersion = ORDER_VERSION;
}

function saveState() {
  delete state.currentUser;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanStatePayload(state)));
}

function normalizeState(input) {
  if (!input || typeof input !== "object") return;

  state.bets = { ...(input.bets || {}) };
  state.scores = { ...(input.scores || {}) };
  state.resultOrder = Array.isArray(input.resultOrder)
    ? [...input.resultOrder]
    : [...RACERS];
  state.lastBetAt = { ...(input.lastBetAt || {}) };
  state.orderVersion = input.orderVersion;

  migrateIfNeeded(state);
  delete state.currentUser;
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw);
    normalizeState(parsed);
  } catch {
    // Ignorar estat invàlid.
  }
}

async function fetchRemoteStateObject() {
  if (!REMOTE_DB_URL) return {};
  try {
    const response = await fetch(`${REMOTE_DB_URL}/state.json`);
    if (!response.ok) return {};
    const data = await response.json();
    return data && typeof data === "object" ? data : {};
  } catch {
    return null;
  }
}

async function putRemoteState(payload) {
  if (!REMOTE_DB_URL) return true;
  try {
    const response = await fetch(`${REMOTE_DB_URL}/state.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cleanStatePayload(payload)),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Fusiona amb el servidor: només actualitza l'aposta d'un usuari (concurrència segura). */
async function saveUserBetRemote(user) {
  if (!REMOTE_DB_URL) return true;

  const raw = await fetchRemoteStateObject();
  if (raw === null) return false;

  const merged = {
    bets: { ...(raw.bets || {}) },
    scores: { ...(raw.scores || {}) },
    resultOrder: Array.isArray(raw.resultOrder) ? [...raw.resultOrder] : [...RACERS],
    lastBetAt: { ...(raw.lastBetAt || {}) },
    orderVersion: raw.orderVersion,
  };
  migrateIfNeeded(merged);

  merged.bets[user] = state.bets[user];
  merged.lastBetAt[user] = state.lastBetAt[user];
  merged.orderVersion = ORDER_VERSION;

  const ok = await putRemoteState(merged);
  if (ok) {
    normalizeState(merged);
    saveState();
  }
  return ok;
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

async function resolveUserFromCode(pass) {
  if (!passwordHashes || !pass) return null;
  const trimmed = pass.trim();
  for (const user of VOTERS) {
    const expected = passwordHashes[user];
    if (!expected) continue;
    const hash = await sha256(`${user}:${trimmed}`);
    if (hash === expected) return user;
  }
  return null;
}

function setMessage(el, text, isError = false) {
  el.textContent = text;
  el.classList.remove("ok", "error");
  if (!text) return;
  el.classList.add(isError ? "error" : "ok");
}

/** Ordre emmagatzemat i al DOM: índex 0 = 1r (dalt), últim índex = últim (baix) */
function createRankedRows(container, order, draggable) {
  container.innerHTML = "";
  const n = order.length;
  order.forEach((name, index) => {
    const place = index + 1;
    const row = document.createElement("div");
    row.className = "rank-row";
    row.dataset.name = name;

    const badge = document.createElement("span");
    badge.className = "rank-badge";
    badge.textContent = `${place}º`;

    const token = document.createElement("div");
    token.className = "token";
    token.textContent = name;
    token.draggable = draggable;
    token.setAttribute("aria-grabbed", "false");

    row.appendChild(badge);
    row.appendChild(token);
    container.appendChild(row);
  });

  if (draggable) enableVerticalDrag(container);
}

function enableVerticalDrag(container) {
  let draggingRow = null;

  container.querySelectorAll(".rank-row").forEach((row) => {
    const token = row.querySelector(".token");
    token.addEventListener("dragstart", () => {
      draggingRow = row;
      row.classList.add("dragging");
    });
    token.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      draggingRow = null;
    });
  });

  container.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (!draggingRow) return;
    const after = getDragAfterRow(container, e.clientY);
    if (!after) {
      container.appendChild(draggingRow);
    } else {
      container.insertBefore(draggingRow, after);
    }
  });
}

function getDragAfterRow(container, y) {
  const rows = [...container.querySelectorAll(".rank-row:not(.dragging)")];
  return rows.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null }
  ).element;
}

function getOrderFromRankedList(container) {
  return [...container.querySelectorAll(".rank-row")].map((row) => row.dataset.name);
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
    const place = predictedPos + 1;
    const label = `${place}º ${name}`;
    if (!showDelta || typeof realPos[name] !== "number") {
      return `<span class="runner-chip">${label}</span>`;
    }
    const delta = Math.abs(predictedPos - realPos[name]);
    return `<span class="runner-chip ${getDeltaClass(delta)}">${label} <strong>−${delta}</strong></span>`;
  });
  return `<div class="bet-visual bet-visual--stack">${chips.join("")}</div>`;
}

function renderPositionLegend() {
  const n = RACERS.length;
  const parts = [];
  for (let p = 1; p <= n; p++) {
    parts.push(`${p}º`);
  }
  const text = `${parts.join(" → ")} (dalt primer → baix últim)`;
  betPositionsEl.textContent = text;
  resultPositionsEl.textContent = text;
}

function isAdminUnlocked() {
  return sessionStorage.getItem(ADMIN_SESSION_KEY) === "1";
}

function setAdminUnlocked(value) {
  if (value) sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
  else sessionStorage.removeItem(ADMIN_SESSION_KEY);
  syncAdminPanelVisibility();
}

function syncAdminPanelVisibility() {
  const ok = isAdminUnlocked();
  adminGateCard.classList.toggle("hidden", ok);
  adminPanelCard.classList.toggle("hidden", !ok);
  if (ok) {
    adminGateTokenEl.value = "";
    setMessage(adminGateMessageEl, "", false);
  }
}

function tryAdminUnlock() {
  const t = adminGateTokenEl.value.trim();
  if (t !== ADMIN_TOKEN) {
    setMessage(adminGateMessageEl, "Codi incorrecte.", true);
    return;
  }
  setAdminUnlocked(true);
  setMessage(adminGateMessageEl, "", false);
  createRankedRows(resultListEl, state.resultOrder, true);
  renderPositionLegend();
}

function updatePodium() {
  const ranked = VOTERS.filter((u) => typeof state.scores[u] === "number")
    .map((u) => ({ user: u, score: state.scores[u] }))
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) {
    podiumEl.innerHTML = "";
    podiumHintEl.textContent =
      "Quan algú avaluï les prediccions, aquí apareixerà el podi dels pronosticadors.";
    return;
  }

  podiumHintEl.textContent = "Classificació per puntuació (més punts = millor pronòstic).";

  const medals = ["🥈", "🥇", "🥉"];
  const rankIndex = [1, 0, 2];
  const placeClass = [2, 1, 3];

  const blocks = rankIndex.map((ri, slot) => {
    const entry = ranked[ri];
    if (!entry) {
      return `<div class="podium-slot podium-empty podium-place-${placeClass[slot]}"><span class="podium-medal">—</span><span class="podium-name">—</span><span class="podium-score"></span></div>`;
    }
    return `<div class="podium-slot podium-place-${placeClass[slot]}">
      <span class="podium-medal">${medals[slot]}</span>
      <span class="podium-name">${entry.user}</span>
      <span class="podium-score">${entry.score} pts</span>
    </div>`;
  });

  podiumEl.innerHTML = `<div class="podium-stage">${blocks.join("")}</div>`;
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

  updatePodium();
}

function showView(name) {
  document.querySelectorAll(".view-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === name);
  });
  document.querySelectorAll(".view-panel").forEach((panel) => {
    const id = panel.id.replace("view-", "");
    const on = id === name;
    panel.classList.toggle("active", on);
    panel.hidden = !on;
  });

  if (name === "admin") {
    syncAdminPanelVisibility();
    if (isAdminUnlocked()) {
      createRankedRows(resultListEl, state.resultOrder, true);
      renderPositionLegend();
    }
  }
}

async function saveBet() {
  const pass = userPassEl.value.trim();
  const user = await resolveUserFromCode(pass);

  if (!user) {
    setMessage(betMessageEl, "Clau no vàlida o desconeguda.", true);
    return;
  }

  state.bets[user] = getOrderFromRankedList(betListEl);
  state.lastBetAt[user] = new Date().toISOString();
  saveState();
  const remoteSaved = await saveUserBetRemote(user);
  updateSummary();
  if (remoteSaved) {
    setMessage(betMessageEl, `Predicció guardada per a ${user}.`);
  } else if (REMOTE_DB_URL) {
    setMessage(
      betMessageEl,
      "Predicció guardada en aquest navegador, però ha fallat el guardat remot.",
      true
    );
  } else {
    setMessage(
      betMessageEl,
      `Predicció guardada per a ${user} (només local).`
    );
  }
  userPassEl.value = "";
}

async function evaluateScores() {
  if (!isAdminUnlocked()) {
    setMessage(adminMessageEl, "Primer desbloqueja la vista Resoldre.", true);
    return;
  }

  const result = getOrderFromRankedList(resultListEl);

  let merged = {
    bets: { ...state.bets },
    scores: { ...state.scores },
    resultOrder: [...state.resultOrder],
    lastBetAt: { ...state.lastBetAt },
    orderVersion: state.orderVersion,
  };
  migrateIfNeeded(merged);

  if (REMOTE_DB_URL) {
    const raw = await fetchRemoteStateObject();
    if (raw !== null) {
      merged = {
        bets: { ...(raw.bets || {}) },
        scores: { ...(raw.scores || {}) },
        resultOrder: Array.isArray(raw.resultOrder) ? [...raw.resultOrder] : [...RACERS],
        lastBetAt: { ...(raw.lastBetAt || {}) },
        orderVersion: raw.orderVersion,
      };
      migrateIfNeeded(merged);
    }
  }

  const betsForScoring = merged.bets;
  const usersWithBet = VOTERS.filter((u) => Array.isArray(betsForScoring[u]));
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

  usersWithBet.forEach((u) => {
    const bet = betsForScoring[u];
    let score = 0;
    bet.forEach((name, predictedPos) => {
      score -= Math.abs(predictedPos - realPos[name]);
    });
    rawScores[u] = score;
    if (score < minScore) minScore = score;
  });

  const offset = Math.abs(minScore);
  const scores = {};
  VOTERS.forEach((u) => {
    if (Object.prototype.hasOwnProperty.call(rawScores, u)) {
      scores[u] = rawScores[u] + offset;
    } else {
      scores[u] = null;
    }
  });

  const final = {
    bets: merged.bets,
    lastBetAt: merged.lastBetAt,
    resultOrder: result,
    scores,
    orderVersion: ORDER_VERSION,
  };

  state.resultOrder = result;
  state.scores = scores;
  state.bets = merged.bets;
  state.lastBetAt = merged.lastBetAt;
  state.orderVersion = ORDER_VERSION;
  saveState();

  let remoteSaved = true;
  if (REMOTE_DB_URL) {
    remoteSaved = await putRemoteState(final);
    if (remoteSaved) {
      normalizeState(final);
      saveState();
    }
  }

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
  createRankedRows(betListEl, [...RACERS], true);
  if (isAdminUnlocked()) {
    createRankedRows(resultListEl, state.resultOrder, true);
  }
  updateSummary();
  syncAdminPanelVisibility();

  document.querySelectorAll(".view-tab").forEach((btn) => {
    btn.addEventListener("click", () => showView(btn.dataset.view));
  });

  saveBetBtn.addEventListener("click", saveBet);
  evaluateBtn.addEventListener("click", evaluateScores);
  adminUnlockBtn.addEventListener("click", tryAdminUnlock);
  adminGateTokenEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") tryAdminUnlock();
  });

  showView("summary");

  if (!REMOTE_DB_URL) {
    setMessage(
      adminMessageEl,
      "Sense base remota: les dades i les claus no es comparteixen entre dispositius.",
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
      "No s'ha pogut llegir l'estat remot; s'usa còpia local si existeix.",
      true
    );
  }
}

init();
