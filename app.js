const ASSET = "assets/";
const BOARD_SIZE = 9;
const MAX_LEVEL = 3;
const PLAYERS = {
  blue: { label: "Azul", prefix: "B", forward: -1 },
  red: { label: "Rojo", prefix: "R", forward: 1 },
};

const PIECES = {
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

const PIECE_ORDER = [
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

const PREVIEW_DELTAS = {
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

const els = {
  board: document.querySelector("#board"),
  towerCard: document.querySelector("#towerCard"),
  blueHand: document.querySelector("#blueHand"),
  redHand: document.querySelector("#redHand"),
  statusText: document.querySelector("#statusText"),
  turnPill: document.querySelector("#turnPill"),
  selectionCard: document.querySelector("#selectionCard"),
  stateBox: document.querySelector("#stateBox"),
  previewPiece: document.querySelector("#previewPiece"),
  movementPreview: document.querySelector("#movementPreview"),
  honorMode: document.querySelector("#honorMode"),
  newGameBtn: document.querySelector("#newGameBtn"),
  copyLinkBtn: document.querySelector("#copyLinkBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  importBtn: document.querySelector("#importBtn"),
  bluePassBtn: document.querySelector("#bluePassBtn"),
  redPassBtn: document.querySelector("#redPassBtn"),
};

const supabaseSettings = window.GUNGI_SUPABASE || {};
const supabaseClient =
  window.supabase && supabaseSettings.url && supabaseSettings.publishableKey
    ? window.supabase.createClient(supabaseSettings.url, supabaseSettings.publishableKey)
    : null;
let realtimeChannel = null;
let lastRemoteMoveId = 0;
let syncReady = false;

const params = new URLSearchParams(location.search);
let roomId = params.get("id") || createRoomId();
let selected = null;
let legalTargets = [];
let selectedCell = null;
let state = loadState() || createInitialState();
state = normalizeState(state);
if (state.phase !== "battle" && state.hands.blue.length === 0 && state.hands.red.length === 0) {
  state.phase = "battle";
}

function createRoomId() {
  const bytes = new Uint8Array(12);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 18);
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function clientId() {
  const key = "gungi-web:client-id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = createRoomId();
    localStorage.setItem(key, id);
  }
  return id;
}

function createInitialState() {
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

function storageKey() {
  return `gungi-web:${roomId}`;
}

function loadState() {
  const raw = localStorage.getItem(storageKey());
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.board && parsed.hands && parsed.pieces) return parsed;
  } catch (error) {
    console.warn(error);
  }
  return null;
}

function normalizeState(nextState) {
  nextState.phase = nextState.phase || (nextState.boardMoveCount ? "battle" : "setup");
  nextState.boardMoveCount = nextState.boardMoveCount || 0;
  nextState.moveNumber = nextState.moveNumber || 0;
  nextState.roomId = roomId;
  return nextState;
}

function saveState() {
  state.roomId = roomId;
  localStorage.setItem(storageKey(), JSON.stringify(state));
}

function gameStatus() {
  if (state.winner) return "finished";
  return isSetupPhase() ? "setup" : "battle";
}

async function initializeOnlineGame() {
  if (!supabaseClient) return;

  const { data, error } = await supabaseClient
    .from("gungi_games")
    .select("current_state, move_count")
    .eq("id", roomId)
    .maybeSingle();

  if (error) {
    syncReady = false;
    state.log.unshift(`Supabase no sincronizo: ${error.message}`);
    saveState();
    render();
    return;
  }

  if (data?.current_state) {
    state = normalizeState(data.current_state);
    selected = null;
    legalTargets = [];
    selectedCell = null;
    saveState();
    render();
  } else {
    const { error: insertError } = await supabaseClient.from("gungi_games").insert({
      id: roomId,
      status: gameStatus(),
      current_state: state,
      move_count: state.moveNumber || 0,
    });
    if (insertError && insertError.code !== "23505") {
      state.log.unshift(`Supabase no creo la sala: ${insertError.message}`);
      saveState();
      render();
      return;
    }
  }

  syncReady = true;
  subscribeToOnlineMoves();
}

function subscribeToOnlineMoves() {
  if (!supabaseClient) return;
  if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);

  realtimeChannel = supabaseClient
    .channel(`gungi-game-${roomId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "gungi_game_moves",
        filter: `game_id=eq.${roomId}`,
      },
      ({ new: move }) => applyRemoteMove(move)
    )
    .subscribe();
}

function applyRemoteMove(move) {
  if (!move || move.client_id === clientId() || move.id <= lastRemoteMoveId) return;
  lastRemoteMoveId = move.id;
  state = normalizeState(move.state_after);
  selected = null;
  legalTargets = [];
  selectedCell = null;
  saveState();
  render();
}

async function recordOnlineAction(action) {
  if (!supabaseClient || !syncReady || !action) return;

  const snapshot = JSON.parse(JSON.stringify(state));
  const move = {
    game_id: roomId,
    move_number: state.moveNumber,
    client_id: clientId(),
    player_color: action.playerColor,
    phase: action.phase,
    move_type: action.moveType,
    piece_id: action.pieceId || null,
    piece_type: action.pieceType || null,
    from_row: action.from?.row ?? null,
    from_col: action.from?.col ?? null,
    to_row: action.to?.row ?? null,
    to_col: action.to?.col ?? null,
    captured_piece_id: action.capturedPieceId || null,
    state_after: snapshot,
  };

  const { error: moveError } = await supabaseClient.from("gungi_game_moves").insert(move);
  if (moveError && moveError.code !== "23505") {
    state.log.unshift(`No se guardo la jugada online: ${moveError.message}`);
    saveState();
    render();
    return;
  }

  const { error: gameError } = await supabaseClient
    .from("gungi_games")
    .update({
      status: gameStatus(),
      current_state: snapshot,
      move_count: state.moveNumber,
      updated_at: new Date().toISOString(),
    })
    .eq("id", roomId);

  if (gameError) {
    state.log.unshift(`No se actualizo la sala online: ${gameError.message}`);
    saveState();
    render();
  }
}

function pieceImage(piece) {
  return `${ASSET}${PLAYERS[piece.color].prefix}${piece.type}.png`;
}

function topPiece(row, col) {
  const stack = state.board[row][col];
  return stack.length ? state.pieces[stack[stack.length - 1]] : null;
}

function pieceLevel(pieceId) {
  for (let r = 0; r < BOARD_SIZE; r += 1) {
    for (let c = 0; c < BOARD_SIZE; c += 1) {
      const index = state.board[r][c].indexOf(pieceId);
      if (index !== -1) return index;
    }
  }
  return 0;
}

function piecePosition(pieceId) {
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

function canTarget(piece, row, col) {
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

function addDeltaTargets(piece, row, col, deltas) {
  return deltas
    .map(([dr, dc]) => ({ row: row + dr, col: col + dc }))
    .filter((target) => canTarget(piece, target.row, target.col));
}

function rayTargets(piece, row, col, directions) {
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

function movementDeltas(piece, level) {
  const f = PLAYERS[piece.color].forward;
  switch (piece.type) {
    case "Commander":
      return addDeltaTargets(piece, ...currentPos(piece.id), [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]);
    case "Captain":
      if (level === 0) return addDeltaTargets(piece, ...currentPos(piece.id), [[f, -1], [f, 0], [f, 1], [-f, -1], [-f, 1]]);
      if (level === 1) return addDeltaTargets(piece, ...currentPos(piece.id), [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]]);
      return addDeltaTargets(piece, ...currentPos(piece.id), [[-1, -1], [-1, 1], [1, -1], [1, 1], [0, -2], [0, 2], [2 * f, -2], [2 * f, 2]]);
    case "Samurai":
      if (level === 0) return addDeltaTargets(piece, ...currentPos(piece.id), [[f, -1], [f, 0], [f, 1], [0, -1], [0, 1]]);
      return addDeltaTargets(piece, ...currentPos(piece.id), [[2 * f, 0], [-2 * f, 0], [0, -1], [0, 1], [f, -1], [f, 1]]);
    case "Spy":
      if (level === 0) return addDeltaTargets(piece, ...currentPos(piece.id), [[2 * f, -1], [2 * f, 1]]);
      return addDeltaTargets(piece, ...currentPos(piece.id), [[2 * f, -1], [2 * f, 1], [f, -1], [f, 1]]);
    case "Bow":
      if (level === 0) return addDeltaTargets(piece, ...currentPos(piece.id), [[2 * f, 0], [0, -2], [0, 2]]);
      if (level === 1) return addDeltaTargets(piece, ...currentPos(piece.id), [[-1, 0], [1, 0], [2 * f, -2], [2 * f, 2]]);
      return addDeltaTargets(piece, ...currentPos(piece.id), [[-2 * f, 0], [2 * f, -2], [2 * f, 2], [0, -2], [0, 2]]);
    case "Pawn":
      if (level === 0) return addDeltaTargets(piece, ...currentPos(piece.id), [[f, 0]]);
      if (level === 1) return addDeltaTargets(piece, ...currentPos(piece.id), [[f, 0], [0, -2], [0, 2]]);
      return addDeltaTargets(piece, ...currentPos(piece.id), [[f, -1], [f, 1], [0, -2], [0, 2]]);
    default:
      return [];
  }
}

function currentPos(pieceId) {
  const pos = piecePosition(pieceId);
  return [pos.row, pos.col];
}

function legalMovesFor(pieceId) {
  const piece = state.pieces[pieceId];
  const pos = piecePosition(pieceId);
  if (!piece || !pos) return [];
  const stack = state.board[pos.row][pos.col];
  if (stack[stack.length - 1] !== pieceId) return [];
  const level = stack.length - 1;
  if (PIECES[piece.type].immobile) return [];
  if (piece.type === "HiddenDragon" && level === 0) return rayTargets(piece, pos.row, pos.col, [[-1, 0], [1, 0], [0, -1], [0, 1]]);
  if (piece.type === "HiddenDragon") return addDeltaTargets(piece, pos.row, pos.col, [[-1, -1], [-1, 1], [1, -1], [1, 1]]);
  if (piece.type === "Prodigy" && level === 0) return rayTargets(piece, pos.row, pos.col, [[-1, -1], [-1, 1], [1, -1], [1, 1]]);
  if (piece.type === "Prodigy") return addDeltaTargets(piece, pos.row, pos.col, [[-1, 0], [1, 0], [0, -1], [0, 1]]);
  return movementDeltas(piece, level);
}

function legalDropsFor(pieceId) {
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

function sameTarget(a, b) {
  return a.row === b.row && a.col === b.col;
}

function isSetupPhase() {
  return state.phase !== "battle";
}

function canAct(color) {
  if (state.winner) return false;
  if (isSetupPhase()) return state.turn === color;
  return !els.honorMode.checked || state.turn === color;
}

function completeAction(action) {
  if (isSetupPhase()) {
    if (state.hands.blue.length === 0 && state.hands.red.length === 0) {
      startBattle(action);
      return;
    }
    state.turn = state.turn === "blue" ? "red" : "blue";
    finalizeAction(action);
    return;
  }
  finishTurn(action);
}

function finalizeAction(action) {
  state.moveNumber = (state.moveNumber || 0) + 1;
  saveState();
  render();
  recordOnlineAction(action);
}

function selectHandPiece(pieceId) {
  const piece = state.pieces[pieceId];
  if (!canAct(piece.color)) return;
  selected = { kind: "hand", pieceId };
  selectedCell = null;
  legalTargets = legalDropsFor(pieceId);
  render();
}

function selectBoardPiece(pieceId) {
  const piece = state.pieces[pieceId];
  const pos = piecePosition(pieceId);
  if (!pos) return;
  const stack = state.board[pos.row][pos.col];
  if (stack[stack.length - 1] !== pieceId) {
    selected = { kind: "inspect", pieceId };
    legalTargets = legalMovesFor(pieceId);
    selectedCell = pos;
    render();
    return;
  }
  if (isSetupPhase()) {
    selected = { kind: "inspect", pieceId };
    legalTargets = legalMovesFor(pieceId);
    selectedCell = pos;
    render();
    return;
  }
  if (!canAct(piece.color)) {
    selected = { kind: "inspect", pieceId };
    legalTargets = legalMovesFor(pieceId);
    selectedCell = pos;
    render();
    return;
  }
  selected = { kind: "board", pieceId, from: pos };
  selectedCell = pos;
  legalTargets = legalMovesFor(pieceId);
  render();
}

function cellClick(row, col) {
  if (selected && selected.kind !== "inspect" && legalTargets.some((target) => sameTarget(target, { row, col }))) {
    const action =
      selected.kind === "hand" ? dropPiece(selected.pieceId, row, col) : movePiece(selected.pieceId, selected.from, row, col);
    selected = null;
    legalTargets = [];
    selectedCell = { row, col };
    completeAction(action);
    return;
  }
  selectedCell = { row, col };
  const top = topPiece(row, col);
  if (top) {
    selectBoardPiece(top.id);
  } else {
    selected = null;
    legalTargets = [];
    render();
  }
}

function dropPiece(pieceId, row, col) {
  const piece = state.pieces[pieceId];
  state.hands[piece.color] = state.hands[piece.color].filter((id) => id !== pieceId);
  state.board[row][col].push(pieceId);
  state.log.unshift(`${PLAYERS[piece.color].label} coloca ${PIECES[piece.type].label}.`);
  return {
    moveType: "place",
    phase: isSetupPhase() ? "setup" : "battle",
    playerColor: piece.color,
    pieceId,
    pieceType: piece.type,
    to: { row, col },
  };
}

function movePiece(pieceId, from, row, col) {
  const piece = state.pieces[pieceId];
  const fromStack = state.board[from.row][from.col];
  fromStack.pop();
  const targetStack = state.board[row][col];
  let capturedPieceId = null;

  if (targetStack.length && state.pieces[targetStack[targetStack.length - 1]].color !== piece.color) {
    const capturedId = targetStack.pop();
    const captured = state.pieces[capturedId];
    state.hands[piece.color].push(capturedId);
    captured.color = piece.color;
    capturedPieceId = capturedId;
    if (captured.type === "Commander") state.winner = piece.color;
  }

  targetStack.push(pieceId);
  state.boardMoveCount = (state.boardMoveCount || 0) + 1;
  state.log.unshift(`${PLAYERS[piece.color].label} mueve ${PIECES[piece.type].label}.`);
  return {
    moveType: "move",
    phase: isSetupPhase() ? "setup" : "battle",
    playerColor: piece.color,
    pieceId,
    pieceType: piece.type,
    from,
    to: { row, col },
    capturedPieceId,
  };
}

function beginDrag(pieceId, source, event) {
  const piece = state.pieces[pieceId];
  if (source !== "hand" && isSetupPhase()) {
    event.preventDefault();
    return;
  }
  if (!canAct(piece.color)) {
    event.preventDefault();
    return;
  }
  const pos = piecePosition(pieceId);
  selected = source === "hand" ? { kind: "hand", pieceId } : { kind: "board", pieceId, from: pos };
  selectedCell = pos;
  legalTargets = source === "hand" ? legalDropsFor(pieceId) : legalMovesFor(pieceId);
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", JSON.stringify(selected));
  event.currentTarget.classList.add("dragging");
  updateTargetHighlights();
}

function endDrag(event) {
  event.currentTarget.classList.remove("dragging");
  document.querySelectorAll(".cell.drag-over").forEach((cell) => cell.classList.remove("drag-over"));
}

function dropOnCell(row, col, event) {
  event.preventDefault();
  document.querySelectorAll(".cell.drag-over").forEach((cell) => cell.classList.remove("drag-over"));
  if (!selected || selected.kind === "inspect" || !legalTargets.some((target) => sameTarget(target, { row, col }))) return;
  const action =
    selected.kind === "hand" ? dropPiece(selected.pieceId, row, col) : movePiece(selected.pieceId, selected.from, row, col);
  selected = null;
  legalTargets = [];
  selectedCell = { row, col };
  completeAction(action);
}

function updateTargetHighlights() {
  document.querySelectorAll(".cell").forEach((cell) => {
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    const valid = legalTargets.some((target) => sameTarget(target, { row, col }));
    const top = topPiece(row, col);
    cell.classList.toggle("preview", valid && !(top && selected && top.color !== state.pieces[selected.pieceId].color));
    cell.classList.toggle("capture", valid && Boolean(top && selected && top.color !== state.pieces[selected.pieceId].color));
  });
  renderStatus();
  renderPreview();
}

function startBattle(action) {
  state.phase = "battle";
  state.turn = "blue";
  selected = null;
  legalTargets = [];
  selectedCell = null;
  state.log.unshift("Ambos jugadores colocaron todas sus piezas. La partida ha comenzado.");
  finalizeAction(action || {
    moveType: "start_battle",
    phase: "setup",
    playerColor: "blue",
  });
}

function finishTurn(action) {
  if (!state.winner) state.turn = state.turn === "blue" ? "red" : "blue";
  finalizeAction(action);
}

function pass(color) {
  if (isSetupPhase()) return;
  if (!canAct(color)) return;
  state.log.unshift(`${PLAYERS[color].label} pasa el turno.`);
  finishTurn({
    moveType: "pass",
    phase: "battle",
    playerColor: color,
  });
}

function renderBoard() {
  els.board.innerHTML = "";
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.row = row;
      cell.dataset.col = col;
      cell.tabIndex = 0;
      cell.setAttribute("role", "button");
      cell.setAttribute("aria-label", `Fila ${row + 1}, columna ${col + 1}`);
      if (row >= 6) cell.classList.add("setup-blue");
      if (row <= 2) cell.classList.add("setup-red");
      if (selectedCell && selectedCell.row === row && selectedCell.col === col) cell.classList.add("selected");
      if (legalTargets.some((target) => sameTarget(target, { row, col }))) {
        const top = topPiece(row, col);
        cell.classList.add(top && top.color !== state.pieces[selected.pieceId].color ? "capture" : "preview");
      }
      cell.addEventListener("click", () => cellClick(row, col));
      cell.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          cellClick(row, col);
        }
      });
      cell.addEventListener("dragover", (event) => {
        if (selected && legalTargets.some((target) => sameTarget(target, { row, col }))) {
          event.preventDefault();
          cell.classList.add("drag-over");
        }
      });
      cell.addEventListener("dragleave", () => cell.classList.remove("drag-over"));
      cell.addEventListener("drop", (event) => dropOnCell(row, col, event));

      const stackEl = document.createElement("div");
      stackEl.className = "stack";
      const stack = state.board[row][col];
      const visiblePieceId = stack[stack.length - 1];
      if (visiblePieceId) {
        const slot = document.createElement("div");
        slot.className = "slot";
        slot.appendChild(renderPieceButton(visiblePieceId, "board", stack.length));
        stackEl.appendChild(slot);
      }
      cell.appendChild(stackEl);
      els.board.appendChild(cell);
    }
  }
}

function renderPieceButton(pieceId, source, stackSize = 0) {
  const piece = state.pieces[pieceId];
  const button = document.createElement("button");
  button.type = "button";
  button.className = `piece ${piece.color}`;
  const locked = source === "towerLocked";
  button.draggable = !locked && !(isSetupPhase() && source !== "hand");
  if (selected?.pieceId === pieceId) button.classList.add("selected");
  const inactiveHand = source === "hand" && !canAct(piece.color);
  const inactiveBoard = !isSetupPhase() && source !== "hand" && els.honorMode.checked && state.turn !== piece.color;
  if (locked || inactiveHand || inactiveBoard) button.classList.add("disabled");
  button.title = `${PIECES[piece.type].label} ${PLAYERS[piece.color].label}`;
  if (!locked) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const pos = piecePosition(pieceId);
      if (selected && selected.kind !== "inspect" && pos && selected.pieceId !== pieceId && legalTargets.some((target) => sameTarget(target, pos))) {
        const action =
          selected.kind === "hand"
            ? dropPiece(selected.pieceId, pos.row, pos.col)
            : movePiece(selected.pieceId, selected.from, pos.row, pos.col);
        selected = null;
        legalTargets = [];
        selectedCell = pos;
        completeAction(action);
        return;
      }
      source === "hand" ? selectHandPiece(pieceId) : selectBoardPiece(pieceId);
    });
    button.addEventListener("dragstart", (event) => beginDrag(pieceId, source, event));
    button.addEventListener("dragend", endDrag);
  }

  const ribbon = document.createElement("i");
  ribbon.className = "piece-color-ribbon";
  const img = document.createElement("img");
  img.src = pieceImage(piece);
  img.alt = PIECES[piece.type].label;
  const level = document.createElement("span");
  level.textContent = source === "board" ? pieceLevel(pieceId) + 1 : "";
  button.append(ribbon, img, level);
  if (stackSize > 1) {
    const count = document.createElement("b");
    count.className = "stack-count";
    count.textContent = `x${stackSize}`;
    button.appendChild(count);
  }
  return button;
}

function renderHands() {
  els.blueHand.innerHTML = "";
  els.redHand.innerHTML = "";
  for (const color of ["red", "blue"]) {
    const container = color === "blue" ? els.blueHand : els.redHand;
    const sorted = [...state.hands[color]].sort((a, b) => PIECE_ORDER.indexOf(state.pieces[a].type) - PIECE_ORDER.indexOf(state.pieces[b].type));
    sorted.forEach((pieceId) => container.appendChild(renderPieceButton(pieceId, "hand")));
  }
}

function renderStatus() {
  const turnLabel = PLAYERS[state.turn].label;
  els.turnPill.textContent = state.winner ? `Gana ${PLAYERS[state.winner].label}` : isSetupPhase() ? `Arreglo inicial: ${turnLabel}` : `Turno ${turnLabel}`;
  els.turnPill.classList.toggle("red", state.turn === "red");
  els.bluePassBtn.hidden = isSetupPhase();
  els.redPassBtn.hidden = isSetupPhase();
  const url = roomUrl();
  els.statusText.textContent = `Sala ${roomId}. ${url}`;
  if (!selected) {
    els.selectionCard.textContent = state.log[0] || "Selecciona una pieza.";
    return;
  }
  const piece = state.pieces[selected.pieceId];
  els.previewPiece.value = piece.type;
  const source = selected.kind === "hand" ? "desde la mano" : "en tablero";
  els.selectionCard.textContent = `${PIECES[piece.type].label} ${PLAYERS[piece.color].label} ${source}.`;
}

function renderTowerCard() {
  if (!selectedCell) {
    els.towerCard.className = "tower-card";
    els.towerCard.innerHTML = "";
    return;
  }
  const stack = state.board[selectedCell.row][selectedCell.col];
  if (!stack.length) {
    els.towerCard.className = "tower-card";
    els.towerCard.innerHTML = "";
    return;
  }
  els.towerCard.className = "tower-card visible";
  els.towerCard.innerHTML = `<h2>Torre fila ${selectedCell.row + 1}, columna ${selectedCell.col + 1}</h2>`;
  const list = document.createElement("div");
  list.className = "tower-list";
  stack.forEach((pieceId, index) => {
    const item = document.createElement("div");
    item.appendChild(renderPieceButton(pieceId, index === stack.length - 1 ? "tower" : "towerLocked"));
    const label = document.createElement("p");
    const piece = state.pieces[pieceId];
    label.textContent = `Nivel ${index + 1}: ${PIECES[piece.type].label}`;
    item.appendChild(label);
    list.appendChild(item);
  });
  els.towerCard.appendChild(list);
}

function renderPreview() {
  els.movementPreview.innerHTML = "";
  const type = els.previewPiece.value || "Commander";
  for (let level = 0; level < 3; level += 1) {
    const wrap = document.createElement("div");
    wrap.className = "mini-board-wrap";
    const title = document.createElement("div");
    title.className = "mini-title";
    title.textContent = `Nivel ${level + 1}`;
    const board = document.createElement("div");
    board.className = "mini-board";
    const marks = previewMarks(type, level);
    for (let r = 0; r < 5; r += 1) {
      for (let c = 0; c < 5; c += 1) {
        const cell = document.createElement("div");
        cell.className = "mini-cell";
        if (r === 2 && c === 2) {
          cell.classList.add("origin");
          const img = document.createElement("img");
          img.src = `${ASSET}B${type}.png`;
          img.alt = PIECES[type].label;
          cell.appendChild(img);
        } else if (marks.some((mark) => mark[0] === r && mark[1] === c)) {
          cell.classList.add("move");
        }
        board.appendChild(cell);
      }
    }
    wrap.append(title, board);
    els.movementPreview.appendChild(wrap);
  }
}

function previewMarks(type, level) {
  const raw = PREVIEW_DELTAS[type][level];
  if (raw[0] === "orthogonal") return [[0, 2], [1, 2], [2, 0], [2, 1], [2, 3], [2, 4], [3, 2], [4, 2]];
  if (raw[0] === "diagonal") return [[0, 0], [1, 1], [3, 3], [4, 4], [0, 4], [1, 3], [3, 1], [4, 0]];
  return raw.map(([dr, dc]) => [2 + dr, 2 + dc]).filter(([r, c]) => r >= 0 && r < 5 && c >= 0 && c < 5);
}

function render() {
  renderBoard();
  renderHands();
  renderStatus();
  renderTowerCard();
  renderPreview();
}

function roomUrl() {
  if (location.protocol === "file:") return `${location.href.split("?")[0]}?id=${roomId}`;
  const path = location.pathname.endsWith("/game") ? location.pathname : location.pathname;
  return `${location.origin}${path}?id=${roomId}`;
}

function setupPreviewSelect() {
  PIECE_ORDER.forEach((type) => {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = PIECES[type].label;
    els.previewPiece.appendChild(option);
  });
  els.previewPiece.addEventListener("change", renderPreview);
}

function exportState() {
  els.stateBox.value = btoa(unescape(encodeURIComponent(JSON.stringify(state))));
  els.stateBox.select();
}

function importState() {
  try {
    const parsed = JSON.parse(decodeURIComponent(escape(atob(els.stateBox.value.trim()))));
    if (!parsed.board || !parsed.hands || !parsed.pieces) throw new Error("Estado invalido");
    state = parsed;
    state.phase = state.phase || (state.boardMoveCount ? "battle" : "setup");
    state.boardMoveCount = state.boardMoveCount || 0;
    state.roomId = roomId;
    selected = null;
    legalTargets = [];
    selectedCell = null;
    saveState();
    render();
  } catch (error) {
    els.stateBox.value = "No se pudo importar el estado. Revisa que el texto este completo.";
  }
}

function newGame() {
  roomId = createRoomId();
  const nextUrl = `${location.pathname}?id=${roomId}`;
  history.replaceState(null, "", nextUrl);
  state = createInitialState();
  selected = null;
  legalTargets = [];
  selectedCell = null;
  saveState();
  render();
}

async function copyLink() {
  const link = roomUrl();
  try {
    await navigator.clipboard.writeText(link);
    els.statusText.textContent = `Link copiado: ${link}`;
  } catch (error) {
    els.stateBox.value = link;
    els.stateBox.select();
  }
}

function bindEvents() {
  els.newGameBtn.addEventListener("click", newGame);
  els.copyLinkBtn.addEventListener("click", copyLink);
  els.exportBtn.addEventListener("click", exportState);
  els.importBtn.addEventListener("click", importState);
  els.bluePassBtn.addEventListener("click", () => pass("blue"));
  els.redPassBtn.addEventListener("click", () => pass("red"));
  els.honorMode.addEventListener("change", render);
}

async function boot() {
  setupPreviewSelect();
  bindEvents();
  saveState();
  render();
  await initializeOnlineGame();
}

boot();
