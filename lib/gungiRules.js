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
    log: ["Partida creada."],
  };
}

export function normalizeState(state, roomId) {
  const next = structuredCloneSafe(state);
  next.phase = next.phase || (next.boardMoveCount ? "battle" : "setup");
  next.boardMoveCount = next.boardMoveCount || 0;
  next.moveNumber = next.moveNumber || 0;
  next.roomId = roomId;
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
    return top.color !== piece.color;
  }
  if (!stack.length) return true;
  const top = state.pieces[stack[stack.length - 1]];
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
      if (top.color !== piece.color || (stack.length < MAX_LEVEL && top.type !== "Commander")) {
        moves.push({ row: nr, col: nc });
      }
      break;
    }
  }
  return moves;
}

function movementDeltas(state, piece, level) {
  const pos = piecePosition(state, piece.id);
  if (!pos) return [];
  const f = PLAYERS[piece.color].forward;
  switch (piece.type) {
    case "Commander":
      return addDeltaTargets(state, piece, pos.row, pos.col, [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]);
    case "Captain":
      if (level === 0) return addDeltaTargets(state, piece, pos.row, pos.col, [[f, -1], [f, 0], [f, 1], [-f, -1], [-f, 1]]);
      if (level === 1) return addDeltaTargets(state, piece, pos.row, pos.col, [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]]);
      return addDeltaTargets(state, piece, pos.row, pos.col, [[-1, -1], [-1, 1], [1, -1], [1, 1], [0, -2], [0, 2], [2 * f, -2], [2 * f, 2]]);
    case "Samurai":
      if (level === 0) return addDeltaTargets(state, piece, pos.row, pos.col, [[f, -1], [f, 0], [f, 1], [0, -1], [0, 1]]);
      return addDeltaTargets(state, piece, pos.row, pos.col, [[2 * f, 0], [-2 * f, 0], [0, -1], [0, 1], [f, -1], [f, 1]]);
    case "Spy":
      if (level === 0) return addDeltaTargets(state, piece, pos.row, pos.col, [[2 * f, -1], [2 * f, 1]]);
      return addDeltaTargets(state, piece, pos.row, pos.col, [[2 * f, -1], [2 * f, 1], [f, -1], [f, 1]]);
    case "Bow":
      if (level === 0) return addDeltaTargets(state, piece, pos.row, pos.col, [[2 * f, 0], [0, -2], [0, 2]]);
      if (level === 1) return addDeltaTargets(state, piece, pos.row, pos.col, [[-1, 0], [1, 0], [2 * f, -2], [2 * f, 2]]);
      return addDeltaTargets(state, piece, pos.row, pos.col, [[-2 * f, 0], [2 * f, -2], [2 * f, 2], [0, -2], [0, 2]]);
    case "Pawn":
      if (level === 0) return addDeltaTargets(state, piece, pos.row, pos.col, [[f, 0]]);
      if (level === 1) return addDeltaTargets(state, piece, pos.row, pos.col, [[f, 0], [0, -2], [0, 2]]);
      return addDeltaTargets(state, piece, pos.row, pos.col, [[f, -1], [f, 1], [0, -2], [0, 2]]);
    default:
      return [];
  }
}

export function legalMovesFor(state, pieceId) {
  const piece = state.pieces[pieceId];
  const pos = piecePosition(state, pieceId);
  if (!piece || !pos) return [];
  const stack = state.board[pos.row][pos.col];
  if (stack[stack.length - 1] !== pieceId) return [];
  const level = stack.length - 1;
  if (PIECES[piece.type].immobile) return [];
  if (piece.type === "HiddenDragon" && level === 0) return rayTargets(state, piece, pos.row, pos.col, [[-1, 0], [1, 0], [0, -1], [0, 1]]);
  if (piece.type === "HiddenDragon") return addDeltaTargets(state, piece, pos.row, pos.col, [[-1, -1], [-1, 1], [1, -1], [1, 1]]);
  if (piece.type === "Prodigy" && level === 0) return rayTargets(state, piece, pos.row, pos.col, [[-1, -1], [-1, 1], [1, 1], [1, -1]]);
  if (piece.type === "Prodigy") return addDeltaTargets(state, piece, pos.row, pos.col, [[-1, 0], [1, 0], [0, -1], [0, 1]]);
  return movementDeltas(state, piece, level);
}

export function legalDropsFor(state, pieceId) {
  const piece = state.pieces[pieceId];
  const targets = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const stack = state.board[row][col];
      const ownZone = piece.color === "blue" ? row >= 6 : row <= 2;
      if (!ownZone || stack.length >= MAX_LEVEL) continue;
      if ((state.boardMoveCount || 0) === 0 && stack.length >= 2) continue;
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
  const raw = PREVIEW_DELTAS[type][level];
  if (raw[0] === "orthogonal") return [[0, 2], [1, 2], [2, 0], [2, 1], [2, 3], [2, 4], [3, 2], [4, 2]];
  if (raw[0] === "diagonal") return [[0, 0], [1, 1], [3, 3], [4, 4], [0, 4], [1, 3], [3, 1], [4, 0]];
  return raw.map(([dr, dc]) => [2 + dr, 2 + dc]).filter(([r, c]) => r >= 0 && r < 5 && c >= 0 && c < 5);
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

export function applyMove(state, pieceId, from, row, col) {
  const next = structuredCloneSafe(state);
  const piece = next.pieces[pieceId];
  const fromStack = next.board[from.row][from.col];
  fromStack.pop();
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

  targetStack.push(pieceId);
  next.boardMoveCount = (next.boardMoveCount || 0) + 1;
  next.log.unshift(`${PLAYERS[piece.color].label} mueve ${PIECES[piece.type].label}.`);
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
    },
  };
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
