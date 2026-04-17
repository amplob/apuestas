const RACERS = ["Albert", "Aniol", "Marc", "Roger", "Pere", "Gerard", "Yaiza"];
const VOTERS = ["Albert", "Aniol", "Marc", "Roger", "Pere", "Gerard", "Jose", "Luis", "Cesar", "Flor"];
const VIRTUAL_AVG_BETTOR = "Mitjana de la Oficina";
const VIRTUAL_SELF_BETTOR = "Conozco Mi Cuerpo des de los 13";
const VIRTUAL_BETTORS = [VIRTUAL_AVG_BETTOR, VIRTUAL_SELF_BETTOR];
const SCORE_USERS = [...VOTERS, ...VIRTUAL_BETTORS];
const VOTERS_DISPLAY_ORDER = [...SCORE_USERS].sort((a, b) =>
  a.localeCompare(b, "ca", { sensitivity: "accent" })
);
const ADMIN_TOKEN = "kento";

const STORAGE_KEY = "carrera-apuestas-v1";
const ORDER_VERSION = 2;
const APP_CONFIG = window.APP_CONFIG || {};
const REMOTE_DB_URL = APP_CONFIG.remoteDbUrl || "";
const LOCAL_PASSWORD_HASHES = APP_CONFIG.localPasswordHashes || {};
const POSITION_PENALTY = 10;
const MINUTE_PENALTY = 4;
const BET_DEADLINE = new Date("2026-04-17T10:00:00+02:00");

const state = {
  bets: {},
  scores: {},
  resultOrder: [...RACERS],
  resultTimes: {},
  lastBetAt: {},
  orderVersion: ORDER_VERSION,
};

let passwordHashes = null;
let adminUnlocked = false;

const betListEl = document.getElementById("bet-list");
const resultListEl = document.getElementById("result-list");
const saveBetBtn = document.getElementById("save-bet-btn");
const evaluateBtn = document.getElementById("evaluate-btn");
const userPassEl = document.getElementById("user-pass");
const betMessageEl = document.getElementById("bet-message");
const adminMessageEl = document.getElementById("admin-message");
const summaryBodyEl = document.getElementById("summary-body");
const aggregateBodyEl = document.getElementById("aggregate-body");
const betUserSelectEl = document.getElementById("bet-user-select");
const podiumEl = document.getElementById("podium");
const podiumHintEl = document.getElementById("podium-hint");
const iKnowPodiumEl = document.getElementById("iknow-podium");
const iKnowHintEl = document.getElementById("iknow-hint");
const wildCardPodiumEl = document.getElementById("wildcard-podium");
const wildCardHintEl = document.getElementById("wildcard-hint");
const adminGateCard = document.getElementById("admin-gate-card");
const adminPanelCard = document.getElementById("admin-panel-card");
const adminGateTokenEl = document.getElementById("admin-gate-token");
const adminUnlockBtn = document.getElementById("admin-unlock-btn");
const adminGateMessageEl = document.getElementById("admin-gate-message");
const betDeadlineBannerEl = document.getElementById("bet-deadline-banner");
const adminOfficialResultEl = document.getElementById("admin-official-result");
const adminOfficialResultPublicEl = document.getElementById("admin-official-result-public");

function cleanStatePayload(src) {
  const s = src || {};
  return {
    bets: { ...(s.bets || {}) },
    scores: { ...(s.scores || {}) },
    resultOrder: Array.isArray(s.resultOrder) ? [...s.resultOrder] : [...RACERS],
    resultTimes: { ...(s.resultTimes || {}) },
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

  // Migracion de estructura antigua: apuesta como array -> { order, times }
  for (const u of VOTERS) {
    const entry = obj.bets[u];
    if (Array.isArray(entry)) {
      obj.bets[u] = { order: entry, times: {} };
    }
  }

  obj.orderVersion = ORDER_VERSION;
}

function saveState() {
  delete state.currentUser;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanStatePayload(state)));
}

function resetStateToDefaults() {
  state.bets = {};
  state.scores = {};
  state.resultOrder = [...RACERS];
  state.resultTimes = {};
  state.lastBetAt = {};
  state.orderVersion = ORDER_VERSION;
  delete state.currentUser;
}

function normalizeState(input) {
  if (input === null || input === undefined) {
    resetStateToDefaults();
    return;
  }
  if (typeof input !== "object") return;

  state.bets = { ...(input.bets || {}) };
  state.scores = { ...(input.scores || {}) };
  state.resultOrder = Array.isArray(input.resultOrder)
    ? [...input.resultOrder]
    : [...RACERS];
  state.resultTimes = { ...(input.resultTimes || {}) };
  state.lastBetAt = { ...(input.lastBetAt || {}) };
  state.orderVersion = input.orderVersion;

  migrateIfNeeded(state);
  for (const u of VOTERS) {
    const entry = state.bets[u];
    if (Array.isArray(entry)) {
      state.bets[u] = { order: entry, times: {} };
      continue;
    }
    if (entry && typeof entry === "object" && Array.isArray(entry.order)) {
      state.bets[u] = {
        order: entry.order,
        times: entry.times && typeof entry.times === "object" ? entry.times : {},
      };
    }
  }
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
    resultTimes: { ...(raw.resultTimes || {}) },
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
    if (response.status === 404) {
      resetStateToDefaults();
      saveState();
      return true;
    }
    if (!response.ok) {
      return false;
    }
    let remoteState;
    try {
      remoteState = await response.json();
    } catch {
      return false;
    }
    if (remoteState === null || typeof remoteState !== "object") {
      resetStateToDefaults();
      saveState();
      return true;
    }
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

function parseTimeToSeconds(value) {
  const txt = String(value || "").trim();
  if (!txt) return null;

  // Formatos aceptados: mm:ss, m:ss, mm:s, m:s
  if (txt.includes(":")) {
    const parts = txt.split(":");
    if (parts.length !== 2) return null;
    const min = Number(parts[0]);
    const sec = Number(parts[1]);
    if (
      Number.isNaN(min) ||
      Number.isNaN(sec) ||
      min < 0 ||
      min > 59 ||
      sec < 0 ||
      sec > 59
    ) {
      return null;
    }
    return min * 60 + sec;
  }

  // Formato solo dígitos: 3050 -> 30:50, 920 -> 9:20
  const digits = txt.replace(/\D/g, "").slice(0, 4);
  if (!digits) return null;
  const padded = digits.padStart(4, "0");
  const min = Number(padded.slice(0, 2));
  const sec = Number(padded.slice(2));
  if (min > 59 || sec > 59) return null;
  return min * 60 + sec;
}

function digitsToTimeString(digits) {
  const d = String(digits || "")
    .replace(/\D/g, "")
    .slice(0, 4);
  const slots = ["_", "_", ":", "_", "_"];
  if (d[0]) slots[0] = d[0];
  if (d[1]) slots[1] = d[1];
  if (d[2]) slots[3] = d[2];
  if (d[3]) slots[4] = d[3];
  return slots.join("");
}

function timeToDigits(value) {
  const sec = parseTimeToSeconds(value);
  if (sec === null) return "";
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(min).padStart(2, "0")}${String(s).padStart(2, "0")}`;
}

function normalizeTimeInputValue(raw) {
  const digits = String(raw || "")
    .replace(/\D/g, "")
    .slice(0, 4);
  if (!digits) return "";
  return digitsToTimeString(digits);
}

function getCaretPosForDigitsCount(count) {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 3;
  if (count === 3) return 4;
  return 5;
}

function bindTimeInputBehavior(input) {
  if (!input) return;
  input.dataset.digits = String(input.dataset.digits || "");
  input.addEventListener("focus", () => {
    const digits = String(input.dataset.digits || "").replace(/\D/g, "").slice(0, 4);
    input.dataset.digits = digits;
    input.value = digitsToTimeString(digits);
    const caret = getCaretPosForDigitsCount(digits.length);
    requestAnimationFrame(() => input.setSelectionRange(caret, caret));
  });

  input.addEventListener("click", (e) => {
    e.preventDefault();
    const digits = String(input.dataset.digits || "").replace(/\D/g, "").slice(0, 4);
    const caret = getCaretPosForDigitsCount(digits.length);
    input.setSelectionRange(caret, caret);
  });

  input.addEventListener("keydown", (e) => {
    const isDigit = /^[0-9]$/.test(e.key);
    const navKeys = ["Tab", "ArrowLeft", "ArrowRight", "Home", "End"];
    if (navKeys.includes(e.key)) return;

    if (isDigit) {
      e.preventDefault();
      let digits = String(input.dataset.digits || "").replace(/\D/g, "").slice(0, 4);
      digits = (digits + e.key).slice(0, 4);
      input.dataset.digits = digits;
      input.value = digitsToTimeString(digits);
      const caret = getCaretPosForDigitsCount(digits.length);
      input.setSelectionRange(caret, caret);
      return;
    }

    if (e.key === "Backspace") {
      e.preventDefault();
      let digits = String(input.dataset.digits || "").replace(/\D/g, "").slice(0, 4);
      digits = digits.slice(0, -1);
      input.dataset.digits = digits;
      input.value = digits ? digitsToTimeString(digits) : "";
      const caret = getCaretPosForDigitsCount(digits.length);
      if (digits) input.setSelectionRange(caret, caret);
      return;
    }

    if (e.key === "Delete") {
      e.preventDefault();
      input.dataset.digits = "";
      input.value = "";
      return;
    }
  });

  input.addEventListener("paste", (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData?.getData("text") || "")
      .replace(/\D/g, "")
      .slice(0, 4);
    input.dataset.digits = pasted;
    input.value = pasted ? digitsToTimeString(pasted) : "";
    const caret = getCaretPosForDigitsCount(pasted.length);
    if (pasted) input.setSelectionRange(caret, caret);
  });

  input.addEventListener("blur", () => {
    const digits = String(input.dataset.digits || "")
      .replace(/\D/g, "")
      .slice(0, 4);
    input.dataset.digits = digits;
    input.value = digits ? digitsToTimeString(digits) : "";
  });
}

function formatSeconds(seconds) {
  if (typeof seconds !== "number" || Number.isNaN(seconds)) return "--:--";
  const bounded = Math.max(0, Math.min(3599, Math.round(seconds)));
  const min = Math.floor(bounded / 60);
  const sec = bounded % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
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

function getRemainingMsToDeadline() {
  return BET_DEADLINE.getTime() - Date.now();
}

function formatRemaining(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${h}h ${m}m ${s}s`;
  return `${h}h ${m}m ${s}s`;
}

function isBettingClosed() {
  return getRemainingMsToDeadline() <= 0;
}

function setBettingDisabled(disabled) {
  saveBetBtn.disabled = disabled;
  if (betUserSelectEl) betUserSelectEl.disabled = disabled;
  userPassEl.disabled = disabled;
  betListEl.querySelectorAll(".time-input").forEach((el) => {
    el.disabled = disabled;
  });
}

function updateDeadlineBanner() {
  if (!betDeadlineBannerEl) return;
  const remaining = getRemainingMsToDeadline();
  if (remaining <= 0) {
    betDeadlineBannerEl.textContent = "Les apostes estan tancades.";
    betDeadlineBannerEl.classList.add("closed");
    setBettingDisabled(true);
    return;
  }
  betDeadlineBannerEl.textContent = `Falten ${formatRemaining(
    remaining
  )} perquè es tanquin les apostes (divendres 17, 10:00).`;
  betDeadlineBannerEl.classList.remove("closed");
  setBettingDisabled(false);
}

/** Ordre emmagatzemat i al DOM: índex 0 = 1r (dalt), últim índex = últim (baix) */
function createRankedRows(container, order, draggable, times = {}) {
  container.innerHTML = "";
  container.classList.add("token-list--ranked");

  const n = order.length;
  const inner = document.createElement("div");
  inner.className = "rank-ladder-inner";

  const badgesCol = document.createElement("div");
  badgesCol.className = "rank-badges-col";
  badgesCol.setAttribute("aria-hidden", "true");

  const tokensWrap = document.createElement("div");
  tokensWrap.className = "rank-tokens-wrap";

  for (let i = 0; i < n; i++) {
    const place = i + 1;
    const badge = document.createElement("span");
    badge.className = "rank-badge";
    badge.textContent = `${place}º`;
    badgesCol.appendChild(badge);

    const name = order[i];
    const row = document.createElement("div");
    row.className = "rank-row";
    row.dataset.name = name;

    const token = document.createElement("div");
    token.className = "token";
    token.textContent = name;
    token.draggable = draggable;
    token.setAttribute("aria-grabbed", "false");

    const timeInput = document.createElement("input");
    timeInput.className = "time-input";
    timeInput.type = "text";
    timeInput.placeholder = "mm:ss";
    timeInput.inputMode = "numeric";
    timeInput.maxLength = 5;
    if (times && typeof times[name] === "number") {
      timeInput.value = formatSeconds(times[name]);
      timeInput.dataset.digits = timeToDigits(timeInput.value);
    } else {
      timeInput.dataset.digits = "";
    }
    bindTimeInputBehavior(timeInput);

    row.appendChild(token);
    row.appendChild(timeInput);
    tokensWrap.appendChild(row);
  }

  inner.appendChild(badgesCol);
  inner.appendChild(tokensWrap);
  container.appendChild(inner);

  if (draggable) enableVerticalDrag(tokensWrap);
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
  const wrap = container.querySelector(".rank-tokens-wrap");
  const root = wrap || container;
  return [...root.querySelectorAll(".rank-row")].map((row) => row.dataset.name);
}

function getTimesFromRankedList(container) {
  const wrap = container.querySelector(".rank-tokens-wrap");
  const root = wrap || container;
  const out = {};
  const rows = [...root.querySelectorAll(".rank-row")];
  for (const row of rows) {
    const name = row.dataset.name;
    const input = row.querySelector(".time-input");
    if (input) input.value = normalizeTimeInputValue(input.value);
    const seconds = parseTimeToSeconds(input ? input.value : "");
    if (seconds === null) return null;
    out[name] = seconds;
  }
  return out;
}

function getPositionMap(order) {
  const pos = {};
  order.forEach((name, i) => {
    pos[name] = i;
  });
  return pos;
}

function getBetEntryForUser(user) {
  const entry = state.bets[user];
  if (!entry || !Array.isArray(entry.order)) return null;
  return {
    order: entry.order,
    times: entry.times && typeof entry.times === "object" ? entry.times : {},
  };
}

function computeAverageBetFromCurrentBets(bets) {
  const source = bets || {};
  const validEntries = VOTERS.map((u) => source[u]).filter(
    (entry) => entry && Array.isArray(entry.order) && entry.order.length === RACERS.length
  );
  if (validEntries.length === 0) return null;

  const posAgg = {};
  const timeAgg = {};
  RACERS.forEach((r) => {
    posAgg[r] = { sum: 0, count: 0 };
    timeAgg[r] = { sum: 0, count: 0 };
  });

  validEntries.forEach((entry) => {
    entry.order.forEach((racer, idx) => {
      if (!posAgg[racer]) return;
      posAgg[racer].sum += idx;
      posAgg[racer].count += 1;
      const sec =
        entry.times && typeof entry.times[racer] === "number"
          ? entry.times[racer]
          : null;
      if (sec !== null) {
        timeAgg[racer].sum += sec;
        timeAgg[racer].count += 1;
      }
    });
  });

  const avgPosIdx = {};
  const times = {};
  RACERS.forEach((r) => {
    avgPosIdx[r] = posAgg[r].count ? posAgg[r].sum / posAgg[r].count : RACERS.length - 1;
    if (timeAgg[r].count) {
      times[r] = timeAgg[r].sum / timeAgg[r].count;
    }
  });

  const order = [...RACERS].sort((a, b) => {
    const d = avgPosIdx[a] - avgPosIdx[b];
    if (d !== 0) return d;
    return a.localeCompare(b, "ca");
  });

  return { order, times, avgPosIdx };
}

function computeSelfKnowledgeBetFromCurrentBets(bets, averageBet) {
  const source = bets || {};
  const times = {};
  const avgPosIdx = averageBet && averageBet.avgPosIdx ? averageBet.avgPosIdx : {};
  const avgTimes = averageBet && averageBet.times ? averageBet.times : {};

  RACERS.forEach((racer) => {
    const ownEntry = source[racer];
    const ownTime =
      ownEntry &&
      ownEntry.times &&
      typeof ownEntry.times[racer] === "number"
        ? ownEntry.times[racer]
        : null;
    if (ownTime !== null) {
      times[racer] = ownTime;
    } else if (typeof avgTimes[racer] === "number") {
      // Fallback per corredors sense aposta pròpia (p. ex. Yaiza)
      times[racer] = avgTimes[racer];
    }
  });

  const randomTie = {};
  RACERS.forEach((r) => {
    randomTie[r] = Math.random();
  });

  const order = [...RACERS].sort((a, b) => {
    const ta = typeof times[a] === "number" ? times[a] : Number.POSITIVE_INFINITY;
    const tb = typeof times[b] === "number" ? times[b] : Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;

    const pa = typeof avgPosIdx[a] === "number" ? avgPosIdx[a] : Number.POSITIVE_INFINITY;
    const pb = typeof avgPosIdx[b] === "number" ? avgPosIdx[b] : Number.POSITIVE_INFINITY;
    if (pa !== pb) return pa - pb;

    const ata = typeof avgTimes[a] === "number" ? avgTimes[a] : Number.POSITIVE_INFINITY;
    const atb = typeof avgTimes[b] === "number" ? avgTimes[b] : Number.POSITIVE_INFINITY;
    if (ata !== atb) return ata - atb;

    // Tie-break final aleatori per gestionar empats múltiples sense errors.
    return randomTie[a] - randomTie[b];
  });

  return { order, times };
}

function getDeltaClass(delta) {
  if (delta === 0) return "delta-0";
  if (delta === 1) return "delta-1";
  if (delta === 2) return "delta-2";
  return "delta-3plus";
}

function getPenaltyClass(totalPenalty) {
  if (totalPenalty < 5) return "delta-best";
  if (totalPenalty <= 10) return "delta-0";
  if (totalPenalty <= 25) return "delta-1";
  if (totalPenalty <= 40) return "delta-2";
  if (totalPenalty <= 55) return "delta-3plus";
  return "delta-4plus";
}

function fmtNum(value, decimals = 1) {
  const n = Number(value);
  if (Number.isNaN(n)) return "0";
  return Number(n.toFixed(decimals)).toString();
}

function renderBetWithDeltas(
  bet,
  betTimes,
  realPos,
  realTimes,
  showDelta,
  posOverride = null
) {
  const chips = bet.map((name, predictedPos) => {
    const predictedIndex =
      posOverride && typeof posOverride[name] === "number"
        ? posOverride[name]
        : predictedPos;
    const place = predictedIndex + 1;
    const placeText =
      posOverride && typeof posOverride[name] === "number"
        ? place.toFixed(2)
        : String(Math.round(place));
    const timeTxt = formatSeconds(betTimes ? betTimes[name] : null);
    const label = `${placeText}º ${name} (${timeTxt})`;
    if (!showDelta || typeof realPos[name] !== "number") {
      return `<span class="runner-chip">${label}</span>`;
    }
    const delta = Math.abs(predictedIndex - realPos[name]);
    const real = realTimes && typeof realTimes[name] === "number" ? realTimes[name] : null;
    const minuteDelta =
      real === null || typeof betTimes[name] !== "number"
        ? null
        : Math.abs(real - betTimes[name]) / 60;
    const minutePenalty =
      minuteDelta === null ? 0 : Number((minuteDelta * MINUTE_PENALTY).toFixed(1));
    const posPenalty = delta * POSITION_PENALTY;
    const totalPenalty = Number((posPenalty + minutePenalty).toFixed(1));
    const deltaTxt = fmtNum(delta, 2);
    const minuteTxt = fmtNum(minutePenalty, 1);
    const totalTxt = fmtNum(totalPenalty, 1);
    const breakdown =
      minuteDelta === null
        ? `−(${deltaTxt}*${POSITION_PENALTY} + 0.0) = −${totalTxt}`
        : `−(${deltaTxt}*${POSITION_PENALTY} + ${minuteTxt}) = −${totalTxt}`;
    return `<span class="runner-chip ${getPenaltyClass(totalPenalty)}">${label} <strong>${breakdown}</strong></span>`;
  });
  return `<div class="bet-visual bet-visual--stack">${chips.join("")}</div>`;
}

function populateBetUserSelect() {
  if (!betUserSelectEl) return;
  betUserSelectEl.innerHTML = "";
  [...VOTERS].sort((a, b) => a.localeCompare(b, "ca")).forEach((u) => {
    const opt = document.createElement("option");
    opt.value = u;
    opt.textContent = u;
    betUserSelectEl.appendChild(opt);
  });
}

function loadBetForSelectedUser() {
  if (!betUserSelectEl) return;
  const user = betUserSelectEl.value;
  const entry = getBetEntryForUser(user);
  if (entry) {
    createRankedRows(betListEl, entry.order, true, entry.times);
  } else {
    createRankedRows(betListEl, [...RACERS], true, {});
  }
}

function isAdminUnlocked() {
  return adminUnlocked;
}

function setAdminUnlocked(value) {
  adminUnlocked = Boolean(value);
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
  createRankedRows(resultListEl, state.resultOrder, true, state.resultTimes);
  updateAdminOfficialResultPreview();
}

function updateAdminOfficialResultPreview() {
  const hasOrder =
    Array.isArray(state.resultOrder) && state.resultOrder.length === RACERS.length;
  if (!hasOrder) {
    const emptyHtml = '<span class="no-bet">Encara no hi ha resultat oficial avaluat.</span>';
    if (adminOfficialResultEl) adminOfficialResultEl.innerHTML = emptyHtml;
    if (adminOfficialResultPublicEl) adminOfficialResultPublicEl.innerHTML = emptyHtml;
    return;
  }
  const chips = state.resultOrder.map((name, idx) => {
    const sec = state.resultTimes && typeof state.resultTimes[name] === "number" ? state.resultTimes[name] : null;
    const timeTxt = sec === null ? "—:—" : formatSeconds(sec);
    return `<span class="runner-chip">${idx + 1}º ${name} (${timeTxt})</span>`;
  });
  const html = `<div class="bet-visual bet-visual--stack">${chips.join("")}</div>`;
  if (adminOfficialResultEl) adminOfficialResultEl.innerHTML = html;
  if (adminOfficialResultPublicEl) adminOfficialResultPublicEl.innerHTML = html;
}

function updatePodium() {
  const ranked = SCORE_USERS.filter((u) => typeof state.scores[u] === "number")
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

function renderRacerPenaltyPodium(container, ranked) {
  if (!container) return;
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
      <span class="podium-name">${entry.racer}</span>
      <span class="podium-score">${entry.penalty.toFixed(1)} pts perduts</span>
    </div>`;
  });
  container.innerHTML = `<div class="podium-stage">${blocks.join("")}</div>`;
}

function updateRacerPenaltyPodiums() {
  if (!iKnowPodiumEl || !wildCardPodiumEl || !iKnowHintEl || !wildCardHintEl) return;
  const hasScores = SCORE_USERS.some((u) => typeof state.scores[u] === "number");
  if (!hasScores) {
    iKnowHintEl.textContent = "Cal avaluar resultats per veure aquest podi.";
    wildCardHintEl.textContent = "Cal avaluar resultats per veure aquest podi.";
    iKnowPodiumEl.innerHTML = "";
    wildCardPodiumEl.innerHTML = "";
    return;
  }

  const realPos = getPositionMap(state.resultOrder);
  const totals = {};
  RACERS.forEach((r) => {
    totals[r] = 0;
  });

  const averageBet = computeAverageBetFromCurrentBets(state.bets);
  const selfKnowledgeBet = computeSelfKnowledgeBetFromCurrentBets(state.bets, averageBet);
  const entries = {};
  VOTERS.forEach((u) => {
    entries[u] = state.bets[u];
  });
  if (averageBet) entries[VIRTUAL_AVG_BETTOR] = averageBet;
  if (selfKnowledgeBet) entries[VIRTUAL_SELF_BETTOR] = selfKnowledgeBet;

  SCORE_USERS.forEach((u) => {
    const entry = entries[u];
    if (!entry || !Array.isArray(entry.order) || entry.order.length !== RACERS.length) return;
    const betTimes = entry.times || {};
    entry.order.forEach((name, predictedPos) => {
      if (typeof realPos[name] !== "number") return;
      let penalty = Math.abs(predictedPos - realPos[name]) * POSITION_PENALTY;
      const predictedSec = betTimes[name];
      const realSec = state.resultTimes[name];
      if (typeof predictedSec === "number" && typeof realSec === "number") {
        penalty += (Math.abs(predictedSec - realSec) / 60) * MINUTE_PENALTY;
      }
      totals[name] += penalty;
    });
  });

  const rankedBest = RACERS.map((racer) => ({ racer, penalty: totals[racer] }))
    .sort((a, b) => a.penalty - b.penalty)
    .slice(0, 3);
  const rankedWorst = RACERS.map((racer) => ({ racer, penalty: totals[racer] }))
    .sort((a, b) => b.penalty - a.penalty)
    .slice(0, 3);

  iKnowHintEl.textContent = "Corredors que han fet perdre menys punts en total.";
  wildCardHintEl.textContent = "Corredors que han fet perdre més punts en total.";
  renderRacerPenaltyPodium(iKnowPodiumEl, rankedBest);
  renderRacerPenaltyPodium(wildCardPodiumEl, rankedWorst);
}

function updateSummary() {
  summaryBodyEl.innerHTML = "";
  const realPos = getPositionMap(state.resultOrder);
  const averageBet = computeAverageBetFromCurrentBets(state.bets);
  const selfKnowledgeBet = computeSelfKnowledgeBetFromCurrentBets(state.bets, averageBet);

  const renderSummaryRow = (user, isVirtual) => {
    const tr = document.createElement("tr");
    const entry =
      user === VIRTUAL_AVG_BETTOR
        ? averageBet
        : user === VIRTUAL_SELF_BETTOR
          ? selfKnowledgeBet
          : state.bets[user];
    const bet = entry && Array.isArray(entry.order) ? entry.order : null;
    const betTimes = entry && entry.times ? entry.times : {};
    const score = Object.prototype.hasOwnProperty.call(state.scores, user)
      ? state.scores[user]
      : null;
    const scoreText = score === null ? "null" : Number(score).toFixed(2);
    const betHtml = bet
      ? renderBetWithDeltas(
          bet,
          betTimes,
          realPos,
          state.resultTimes,
          score !== null,
          user === VIRTUAL_AVG_BETTOR && averageBet ? averageBet.avgPosIdx : null
        )
      : '<span class="no-bet">Sense predicció</span>';
    const lastBetText = isVirtual ? "—" : formatDateTime(state.lastBetAt[user]);
    const icon = isVirtual ? "🤖" : "👤";
    tr.innerHTML = `
      <td>${icon} ${user}</td>
      <td>${betHtml}</td>
      <td>${scoreText}</td>
      <td>${lastBetText}</td>
    `;
    summaryBodyEl.appendChild(tr);
  };

  [...VOTERS].sort((a, b) => a.localeCompare(b, "ca")).forEach((user) => {
    renderSummaryRow(user, false);
  });

  const sep = document.createElement("tr");
  sep.innerHTML = `<td colspan="4" class="summary-separator">🤖 Apostadors virtuals</td>`;
  summaryBodyEl.appendChild(sep);

  VIRTUAL_BETTORS.forEach((user) => {
    renderSummaryRow(user, true);
  });

  updatePodium();
  updateRacerPenaltyPodiums();
  updateAggregateSummary();
  updateAdminOfficialResultPreview();
}

function updateAggregateSummary() {
  aggregateBodyEl.innerHTML = "";
  const stats = {};
  RACERS.forEach((r) => {
    stats[r] = { posSum: 0, posCount: 0, timeSum: 0, timeCount: 0 };
  });

  for (const user of VOTERS) {
    const entry = state.bets[user];
    if (!entry || !Array.isArray(entry.order)) continue;
    entry.order.forEach((racer, idx) => {
      if (!stats[racer]) return;
      stats[racer].posSum += idx + 1;
      stats[racer].posCount += 1;
      const sec = entry.times && typeof entry.times[racer] === "number" ? entry.times[racer] : null;
      if (sec !== null) {
        stats[racer].timeSum += sec;
        stats[racer].timeCount += 1;
      }
    });
  }

  const rows = RACERS.map((r) => {
    const s = stats[r];
    if (!s.posCount) {
      return { racer: r, posCount: 0, timeCount: 0, avgPos: null, avgSec: null };
    }
    return {
      racer: r,
      posCount: s.posCount,
      timeCount: s.timeCount,
      avgPos: s.posSum / s.posCount,
      avgSec: s.timeCount > 0 ? s.timeSum / s.timeCount : null,
    };
  }).sort((a, b) => {
    if (a.avgPos === null && b.avgPos === null) return a.racer.localeCompare(b.racer, "ca");
    if (a.avgPos === null) return 1;
    if (b.avgPos === null) return -1;
    return a.avgPos - b.avgPos;
  });

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const posText =
      row.avgPos === null ? "—" : `${row.avgPos.toFixed(2)} / ${row.posCount} pred.`;
    const timeText =
      row.avgSec === null ? "—" : `${formatSeconds(row.avgSec)} / ${row.timeCount} temps`;
    tr.innerHTML = `
      <td>${row.racer}</td>
      <td>${posText}</td>
      <td>${timeText}</td>
    `;
    aggregateBodyEl.appendChild(tr);
  });
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
    updateAdminOfficialResultPreview();
    if (isAdminUnlocked()) {
      createRankedRows(resultListEl, state.resultOrder, true, state.resultTimes);
    }
  }
}

async function saveBet() {
  if (isBettingClosed()) {
    updateDeadlineBanner();
    setMessage(betMessageEl, "Les apostes ja estan tancades.", true);
    return;
  }

  const pass = userPassEl.value.trim();
  const user = await resolveUserFromCode(pass);

  if (!user) {
    setMessage(betMessageEl, "Clau no vàlida o desconeguda.", true);
    return;
  }

  const order = getOrderFromRankedList(betListEl);
  const times = getTimesFromRankedList(betListEl);
  if (!times) {
    setMessage(
      betMessageEl,
      "Temps invàlids. Usa format mm:ss (exemple 34:20, màxim 59:59).",
      true
    );
    return;
  }

  state.bets[user] = { order, times };
  state.lastBetAt[user] = new Date().toISOString();
  saveState();
  const remoteSaved = await saveUserBetRemote(user);
  if (betUserSelectEl) {
    betUserSelectEl.value = user;
    loadBetForSelectedUser();
  }
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
  const resultTimes = getTimesFromRankedList(resultListEl);
  if (!resultTimes) {
    setMessage(
      adminMessageEl,
      "Temps reals invàlids. Usa format mm:ss (exemple 34:20, màxim 59:59).",
      true
    );
    return;
  }

  let merged = {
    bets: { ...state.bets },
    scores: { ...state.scores },
    resultOrder: [...state.resultOrder],
    resultTimes: { ...state.resultTimes },
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
        resultTimes: { ...(raw.resultTimes || {}) },
        lastBetAt: { ...(raw.lastBetAt || {}) },
        orderVersion: raw.orderVersion,
      };
      migrateIfNeeded(merged);
    }
  }

  const betsForScoring = merged.bets;
  const usersWithBet = VOTERS.filter((u) => {
    const entry = betsForScoring[u];
    return entry && Array.isArray(entry.order) && entry.order.length === RACERS.length;
  });
  if (usersWithBet.length === 0) {
    setMessage(adminMessageEl, "No hi ha prediccions guardades per avaluar.", true);
    return;
  }

  const realPos = {};
  result.forEach((name, i) => {
    realPos[name] = i;
  });

  const rawScores = {};

  usersWithBet.forEach((u) => {
    const entry = betsForScoring[u];
    const bet = entry.order;
    const betTimes = entry.times || {};
    let penalty = 0;
    bet.forEach((name, predictedPos) => {
      penalty += Math.abs(predictedPos - realPos[name]) * POSITION_PENALTY;
      const predictedSec = betTimes[name];
      const realSec = resultTimes[name];
      if (typeof predictedSec === "number" && typeof realSec === "number") {
        penalty += (Math.abs(predictedSec - realSec) / 60) * MINUTE_PENALTY;
      }
    });
    const score = 250 - penalty;
    rawScores[u] = Math.round(score * 100) / 100;
  });

  const scores = {};
  VOTERS.forEach((u) => {
    if (Object.prototype.hasOwnProperty.call(rawScores, u)) {
      scores[u] = rawScores[u];
    } else {
      scores[u] = null;
    }
  });

  const averageBet = computeAverageBetFromCurrentBets(merged.bets);
  if (averageBet) {
    let avgPenalty = 0;
    RACERS.forEach((racer) => {
      const predictedIdx = averageBet.avgPosIdx[racer];
      avgPenalty += Math.abs(predictedIdx - realPos[racer]) * POSITION_PENALTY;
      const predictedSec =
        typeof averageBet.times[racer] === "number" ? averageBet.times[racer] : null;
      const realSec = resultTimes[racer];
      if (predictedSec !== null && typeof realSec === "number") {
        avgPenalty += (Math.abs(predictedSec - realSec) / 60) * MINUTE_PENALTY;
      }
    });
    scores[VIRTUAL_AVG_BETTOR] = Math.round((250 - avgPenalty) * 100) / 100;
  } else {
    scores[VIRTUAL_AVG_BETTOR] = null;
  }

  const selfKnowledgeBet = computeSelfKnowledgeBetFromCurrentBets(merged.bets, averageBet);
  if (selfKnowledgeBet && Array.isArray(selfKnowledgeBet.order)) {
    const selfPos = {};
    selfKnowledgeBet.order.forEach((racer, idx) => {
      selfPos[racer] = idx;
    });
    let selfPenalty = 0;
    RACERS.forEach((racer) => {
      const predictedIdx =
        typeof selfPos[racer] === "number" ? selfPos[racer] : RACERS.length - 1;
      selfPenalty += Math.abs(predictedIdx - realPos[racer]) * POSITION_PENALTY;
      const predictedSec =
        typeof selfKnowledgeBet.times[racer] === "number"
          ? selfKnowledgeBet.times[racer]
          : null;
      const realSec = resultTimes[racer];
      if (predictedSec !== null && typeof realSec === "number") {
        selfPenalty += (Math.abs(predictedSec - realSec) / 60) * MINUTE_PENALTY;
      }
    });
    scores[VIRTUAL_SELF_BETTOR] = Math.round((250 - selfPenalty) * 100) / 100;
  } else {
    scores[VIRTUAL_SELF_BETTOR] = null;
  }

  const final = {
    bets: merged.bets,
    lastBetAt: merged.lastBetAt,
    resultOrder: result,
    resultTimes,
    scores,
    orderVersion: ORDER_VERSION,
  };

  state.resultOrder = result;
  state.resultTimes = resultTimes;
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
  const hashesLoaded = await loadPasswordHashes();

  let remoteLoaded = false;
  if (REMOTE_DB_URL) {
    remoteLoaded = await loadStateRemote();
    if (!remoteLoaded) {
      loadState();
    }
  } else {
    loadState();
  }

  populateBetUserSelect();
  loadBetForSelectedUser();
  if (isAdminUnlocked()) {
    createRankedRows(resultListEl, state.resultOrder, true, state.resultTimes);
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
  if (betUserSelectEl) {
    betUserSelectEl.addEventListener("change", loadBetForSelectedUser);
  }

  updateDeadlineBanner();
  setInterval(updateDeadlineBanner, 1000);

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
