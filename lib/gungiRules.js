export const BOARD_SIZE = 9;
export const MAX_LEVEL = 3;

export const PLAYERS = {
  blue: { label: "Azul", prefix: "B", forward: -1 },
  red: { label: "Rojo", prefix: "R", forward: 1 },
};

export const PIECES = {
  Commander: { label: "Comandante", count: 1, immobile: false },
  Captain: { label: "Capitan", count: 2, immobile: false },
  Samurai: { label: "Samurai", count: 2, immobile: false },
  Spy: { label: "Espia", count: 3, immobile: false, forcedRecovery: true },
  Catapult: { label: "Catapulta", count: 1, immobile: true, levelOneOnly: true },
  Fortress: { label: "Fortaleza", count: 1, immobile: true, levelOneOnly: true },
  HiddenDragon: { label: "Dragon Oculto", count: 1, immobile: false },
  Prodigy: { label: "Prodigio", count: 1, immobile: false },
  Bow: { label: "Arquero", count: 2, immobile: false },
  Pawn: { label: "Peon", count: 9, immobile: false, forcedRecovery: true },
};

export const PIECE_ORDER = [
  "Commander",
  "Captain",
  "Samurai",
  "Spy",
  "Catapult",
  "Fortress",
  "HiddenDragon",
  "Prodigy",
  "Bow",
  "Pawn",
];

export const TIME_CONTROLS = [
  { id: "none", label: "Sin tiempo", baseMs: 0, incrementMs: 0 },
  { id: "1", label: "1 min", baseMs: 60_000, incrementMs: 0 },
  { id: "1+2", label: "1 min + 2 s", baseMs: 60_000, incrementMs: 2_000 },
  { id: "5", label: "5 mins", baseMs: 5 * 60_000, incrementMs: 0 },
  { id: "5+2", label: "5 + 2", baseMs: 5 * 60_000, incrementMs: 2_000 },
  { id: "10", label: "10 mins", baseMs: 10 * 60_000, incrementMs: 0 },
  { id: "10+2", label: "10 + 2", baseMs: 10 * 60_000, incrementMs: 2_000 },
  { id: "15", label: "15 mins", baseMs: 15 * 60_000, incrementMs: 0 },
  { id: "30", label: "30 mins", baseMs: 30 * 60_000, incrementMs: 0 },
];

export const PREVIEW_DELTAS = {
  Commander: [[[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]], [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]], [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]],
  Captain: [[[1, -1], [1, 0], [1, 1], [-1, -1], [-1, 1]], [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]], [[-1, -1], [-1, 1], [1, -1], [1, 1], [0, -2], [0, 2], [2, -2], [2, 2]]],
  Samurai: [[[1, -1], [1, 0], [1, 1], [0, -1], [0, 1]], [[-2, 0], [2, 0], [0, -1], [0, 1], [1, -1], [1, 1]], [[-2, 0], [2, 0], [0, -1], [0, 1], [1, -1], [1, 1]]],
  Spy: [[[2, -1], [2, 1]], [[2, -1], [2, 1], [1, -1], [1, 1]], [[2, -1], [2, 1], [1, -1], [1, 1]]],
  Catapult: [[], [], []],
  Fortress: [[], [], []],
  HiddenDragon: [["orthogonal"], [[-1, -1], [-1, 1], [1, -1], [1, 1]], [[-1, -1], [-1, 1], [1, -1], [1, 1]]],
  Prodigy: [["diagonal"], [[-1, 0], [1, 0], [0, -1], [0, 1]], [[-1, 0], [1, 0], [0, -1], [0, 1]]],
  Bow: [[[2, 0], [0, -2], [0, 2]], [[-1, 0], [1, 0], [2, -2], [2, 2]], [[-2, 0], [2, -2], [2, 2], [0, -2], [0, 2]]],
  Pawn: [[[1, 0]], [[1, 0], [0, -2], [0, 2]], [[1, -1], [1, 1], [0, -2], [0, 2]]],
};

export function createRoomId() {
  const bytes = new Uint8Array(12);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 18);
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export function createInitialState(roomId) {
  const pieces = {};
  const hands = { blue: [], red: [] };
  let id = 1;

  for (const color of Object.keys(PLAYERS)) {
    for (const type of PIECE_ORDER) {
      for (let n = 0; n < PIECES[type].count; n += 1) {
        const pieceId = `${color[0]}${id++}`;
        pieces[pieceId] = { id: pieceId, type, color, origin: color };
        hands[color].push(pieceId);
      }
    }
  }

  return {
    roomId,
    turn: "blue",
    winner: null,
    board: Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => [])),
    hands,
    pieces,
    phase: "setup",
    boardMoveCount: 0,
    moveNumber: 0,
    clock: createClockState("none"),
    log: ["Partida creada."],
  };
}

export function normalizeState(state, roomId) {
  const next = structuredCloneSafe(state);
  next.phase = next.phase || (next.boardMoveCount ? "battle" : "setup");
  next.boardMoveCount = next.boardMoveCount || 0;
  next.moveNumber = next.moveNumber || 0;
  next.roomId = roomId;
  next.clock = normalizeClockState(next.clock);
  if (next.phase !== "battle" && next.hands.blue.length === 0 && next.hands.red.length === 0) {
    next.phase = "battle";
  }
  return next;
}

export function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

export function isSetupPhase(state) {
  return state.phase !== "battle";
}

export function timeControlById(controlId) {
  return TIME_CONTROLS.find((control) => control.id === controlId) || TIME_CONTROLS[0];
}

export function createClockState(controlId) {
  const control = timeControlById(controlId);
  const hasClock = control.id !== "none";
  return {
    controlId: control.id,
    baseMs: control.baseMs,
    incrementMs: control.incrementMs,
    remaining: {
      blue: hasClock ? control.baseMs : null,
      red: hasClock ? control.baseMs : null,
    },
    activeColor: null,
    activeSince: null,
    started: false,
    revision: 0,
  };
}

export function normalizeClockState(clock) {
  if (!clock || !clock.controlId) return createClockState("none");
  const control = timeControlById(clock.controlId);
  const hasClock = control.id !== "none";
  return {
    controlId: control.id,
    baseMs: control.baseMs,
    incrementMs: control.incrementMs,
    remaining: {
      blue: hasClock ? Number(clock.remaining?.blue ?? control.baseMs) : null,
      red: hasClock ? Number(clock.remaining?.red ?? control.baseMs) : null,
    },
    activeColor: clock.activeColor === "blue" || clock.activeColor === "red" ? clock.activeColor : null,
    activeSince: clock.activeSince || null,
    started: Boolean(clock.started),
    revision: Number(clock.revision || 0),
  };
}

export function setTimeControl(state, controlId) {
  const next = structuredCloneSafe(state);
  if (!isSetupPhase(next)) return next;
  const revision = Number(next.clock?.revision || 0) + 1;
  next.clock = createClockState(controlId);
  next.clock.revision = revision;
  next.log.unshift(`Reloj: ${timeControlById(controlId).label}.`);
  return next;
}

export function clockView(state, nowMs = Date.now()) {
  const clock = normalizeClockState(state.clock);
  const remaining = { ...clock.remaining };
  if (clock.controlId !== "none" && clock.activeColor && clock.activeSince && state.phase === "battle" && !state.winner) {
    const activeSinceMs = Date.parse(clock.activeSince);
    if (!Number.isNaN(activeSinceMs)) {
      remaining[clock.activeColor] = Math.max(0, remaining[clock.activeColor] - Math.max(0, nowMs - activeSinceMs));
    }
  }
  return { ...clock, remaining };
}

export function formatClockMs(ms) {
  if (ms == null) return "--:--";
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.ceil(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function applyClockTimeout(state, nowMs = Date.now()) {
  const view = clockView(state, nowMs);
  if (state.winner || view.controlId === "none" || !view.activeColor || view.remaining[view.activeColor] > 0) {
    return state;
  }

  const next = structuredCloneSafe(state);
  next.winner = view.activeColor === "blue" ? "red" : "blue";
  next.clock = {
    ...normalizeClockState(next.clock),
    remaining: view.remaining,
    activeColor: null,
    activeSince: null,
    revision: Number(next.clock?.revision || 0) + 1,
  };
  next.log.unshift(`${PLAYERS[view.activeColor].label} pierde por tiempo.`);
  return next;
}

export function pieceImage(piece) {
  return `/assets/${PLAYERS[piece.color].prefix}${piece.type}.png`;
}

export function topPiece(state, row, col) {
  const stack = state.board[row][col];
  return stack.length ? state.pieces[stack[stack.length - 1]] : null;
}

export function pieceLevel(state, pieceId) {
  for (let r = 0; r < BOARD_SIZE; r += 1) {
    for (let c = 0; c < BOARD_SIZE; c += 1) {
      const index = state.board[r][c].indexOf(pieceId);
      if (index !== -1) return index;
    }
  }
  return 0;
}

export function piecePosition(state, pieceId) {
  for (let r = 0; r < BOARD_SIZE; r += 1) {
    for (let c = 0; c < BOARD_SIZE; c += 1) {
      if (state.board[r][c].includes(pieceId)) return { row: r, col: c };
    }
  }
  return null;
}

function inBounds(row, col) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

function canTarget(state, piece, row, col) {
  if (!inBounds(row, col)) return false;
  const stack = state.board[row][col];
  if (stack.length >= MAX_LEVEL) {
    const top = state.pieces[stack[stack.length - 1]];
    return top.color !== piece.color && top.type !== "Fortress";
  }
  if (!stack.length) return true;
  const top = state.pieces[stack[stack.length - 1]];
  if (top.type === "Fortress" && top.color !== piece.color) return false;
  return top.type !== "Commander" || top.color !== piece.color;
}

function addDeltaTargets(state, piece, row, col, deltas) {
  return deltas
    .map(([dr, dc]) => ({ row: row + dr, col: col + dc }))
    .filter((target) => canTarget(state, piece, target.row, target.col));
}

function rayTargets(state, piece, row, col, directions) {
  const moves = [];
  for (const [dr, dc] of directions) {
    for (let step = 1; step < BOARD_SIZE; step += 1) {
      const nr = row + dr * step;
      const nc = col + dc * step;
      if (!inBounds(nr, nc)) break;
      const stack = state.board[nr][nc];
      if (!stack.length) {
        moves.push({ row: nr, col: nc });
        continue;
      }
      const top = state.pieces[stack[stack.length - 1]];
      if (top.type === "Fortress" && top.color !== piece.color) {
        break;
      }
      if (top.color !== piece.color || (stack.length < MAX_LEVEL && top.type !== "Commander")) {
        moves.push({ row: nr, col: nc });
      }
      break;
    }
  }
  return moves;
}

function movementDeltasForLevel(piece, level) {
  const f = PLAYERS[piece.color].forward;
  switch (piece.type) {
    case "Commander":
      return [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
    case "Captain":
      if (level === 0) return [[f, -1], [f, 0], [f, 1], [-f, -1], [-f, 1]];
      if (level === 1) return [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]];
      return [[-1, -1], [-1, 1], [1, -1], [1, 1], [0, -2], [0, 2], [2 * f, -2], [2 * f, 2]];
    case "Samurai":
      if (level === 0) return [[f, -1], [f, 0], [f, 1], [0, -1], [0, 1]];
      return [[2 * f, 0], [-2 * f, 0], [0, -1], [0, 1], [f, -1], [f, 1]];
    case "Spy":
      if (level === 0) return [[2 * f, -1], [2 * f, 1]];
      return [[2 * f, -1], [2 * f, 1], [f, -1], [f, 1]];
    case "Bow":
      if (level === 0) return [[2 * f, 0], [0, -2], [0, 2]];
      if (level === 1) return [[-1, 0], [1, 0], [2 * f, -2], [2 * f, 2]];
      return [[-2 * f, 0], [2 * f, -2], [2 * f, 2], [0, -2], [0, 2]];
    case "Pawn":
      if (level === 0) return [[f, 0]];
      if (level === 1) return [[f, 0], [0, -2], [0, 2]];
      return [[f, -1], [f, 1], [0, -2], [0, 2]];
    default:
      return [];
  }
}

function movementDeltas(state, piece, level) {
  const pos = piecePosition(state, piece.id);
  if (!pos) return [];
  const deltas = [];
  for (let currentLevel = 0; currentLevel <= level; currentLevel += 1) {
    deltas.push(...movementDeltasForLevel(piece, currentLevel));
  }
  return uniqueTargets(addDeltaTargets(state, piece, pos.row, pos.col, deltas));
}

function uniqueTargets(targets) {
  const seen = new Set();
  return targets.filter((target) => {
    const key = `${target.row}:${target.col}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function canLaunchSegmentTo(state, piece, segmentSize, row, col) {
  if (!inBounds(row, col)) return false;
  const stack = state.board[row][col];
  const top = stack.length ? state.pieces[stack[stack.length - 1]] : null;
  if (top?.type === "Fortress" && top.color !== piece.color) return false;
  if (top?.type === "Commander" && top.color === piece.color) return false;
  const capturedCount = top && top.color !== piece.color ? 1 : 0;
  return stack.length - capturedCount + segmentSize <= MAX_LEVEL;
}

function catapultLaunchTarget(state, pieceId) {
  const piece = state.pieces[pieceId];
  const pos = piecePosition(state, pieceId);
  if (!piece || !pos) return null;
  const stack = state.board[pos.row][pos.col];
  const pieceIndex = stack.indexOf(pieceId);
  const catapult = state.pieces[stack[0]];
  if (pieceIndex <= 0 || pieceIndex !== stack.length - 1 || catapult?.type !== "Catapult" || catapult.color !== piece.color) {
    return null;
  }

  const row = pos.row + PLAYERS[piece.color].forward * 3;
  const col = pos.col;
  const segmentSize = stack.length - 1;
  if (!canLaunchSegmentTo(state, piece, segmentSize, row, col)) return null;
  return { row, col, catapultLaunch: true };
}

export function legalMovesFor(state, pieceId) {
  const piece = state.pieces[pieceId];
  const pos = piecePosition(state, pieceId);
  if (!piece || !pos) return [];
  const stack = state.board[pos.row][pos.col];
  if (stack[stack.length - 1] !== pieceId) return [];
  const level = stack.length - 1;
  if (PIECES[piece.type].immobile) return [];
  let moves;
  if (piece.type === "HiddenDragon") {
    moves = rayTargets(state, piece, pos.row, pos.col, [[-1, 0], [1, 0], [0, -1], [0, 1]]);
    if (level >= 1) moves.push(...addDeltaTargets(state, piece, pos.row, pos.col, [[-1, -1], [-1, 1], [1, -1], [1, 1]]));
  } else if (piece.type === "Prodigy") {
    moves = rayTargets(state, piece, pos.row, pos.col, [[-1, -1], [-1, 1], [1, 1], [1, -1]]);
    if (level >= 1) moves.push(...addDeltaTargets(state, piece, pos.row, pos.col, [[-1, 0], [1, 0], [0, -1], [0, 1]]));
  } else {
    moves = movementDeltas(state, piece, level);
  }

  const launchTarget = catapultLaunchTarget(state, pieceId);
  if (launchTarget) {
    const existing = moves.find((target) => sameTarget(target, launchTarget));
    if (existing) existing.catapultLaunch = true;
    else moves.push(launchTarget);
  }
  return uniqueTargets(moves);
}

export function legalDropsFor(state, pieceId) {
  const piece = state.pieces[pieceId];
  const targets = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const stack = state.board[row][col];
      const ownZone = piece.color === "blue" ? row >= 6 : row <= 2;
      if (!ownZone || stack.length >= MAX_LEVEL) continue;
      if (PIECES[piece.type].levelOneOnly && stack.length !== 0) continue;
      if (stack.some((id) => state.pieces[id].color !== piece.color)) continue;
      if (stack.some((id) => id === pieceId || state.pieces[id].type === "Commander")) continue;
      targets.push({ row, col });
    }
  }
  return targets;
}

export function sameTarget(a, b) {
  return a?.row === b?.row && a?.col === b?.col;
}

export function previewMarks(type, level) {
  const marks = [];
  for (let currentLevel = 0; currentLevel <= level; currentLevel += 1) {
    const raw = PREVIEW_DELTAS[type][currentLevel];
    if (raw[0] === "orthogonal") marks.push(...[[0, 2], [1, 2], [2, 0], [2, 1], [2, 3], [2, 4], [3, 2], [4, 2]]);
    else if (raw[0] === "diagonal") marks.push(...[[0, 0], [1, 1], [3, 3], [4, 4], [0, 4], [1, 3], [3, 1], [4, 0]]);
    else marks.push(...raw.map(([dr, dc]) => [2 + dr, 2 + dc]).filter(([r, c]) => r >= 0 && r < 5 && c >= 0 && c < 5));
  }
  const seen = new Set();
  return marks.filter(([row, col]) => {
    const key = `${row}:${col}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function applyPlacement(state, pieceId, row, col) {
  const next = structuredCloneSafe(state);
  const piece = next.pieces[pieceId];
  next.hands[piece.color] = next.hands[piece.color].filter((id) => id !== pieceId);
  next.board[row][col].push(pieceId);
  next.log.unshift(`${PLAYERS[piece.color].label} coloca ${PIECES[piece.type].label}.`);
  return {
    next,
    action: {
      moveType: "place",
      phase: isSetupPhase(state) ? "setup" : "battle",
      playerColor: piece.color,
      pieceId,
      pieceType: piece.type,
      to: { row, col },
    },
  };
}

function shuffleItems(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function createRandomSetupState(state) {
  const next = createInitialState(state.roomId);
  next.clock = normalizeClockState(state.clock);

  for (const color of Object.keys(PLAYERS)) {
    const orderedPieces = shuffleItems(next.hands[color]);
    for (const pieceId of orderedPieces) {
      const targets = legalDropsFor(next, pieceId);
      if (!targets.length) {
        return createRandomSetupState(state);
      }
      const target = targets[Math.floor(Math.random() * targets.length)];
      next.hands[color] = next.hands[color].filter((id) => id !== pieceId);
      next.board[target.row][target.col].push(pieceId);
    }
  }

  next.phase = "battle";
  next.turn = "blue";
  next.boardMoveCount = 0;
  next.moveNumber = (state.moveNumber || 0) + 1;
  next.winner = null;
  next.clock = {
    ...next.clock,
    activeColor: null,
    activeSince: null,
    started: false,
    revision: Number(next.clock?.revision || 0) + 1,
  };
  next.log = ["Posicionamiento aleatorio completado. La partida ha comenzado.", ...(state.log || []).slice(0, 20)];

  return {
    next,
    action: {
      moveType: "start_battle",
      phase: "setup",
      playerColor: null,
    },
  };
}

export function applyMove(state, pieceId, from, row, col, options = {}) {
  const next = structuredCloneSafe(state);
  const piece = next.pieces[pieceId];
  const fromStack = next.board[from.row][from.col];
  const isCatapultLaunch =
    options.catapultLaunch &&
    fromStack.length > 1 &&
    fromStack[fromStack.length - 1] === pieceId &&
    next.pieces[fromStack[0]]?.type === "Catapult" &&
    next.pieces[fromStack[0]]?.color === piece.color;
  const movingPieceIds = isCatapultLaunch ? fromStack.splice(1) : [fromStack.pop()];
  const targetStack = next.board[row][col];
  let capturedPieceId = null;

  if (targetStack.length && next.pieces[targetStack[targetStack.length - 1]].color !== piece.color) {
    const capturedId = targetStack.pop();
    const captured = next.pieces[capturedId];
    next.hands[piece.color].push(capturedId);
    captured.color = piece.color;
    capturedPieceId = capturedId;
    if (captured.type === "Commander") next.winner = piece.color;
  }

  targetStack.push(...movingPieceIds);
  next.boardMoveCount = (next.boardMoveCount || 0) + 1;
  next.log.unshift(
    isCatapultLaunch
      ? `${PLAYERS[piece.color].label} lanza una torre con Catapulta.`
      : `${PLAYERS[piece.color].label} mueve ${PIECES[piece.type].label}.`,
  );
  return {
    next,
    action: {
      moveType: "move",
      phase: isSetupPhase(state) ? "setup" : "battle",
      playerColor: piece.color,
      pieceId,
      pieceType: piece.type,
      from,
      to: { row, col },
      capturedPieceId,
      catapultLaunch: isCatapultLaunch,
      movedPieceIds: movingPieceIds,
    },
  };
}

function applyClockAfterAction(previousState, completedState, action, nowMs = Date.now()) {
  const clock = normalizeClockState(previousState.clock);
  if (clock.controlId === "none") return completedState;

  const next = completedState;
  const nowIso = new Date(nowMs).toISOString();
  const wasSetup = isSetupPhase(previousState);
  const isBattleNow = next.phase === "battle";

  if (wasSetup || !isBattleNow || next.winner) {
    next.clock = {
      ...clock,
      activeColor: null,
      activeSince: null,
      revision: clock.revision + 1,
    };
    return next;
  }

  if (!clock.started) {
    next.clock = {
      ...clock,
      started: true,
      activeColor: next.turn,
      activeSince: nowIso,
      revision: clock.revision + 1,
    };
    return next;
  }

  const activeColor = clock.activeColor;
  const remaining = { ...clock.remaining };
  if (activeColor && clock.activeSince) {
    const elapsed = Math.max(0, nowMs - Date.parse(clock.activeSince));
    remaining[activeColor] = Math.max(0, remaining[activeColor] - elapsed);
    if (remaining[activeColor] <= 0) {
      next.winner = activeColor === "blue" ? "red" : "blue";
      next.log.unshift(`${PLAYERS[activeColor].label} pierde por tiempo.`);
    } else if (action?.playerColor === activeColor) {
      remaining[activeColor] += clock.incrementMs;
    }
  }

  next.clock = {
    ...clock,
    remaining,
    activeColor: next.winner ? null : next.turn,
    activeSince: next.winner ? null : nowIso,
    revision: clock.revision + 1,
  };
  return next;
}

export function completeAction(state, action) {
  const next = structuredCloneSafe(state);
  if (isSetupPhase(next)) {
    if (next.hands.blue.length === 0 && next.hands.red.length === 0) {
      next.phase = "battle";
      next.turn = "blue";
      next.log.unshift("Ambos jugadores colocaron todas sus piezas. La partida ha comenzado.");
    } else {
      next.turn = next.turn === "blue" ? "red" : "blue";
    }
  } else if (!next.winner) {
    next.turn = next.turn === "blue" ? "red" : "blue";
  }
  applyClockAfterAction(state, next, action);
  next.moveNumber = (next.moveNumber || 0) + 1;
  return { next, action };
}

export function applyPass(state, color) {
  const next = structuredCloneSafe(state);
  next.log.unshift(`${PLAYERS[color].label} pasa el turno.`);
  return completeAction(next, {
    moveType: "pass",
    phase: "battle",
    playerColor: color,
  });
}
