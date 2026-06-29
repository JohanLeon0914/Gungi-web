"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import {
  BOARD_SIZE,
  PIECES,
  PIECE_ORDER,
  PLAYERS,
  TIME_CONTROLS,
  applyClockTimeout,
  applyMove,
  applyPass,
  applyPlacement,
  clockView,
  completeAction,
  createInitialState,
  createRandomSetupState,
  createRoomId,
  formatClockMs,
  isSetupPhase,
  legalDropsFor,
  legalMovesFor,
  normalizeState,
  pieceImage,
  pieceLevel,
  piecePosition,
  previewMarks,
  sameTarget,
  setTimeControl,
  structuredCloneSafe,
  topPiece,
} from "@/lib/gungiRules";

const BOARD_PREVIEW_HOLD_MS = 500;
const MAX_HISTORY_SNAPSHOTS = 300;

function historyStorageKey(roomId) {
  return `gungi-web-history:${roomId}`;
}

function saveSnapshotToLocalHistory(snapshot) {
  if (typeof window === "undefined" || !snapshot?.roomId) return [];
  const key = historyStorageKey(snapshot.roomId);
  let history = [];
  try {
    history = JSON.parse(window.localStorage.getItem(key) || "[]");
  } catch {
    history = [];
  }

  const normalizedSnapshot = structuredCloneSafe(snapshot);
  const last = history[history.length - 1];
  if (last?.moveNumber === normalizedSnapshot.moveNumber) {
    history[history.length - 1] = normalizedSnapshot;
  } else {
    history.push(normalizedSnapshot);
  }
  if (history.length > MAX_HISTORY_SNAPSHOTS) {
    history = history.slice(history.length - MAX_HISTORY_SNAPSHOTS);
  }
  window.localStorage.setItem(key, JSON.stringify(history));
  return history;
}

function readLocalHistory(roomId) {
  if (typeof window === "undefined" || !roomId) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(historyStorageKey(roomId)) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function localGameSummaries() {
  if (typeof window === "undefined") return [];
  const summaries = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith("gungi-web:") || key === "gungi-web:client-id") continue;
    try {
      const state = JSON.parse(window.localStorage.getItem(key));
      if (state?.roomId) {
        summaries.push({
          id: state.roomId,
          status: state.winner ? "finished" : isSetupPhase(state) ? "setup" : "battle",
          move_count: state.moveNumber || 0,
          updated_at: null,
          local: true,
        });
      }
    } catch {
      continue;
    }
  }
  return summaries.sort((a, b) => (b.move_count || 0) - (a.move_count || 0));
}

function GamePageInner() {
  const searchParams = useSearchParams();
  const initialRoomId = searchParams.get("id") || "loading";
  const [roomId, setRoomId] = useState(initialRoomId);
  const [gameState, setGameStateRaw] = useState(() => createInitialState(initialRoomId));
  const [selected, setSelected] = useState(null);
  const [selectedCell, setSelectedCell] = useState(null);
  const [legalTargets, setLegalTargets] = useState([]);
  const [previewPiece, setPreviewPiece] = useState("Commander");
  const [heldPreview, setHeldPreview] = useState(null);
  const [honorMode, setHonorMode] = useState(true);
  const [syncStatus, setSyncStatus] = useState(isSupabaseConfigured ? "Conectando" : "Sin Supabase");
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [reviewSnapshots, setReviewSnapshots] = useState([]);
  const [reviewIndex, setReviewIndex] = useState(null);
  const [savedGames, setSavedGames] = useState([]);
  const [historyStatus, setHistoryStatus] = useState("");
  const [dismissedWinnerMove, setDismissedWinnerMove] = useState(null);
  const stateRef = useRef(gameState);
  const roomRef = useRef(roomId);
  const clientIdRef = useRef("");
  const syncInFlightRef = useRef(false);
  const heldPreviewTimerRef = useRef(null);
  const suppressHistoryUpdateRef = useRef(false);

  const setGameState = useCallback((next) => {
    stateRef.current = next;
    setGameStateRaw(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(`gungi-web:${next.roomId}`, JSON.stringify(next));
      const history = saveSnapshotToLocalHistory(next);
      if (!suppressHistoryUpdateRef.current) {
        setReviewSnapshots(history.map((snapshot) => ({ moveNumber: snapshot.moveNumber || 0, state: snapshot })));
      }
    }
  }, []);

  useEffect(() => {
    let activeRoomId = initialRoomId;
    if (!searchParams.get("id")) {
      activeRoomId = createRoomId();
      roomRef.current = activeRoomId;
      setRoomId(activeRoomId);
      const fresh = createInitialState(activeRoomId);
      setGameState(fresh);
      window.history.replaceState(null, "", `/?id=${activeRoomId}`);
    }

    clientIdRef.current = window.localStorage.getItem("gungi-web:client-id") || createRoomId();
    window.localStorage.setItem("gungi-web:client-id", clientIdRef.current);

    const stored = window.localStorage.getItem(`gungi-web:${activeRoomId}`);
    if (stored) {
      try {
        const parsed = normalizeState(JSON.parse(stored), activeRoomId);
        setGameState(parsed);
      } catch {
        setGameState(createInitialState(activeRoomId));
      }
    }
    setReviewIndex(null);
  }, [initialRoomId, searchParams, setGameState]);

  const resetSelection = useCallback(() => {
    setSelected(null);
    setSelectedCell(null);
    setLegalTargets([]);
  }, []);

  const applyRemoteState = useCallback(
    (remoteState, source = "remoto") => {
      if (!remoteState) return false;
      const normalized = normalizeState(remoteState, roomRef.current);
      const localState = stateRef.current;
      const localMoveNumber = localState.moveNumber || 0;
      const remoteMoveNumber = normalized.moveNumber || 0;
      const localClockRevision = Number(localState.clock?.revision || 0);
      const remoteClockRevision = Number(normalized.clock?.revision || 0);
      if (remoteMoveNumber < localMoveNumber) return false;
      if (remoteMoveNumber === localMoveNumber && remoteClockRevision <= localClockRevision) return false;

      setGameState(normalized);
      resetSelection();
      setSyncStatus(source === "realtime" ? "Actualizado en vivo" : "Sincronizado");
      setLastSavedAt(new Date());
      return true;
    },
    [resetSelection, setGameState],
  );

  const fetchSnapshot = useCallback(async () => {
    if (!supabase || syncInFlightRef.current) return;
    syncInFlightRef.current = true;
    const { data, error } = await supabase
      .from("gungi_games")
      .select("current_state, move_count, updated_at")
      .eq("id", roomRef.current)
      .maybeSingle();
    syncInFlightRef.current = false;

    if (error) {
      setSyncStatus(`Error: ${error.message}`);
      return;
    }

    if (data?.current_state) {
      applyRemoteState(data.current_state, "poll");
    }
  }, [applyRemoteState]);

  const loadSavedGames = useCallback(async () => {
    const local = localGameSummaries();
    if (!supabase) {
      setSavedGames(local);
      return;
    }

    const { data, error } = await supabase
      .from("gungi_games")
      .select("id, status, move_count, updated_at")
      .order("updated_at", { ascending: false })
      .limit(20);

    if (error) {
      setHistoryStatus(`No se pudo cargar historial: ${error.message}`);
      setSavedGames(local);
      return;
    }

    const seen = new Set();
    const merged = [...(data || []), ...local].filter((game) => {
      if (!game?.id || seen.has(game.id)) return false;
      seen.add(game.id);
      return true;
    });
    setSavedGames(merged);
  }, []);

  const loadReviewSnapshots = useCallback(async (targetRoomId = roomRef.current) => {
    setHistoryStatus("Cargando jugadas");
    let snapshots = [];

    if (supabase) {
      const { data, error } = await supabase
        .from("gungi_game_moves")
        .select("move_number, state_after")
        .eq("game_id", targetRoomId)
        .order("move_number", { ascending: true });

      if (error) {
        setHistoryStatus(`Historial online no disponible: ${error.message}`);
      } else {
        snapshots = [
          { moveNumber: 0, state: createInitialState(targetRoomId) },
          ...(data || []).map((move) => ({
            moveNumber: move.move_number || move.state_after?.moveNumber || 0,
            state: normalizeState(move.state_after, targetRoomId),
          })),
        ];
      }
    }

    if (!snapshots.length) {
      const local = readLocalHistory(targetRoomId);
      snapshots = local.map((snapshot) => ({
        moveNumber: snapshot.moveNumber || 0,
        state: normalizeState(snapshot, targetRoomId),
      }));
    }

    if (!snapshots.length) {
      snapshots = [{ moveNumber: 0, state: createInitialState(targetRoomId) }];
    }

    setReviewSnapshots(snapshots);
    setReviewIndex(null);
    setHistoryStatus(`${snapshots.length} posiciones disponibles`);
    return snapshots;
  }, []);

  const saveOnline = useCallback(
    async (nextState, action) => {
      if (!supabase) return;

      const snapshot = structuredCloneSafe(nextState);
      const status = snapshot.winner ? "finished" : isSetupPhase(snapshot) ? "setup" : "battle";

      const { error: gameError } = await supabase.from("gungi_games").upsert({
        id: roomRef.current,
        status,
        current_state: snapshot,
        move_count: snapshot.moveNumber || 0,
        updated_at: new Date().toISOString(),
      });

      if (gameError) {
        setSyncStatus(`Error guardando: ${gameError.message}`);
        return;
      }

      if (action) {
        const { error: moveError } = await supabase.from("gungi_game_moves").insert({
          game_id: roomRef.current,
          move_number: snapshot.moveNumber,
          client_id: clientIdRef.current,
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
        });

        if (moveError && moveError.code !== "23505") {
          setSyncStatus(`Snapshot guardado; historial fallo: ${moveError.message}`);
          return;
        }
      }

      setSyncStatus("Guardado");
      setLastSavedAt(new Date());
    },
    [],
  );

  useEffect(() => {
    if (!supabase || roomId === "loading") return;
    roomRef.current = roomId;
    let active = true;

    async function initRoom() {
      setSyncStatus("Conectando");
      const { data, error } = await supabase
        .from("gungi_games")
        .select("current_state")
        .eq("id", roomId)
        .maybeSingle();

      if (!active) return;
      if (error) {
        setSyncStatus(`Error: ${error.message}`);
        return;
      }

      if (data?.current_state) {
        const remote = normalizeState(data.current_state, roomId);
        setGameState(remote);
        resetSelection();
      } else {
        await saveOnline(stateRef.current, null);
      }

      setSyncStatus("En linea");
    }

    initRoom();

    const channel = supabase
      .channel(`gungi-room-${roomId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "gungi_games", filter: `id=eq.${roomId}` },
        ({ new: row }) => applyRemoteState(row?.current_state, "realtime"),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "gungi_game_moves", filter: `game_id=eq.${roomId}` },
        ({ new: row }) => applyRemoteState(row?.state_after, "realtime"),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setSyncStatus("En vivo");
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setSyncStatus("Reconectando");
        }
      });

    const poll = window.setInterval(fetchSnapshot, 900);
    const onFocus = () => fetchSnapshot();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      active = false;
      window.clearInterval(poll);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      supabase.removeChannel(channel);
    };
  }, [applyRemoteState, fetchSnapshot, resetSelection, roomId, saveOnline, setGameState]);

  useEffect(() => {
    if (roomId === "loading") return;
    loadSavedGames();
    loadReviewSnapshots(roomId);
  }, [loadReviewSnapshots, loadSavedGames, roomId]);

  useEffect(() => {
    const tick = window.setInterval(() => setNowMs(Date.now()), 500);
    return () => window.clearInterval(tick);
  }, []);

  const clearHeldPreview = useCallback(() => {
    if (heldPreviewTimerRef.current) {
      window.clearTimeout(heldPreviewTimerRef.current);
      heldPreviewTimerRef.current = null;
    }
    setHeldPreview(null);
  }, []);

  useEffect(() => {
    window.addEventListener("pointerup", clearHeldPreview);
    window.addEventListener("pointercancel", clearHeldPreview);
    return () => {
      window.removeEventListener("pointerup", clearHeldPreview);
      window.removeEventListener("pointercancel", clearHeldPreview);
      if (heldPreviewTimerRef.current) {
        window.clearTimeout(heldPreviewTimerRef.current);
        heldPreviewTimerRef.current = null;
      }
    };
  }, [clearHeldPreview]);

  useEffect(() => {
    const expired = applyClockTimeout(gameState, nowMs);
    if (expired === gameState) return;
    setGameState(expired);
    resetSelection();
    saveOnline(expired, null);
  }, [gameState, nowMs, resetSelection, saveOnline, setGameState]);

  useEffect(() => {
    if (!gameState.winner) {
      setDismissedWinnerMove(null);
    }
  }, [gameState.winner]);

  const roomUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/?id=${roomId}`;
  }, [roomId]);

  const canAct = useCallback(
    (color) => {
      if (reviewIndex !== null) return false;
      if (gameState.winner) return false;
      if (isSetupPhase(gameState)) return gameState.turn === color;
      return !honorMode || gameState.turn === color;
    },
    [gameState, honorMode, reviewIndex],
  );

  const commitAction = useCallback(
    (draft, action, nextSelectedCell) => {
      const completed = completeAction(draft, action);
      setGameState(completed.next);
      resetSelection();
      setSelectedCell(nextSelectedCell || null);
      saveOnline(completed.next, completed.action);
    },
    [resetSelection, saveOnline, setGameState],
  );

  const selectHandPiece = (pieceId) => {
    if (reviewIndex !== null) return;
    if (selected?.kind === "hand" && selected.pieceId === pieceId) {
      resetSelection();
      return;
    }
    const piece = gameState.pieces[pieceId];
    if (!canAct(piece.color)) return;
    setSelected({ kind: "hand", pieceId });
    setSelectedCell(null);
    setLegalTargets(legalDropsFor(gameState, pieceId));
    setPreviewPiece(piece.type);
  };

  const selectBoardPiece = (pieceId) => {
    if (reviewIndex !== null) return;
    if (selected?.pieceId === pieceId) {
      resetSelection();
      return;
    }
    const piece = gameState.pieces[pieceId];
    const pos = piecePosition(gameState, pieceId);
    if (!pos) return;
    const stack = gameState.board[pos.row][pos.col];
    if (stack[stack.length - 1] !== pieceId || isSetupPhase(gameState) || !canAct(piece.color)) {
      setSelected({ kind: "inspect", pieceId });
      setSelectedCell(pos);
      setLegalTargets(legalMovesFor(gameState, pieceId));
      setPreviewPiece(piece.type);
      return;
    }
    setSelected({ kind: "board", pieceId, from: pos });
    setSelectedCell(pos);
    setLegalTargets(legalMovesFor(gameState, pieceId));
    setPreviewPiece(piece.type);
  };

  const handleCellClick = (row, col) => {
    if (reviewIndex !== null) {
      setSelectedCell({ row, col });
      return;
    }
    const chosenTarget = legalTargets.find((target) => sameTarget(target, { row, col }));
    if (selected && selected.kind !== "inspect" && chosenTarget) {
      const result =
        selected.kind === "hand"
          ? applyPlacement(gameState, selected.pieceId, row, col)
          : applyMove(gameState, selected.pieceId, selected.from, row, col, chosenTarget);
      commitAction(result.next, result.action, { row, col });
      return;
    }

    setSelectedCell({ row, col });
    const top = topPiece(gameState, row, col);
    if (top) {
      selectBoardPiece(top.id);
    } else {
      resetSelection();
      setSelectedCell({ row, col });
    }
  };

  const handleDropOnCell = (row, col, event) => {
    event.preventDefault();
    if (reviewIndex !== null) return;
    const raw = event.dataTransfer.getData("application/json");
    if (!raw) return;

    try {
      const dragged = JSON.parse(raw);
      const targets = dragged.kind === "hand" ? legalDropsFor(gameState, dragged.pieceId) : legalMovesFor(gameState, dragged.pieceId);
      const chosenTarget = targets.find((target) => sameTarget(target, { row, col }));
      if (!chosenTarget) return;

      const result =
        dragged.kind === "hand"
          ? applyPlacement(gameState, dragged.pieceId, row, col)
          : applyMove(gameState, dragged.pieceId, dragged.from, row, col, chosenTarget);
      commitAction(result.next, result.action, { row, col });
    } catch {
      return;
    }
  };

  const handlePass = (color) => {
    if (reviewIndex !== null) return;
    if (isSetupPhase(gameState) || !canAct(color)) return;
    const { next, action } = applyPass(gameState, color);
    setGameState(next);
    resetSelection();
    saveOnline(next, action);
  };

  const handleTimeControlChange = (event) => {
    if (reviewIndex !== null) return;
    const next = setTimeControl(gameState, event.target.value);
    setGameState(next);
    resetSelection();
    saveOnline(next, null);
  };

  const handleRandomSetup = () => {
    if (reviewIndex !== null || !isSetupPhase(gameState)) return;
    const { next, action } = createRandomSetupState(gameState);
    setGameState(next);
    resetSelection();
    saveOnline(next, action);
  };

  const showHeldPreview = (piece, event, source) => {
    if (!event.isPrimary) return;
    clearHeldPreview();
    const rect = event.currentTarget.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 8;
    const gap = 8;
    const width = Math.min(300, Math.max(0, viewportWidth - margin * 2));
    const estimatedHeight = Math.min(150, width / 3 + 42);
    const minLeft = margin + width / 2;
    const maxLeft = viewportWidth - margin - width / 2;
    const centeredLeft = rect.left + rect.width / 2;
    const left = Math.min(Math.max(centeredLeft, minLeft), maxLeft);
    const hasRoomAbove = rect.top - estimatedHeight - gap >= margin;
    const top = hasRoomAbove
      ? rect.top - estimatedHeight - gap
      : Math.min(Math.max(rect.bottom + gap, margin), viewportHeight - estimatedHeight - margin);

    const showPreview = () => {
      heldPreviewTimerRef.current = null;
      setHeldPreview({ type: piece.type, color: piece.color, left, top, width });
    };

    if (source === "board") {
      heldPreviewTimerRef.current = window.setTimeout(showPreview, BOARD_PREVIEW_HOLD_MS);
      return;
    }

    showPreview();
  };

  const createNewGame = () => {
    const nextRoomId = createRoomId();
    const next = createInitialState(nextRoomId);
    roomRef.current = nextRoomId;
    setRoomId(nextRoomId);
    setGameState(next);
    resetSelection();
    setReviewIndex(null);
    window.history.replaceState(null, "", `/?id=${nextRoomId}`);
  };

  const enterGameReview = async (targetRoomId) => {
    if (!targetRoomId) return;
    roomRef.current = targetRoomId;
    setRoomId(targetRoomId);
    window.history.replaceState(null, "", `/?id=${targetRoomId}`);
    const snapshots = await loadReviewSnapshots(targetRoomId);
    const latest = snapshots[snapshots.length - 1]?.state;
    if (latest) {
      suppressHistoryUpdateRef.current = true;
      setGameState(latest);
      suppressHistoryUpdateRef.current = false;
    }
    setReviewIndex(0);
    resetSelection();
  };

  const stepReview = (direction) => {
    if (!reviewSnapshots.length) return;
    const currentIndex = reviewIndex ?? reviewSnapshots.length - 1;
    const nextIndex = Math.min(Math.max(currentIndex + direction, 0), reviewSnapshots.length - 1);
    setReviewIndex(nextIndex === reviewSnapshots.length - 1 ? null : nextIndex);
    resetSelection();
  };

  const jumpReview = (index) => {
    if (!reviewSnapshots.length) return;
    const nextIndex = Math.min(Math.max(index, 0), reviewSnapshots.length - 1);
    setReviewIndex(nextIndex === reviewSnapshots.length - 1 ? null : nextIndex);
    resetSelection();
  };

  const returnToLive = () => {
    setReviewIndex(null);
    resetSelection();
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(roomUrl);
      setSyncStatus("Link copiado");
    } catch {
      setSyncStatus("No se pudo copiar");
    }
  };

  const visibleState = reviewIndex === null ? gameState : reviewSnapshots[reviewIndex]?.state || gameState;
  const turnLabel = PLAYERS[visibleState.turn].label;
  const visibleMoveIndex = reviewIndex ?? Math.max(0, reviewSnapshots.length - 1);
  const isReviewing = reviewIndex !== null;
  const selectedPiece = selected?.pieceId ? visibleState.pieces[selected.pieceId] : null;
  const currentTower = selectedCell ? visibleState.board[selectedCell.row][selectedCell.col] : [];
  const clocks = clockView(visibleState, isReviewing ? Date.parse(visibleState.clock?.activeSince || "") || nowMs : nowMs);
  const timeControlLocked = !isSetupPhase(gameState);
  const showWinnerModal = Boolean(gameState.winner && !isReviewing && dismissedWinnerMove !== gameState.moveNumber);

  return (
    <main className="min-h-screen px-4 py-5 text-stone-100 sm:px-6 lg:px-8">
      <section className="mx-auto flex max-w-[1640px] flex-col gap-5">
        <header className="rounded-2xl border border-white/10 bg-stone-950/80 p-4 shadow-glow backdrop-blur md:flex md:items-center md:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">
                {syncStatus}
              </span>
              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-200">
                Sala {roomId}
              </span>
            </div>
            <h1 className="font-display text-4xl font-bold text-stone-50 md:text-5xl">Gungi Online</h1>
            <p className="mt-2 max-w-3xl text-sm text-stone-400">
              {isSupabaseConfigured
                ? "Partida sincronizada por Supabase. Los cambios se reflejan por Realtime y snapshot compartido."
                : "Configura NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY para activar online."}
            </p>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 md:mt-0 md:justify-end">
            <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-stone-200">
              Tiempo
              <select
                value={clocks.controlId}
                onChange={handleTimeControlChange}
                disabled={timeControlLocked}
                className="rounded-md border border-white/10 bg-stone-950 px-2 py-1 text-sm text-stone-100 disabled:opacity-60"
              >
                {TIME_CONTROLS.map((control) => (
                  <option key={control.id} value={control.id}>
                    {control.label}
                  </option>
                ))}
              </select>
            </label>
            <ActionButton onClick={createNewGame}>Nueva partida</ActionButton>
            <ActionButton onClick={handleRandomSetup} disabled={isReviewing || !isSetupPhase(gameState)}>
              Posicion aleatoria
            </ActionButton>
            <ActionButton onClick={loadSavedGames}>Actualizar historial</ActionButton>
            <ActionLink href="/rules">Reglas</ActionLink>
            <ActionButton onClick={copyLink}>Copiar link</ActionButton>
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
          <InfoPanel title="Revision de jugadas">
            <div className="flex flex-wrap items-center gap-2">
              <ActionButton onClick={() => stepReview(-1)} disabled={visibleMoveIndex <= 0}>
                <span aria-hidden="true" className="text-xl leading-none">‹</span>
                <span className="sr-only">Anterior</span>
              </ActionButton>
              <ActionButton onClick={() => stepReview(1)} disabled={!reviewSnapshots.length || visibleMoveIndex >= reviewSnapshots.length - 1}>
                <span aria-hidden="true" className="text-xl leading-none">›</span>
                <span className="sr-only">Siguiente</span>
              </ActionButton>
              <ActionButton onClick={returnToLive} disabled={!isReviewing}>
                Volver al vivo
              </ActionButton>
              <span className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-stone-300">
                {reviewSnapshots.length ? `${visibleMoveIndex + 1}/${reviewSnapshots.length}` : "Sin historial"}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max={Math.max(0, reviewSnapshots.length - 1)}
              value={visibleMoveIndex}
              onChange={(event) => jumpReview(Number(event.target.value))}
              disabled={!reviewSnapshots.length}
              className="mt-3 w-full accent-amber-300"
              aria-label="Posicion en el historial de jugadas"
            />
            <p className="mt-2 text-xs text-stone-500">
              {isReviewing ? "Estas viendo una posicion anterior solo en este navegador." : historyStatus || "Vista actual en vivo."}
            </p>
          </InfoPanel>

          <InfoPanel title="Historial de partidas">
            <div className="hand-scroll max-h-40 space-y-2 overflow-y-auto pr-1">
              {savedGames.length ? (
                savedGames.map((game) => (
                  <button
                    key={game.id}
                    type="button"
                    onClick={() => enterGameReview(game.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left text-sm text-stone-200 transition hover:border-amber-300/50 hover:bg-amber-300/10"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">Sala {game.id}</span>
                      <span className="text-xs text-stone-500">
                        {game.local ? "local" : game.status} - {game.move_count || 0} jugadas
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-amber-200">Revisar</span>
                  </button>
                ))
              ) : (
                <p>No hay partidas guardadas en este navegador.</p>
              )}
            </div>
          </InfoPanel>
        </section>

        <section className="grid items-start gap-5 xl:grid-cols-[220px_minmax(520px,1fr)_220px]">
          <HandPanel
            color="red"
            state={visibleState}
            selected={selected}
            onSelect={selectHandPiece}
            onPass={() => handlePass("red")}
            canAct={canAct}
            onPreviewHoldStart={showHeldPreview}
            onPreviewClear={clearHeldPreview}
          />

          <section className="rounded-2xl border border-white/10 bg-[#11100e]/90 p-3 shadow-glow sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className={`rounded-full px-4 py-2 text-sm font-bold text-white ${visibleState.turn === "red" ? "bg-red-700" : "bg-sky-700"}`}>
                {visibleState.winner ? `Gana ${PLAYERS[visibleState.winner].label}` : isSetupPhase(visibleState) ? `Posicionamiento: ${turnLabel}` : `Turno ${turnLabel}`}
              </div>
              {isReviewing ? (
                <div className="rounded-full border border-amber-300/40 bg-amber-300/10 px-4 py-2 text-sm font-semibold text-amber-100">
                  Revisando jugada {visibleState.moveNumber || 0}
                </div>
              ) : null}
              {clocks.controlId !== "none" ? (
                <div className="flex items-center gap-2">
                  <ClockBadge color="red" clocks={clocks} />
                  <ClockBadge color="blue" clocks={clocks} />
                </div>
              ) : null}
              <label className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-stone-300">
                <input type="checkbox" checked={honorMode} onChange={(event) => setHonorMode(event.target.checked)} />
                Respetar turnos
              </label>
            </div>

            <div className="mx-auto grid aspect-square w-full max-w-[680px] board-grid overflow-visible rounded-xl border-[10px] border-[#211b14] bg-[#2a2118] shadow-2xl">
              {visibleState.board.map((rowCells, row) =>
                rowCells.map((stack, col) => {
                  const top = stack.length ? visibleState.pieces[stack[stack.length - 1]] : null;
                  const valid = !isReviewing && legalTargets.some((target) => sameTarget(target, { row, col }));
                  const isSelected = selectedCell?.row === row && selectedCell?.col === col;
                  const zone = row <= 2 ? "bg-red-950/35" : row >= 6 ? "bg-sky-950/35" : "bg-stone-900/80";
                  return (
                    <button
                      key={`${row}-${col}`}
                      type="button"
                      onClick={() => handleCellClick(row, col)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => handleDropOnCell(row, col, event)}
                      className={`relative border border-stone-700/70 p-1 transition hover:bg-amber-400/15 ${zone} ${valid ? "ring-2 ring-amber-300 ring-inset" : ""} ${isSelected ? "z-30 outline outline-2 outline-emerald-300" : ""}`}
                      aria-label={`Fila ${row + 1}, columna ${col + 1}`}
                    >
                      {top ? (
                        <PieceButton
                          piece={top}
                          state={visibleState}
                          source="board"
                          stackSize={stack.length}
                          selected={selected?.pieceId === top.id}
                          onPreviewHoldStart={showHeldPreview}
                          onPreviewClear={clearHeldPreview}
                          draggable={!isReviewing && !isSetupPhase(gameState) && canAct(top.color)}
                          onDragStart={(event) => {
                            if (isSetupPhase(gameState) || !canAct(top.color)) {
                              event.preventDefault();
                              return;
                            }
                            const from = { row, col };
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("application/json", JSON.stringify({ kind: "board", pieceId: top.id, from }));
                            setSelected({ kind: "board", pieceId: top.id, from });
                            setSelectedCell(from);
                            setLegalTargets(legalMovesFor(gameState, top.id));
                            setPreviewPiece(top.type);
                            setHeldPreview(null);
                          }}
                        />
                      ) : null}
                    </button>
                  );
                }),
              )}
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr]">
              <InfoPanel title="Seleccion">
                {selectedPiece ? (
                  <p>
                    {PIECES[selectedPiece.type].label} {PLAYERS[selectedPiece.color].label}
                  </p>
                ) : (
                  <p>{visibleState.log[0] || "Selecciona una pieza."}</p>
                )}
              </InfoPanel>
              <InfoPanel title="Torre">
                {currentTower?.length ? (
                  <div className="flex flex-wrap gap-2">
                    {currentTower.map((pieceId, index) => {
                      const piece = visibleState.pieces[pieceId];
                      const isRed = piece.color === "red";
                      return (
                        <div key={pieceId} className="flex w-[92px] flex-col items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-2 text-center">
                          <div
                            className={`relative grid h-12 w-12 place-items-center overflow-hidden rounded-md border-2 bg-stone-100/95 ${
                              isRed
                                ? "border-red-500 shadow-[inset_0_0_0_3px_rgba(220,38,38,0.32)]"
                                : "border-sky-500 shadow-[inset_0_0_0_3px_rgba(14,165,233,0.32)]"
                            }`}
                          >
                            <img src={pieceImage(piece)} alt={PIECES[piece.type].label} className="h-full w-full object-contain" />
                            <span className="absolute bottom-0 right-0 rounded bg-black/75 px-1 text-[10px] font-bold text-white">{index + 1}</span>
                          </div>
                          <span className="max-w-full truncate text-[11px] font-semibold text-stone-200">{PIECES[piece.type].label}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p>Selecciona una casilla ocupada.</p>
                )}
              </InfoPanel>
            </div>
          </section>

          <HandPanel
            color="blue"
            state={visibleState}
            selected={selected}
            onSelect={selectHandPiece}
            onPass={() => handlePass("blue")}
            canAct={canAct}
            onPreviewHoldStart={showHeldPreview}
            onPreviewClear={clearHeldPreview}
          />
        </section>

        <section className="grid gap-5 lg:grid-cols-[1fr_1fr]">
          <InfoPanel title="Previsualizacion">
            <select
              value={previewPiece}
              onChange={(event) => setPreviewPiece(event.target.value)}
              className="mb-3 w-full rounded-lg border border-white/10 bg-stone-950 px-3 py-2 text-sm text-stone-100"
            >
              {PIECE_ORDER.map((type) => (
                <option key={type} value={type}>
                  {PIECES[type].label}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2].map((level) => (
                <MiniBoard key={level} type={previewPiece} level={level} />
              ))}
            </div>
          </InfoPanel>

          <InfoPanel title="Actividad">
            <div className="space-y-2 text-sm">
              {visibleState.log.slice(0, 6).map((line, index) => (
                <p key={`${line}-${index}`} className="rounded-lg bg-white/5 px-3 py-2 text-stone-300">
                  {line}
                </p>
              ))}
            </div>
            <p className="mt-3 text-xs text-stone-500">
              {lastSavedAt ? `Ultima sincronizacion: ${lastSavedAt.toLocaleTimeString()}` : "Esperando sincronizacion."}
            </p>
          </InfoPanel>
        </section>

      </section>
      {heldPreview ? (
        <MovementPopover
          type={heldPreview.type}
          color={heldPreview.color}
          left={heldPreview.left}
          top={heldPreview.top}
          width={heldPreview.width}
        />
      ) : null}
      {showWinnerModal ? (
        <WinnerModal
          winner={gameState.winner}
          onClose={() => setDismissedWinnerMove(gameState.moveNumber)}
          onNewGame={createNewGame}
        />
      ) : null}
    </main>
  );
}

function ActionButton({ children, onClick, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-stone-100 transition hover:border-amber-300/50 hover:bg-amber-300/10 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function ActionLink({ children, href }) {
  return (
    <a
      href={href}
      className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-stone-100 transition hover:border-amber-300/50 hover:bg-amber-300/10"
    >
      {children}
    </a>
  );
}

function WinnerModal({ winner, onClose, onNewGame }) {
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="winner-title">
      <div className="w-full max-w-sm rounded-2xl border border-amber-300/30 bg-stone-950 p-5 text-center shadow-2xl">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-amber-200">Partida terminada</p>
        <h2 id="winner-title" className="font-display text-4xl font-bold text-stone-50">
          Gana {PLAYERS[winner].label}
        </h2>
        <p className="mt-3 text-sm text-stone-400">El resultado ya quedo guardado en esta sala.</p>
        <div className="mt-5 flex justify-center gap-2">
          <ActionButton onClick={onClose}>Cerrar</ActionButton>
          <ActionButton onClick={onNewGame}>Nueva partida</ActionButton>
        </div>
      </div>
    </div>
  );
}

function ClockBadge({ color, clocks }) {
  const active = clocks.activeColor === color;
  const colorClass = color === "red" ? "border-red-500/60 text-red-100" : "border-sky-500/60 text-sky-100";
  return (
    <div className={`min-w-[92px] rounded-lg border bg-black/35 px-3 py-2 text-center ${colorClass} ${active ? "ring-2 ring-amber-300" : ""}`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.14em]">{PLAYERS[color].label}</p>
      <p className="font-mono text-lg font-bold tabular-nums leading-none">{formatClockMs(clocks.remaining[color])}</p>
    </div>
  );
}

function InfoPanel({ title, children }) {
  return (
    <article className="rounded-2xl border border-white/10 bg-stone-950/75 p-4 shadow-xl">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.16em] text-amber-200">{title}</h2>
      <div className="text-sm text-stone-300">{children}</div>
    </article>
  );
}

function HandPanel({ color, state, selected, onSelect, onPass, canAct, onPreviewHoldStart, onPreviewClear }) {
  const pieces = [...state.hands[color]].sort((a, b) => PIECE_ORDER.indexOf(state.pieces[a].type) - PIECE_ORDER.indexOf(state.pieces[b].type));
  const isRed = color === "red";

  return (
    <aside className={`max-h-[680px] overflow-hidden rounded-2xl border border-white/10 bg-stone-950/80 p-3 shadow-xl ${isRed ? "border-t-red-500/70" : "border-t-sky-500/70"} border-t-4`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-xl font-bold leading-none">{PLAYERS[color].label}</h2>
          <p className="mt-1 text-xs text-stone-500">{pieces.length} en mano</p>
        </div>
        <button
          type="button"
          onClick={onPass}
          hidden={isSetupPhase(state)}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-stone-200 hover:bg-white/10"
        >
          Pasar
        </button>
      </div>
      <div className="hand-scroll grid max-h-[606px] grid-cols-5 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-8 xl:grid-cols-3">
        {pieces.map((pieceId) => (
          <button
            key={pieceId}
            type="button"
            onClick={() => onSelect(pieceId)}
            draggable={canAct(state.pieces[pieceId].color)}
            onDragStart={(event) => {
              if (!canAct(state.pieces[pieceId].color)) {
                event.preventDefault();
                return;
              }
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("application/json", JSON.stringify({ kind: "hand", pieceId }));
              onSelect(pieceId);
            }}
            disabled={!canAct(state.pieces[pieceId].color)}
            className="rounded-lg border border-white/10 bg-white/[0.04] p-0.5 transition hover:border-amber-300/50 disabled:opacity-35"
            title={PIECES[state.pieces[pieceId].type].label}
          >
            <PieceButton
              piece={state.pieces[pieceId]}
              state={state}
              source="hand"
              selected={selected?.pieceId === pieceId}
              onPreviewHoldStart={onPreviewHoldStart}
              onPreviewClear={onPreviewClear}
              compact
            />
          </button>
        ))}
      </div>
    </aside>
  );
}

function PieceButton({ piece, state, source, selected, onPreviewHoldStart, onPreviewClear, compact = false, draggable = false, onDragStart }) {
  const colorFrame =
    piece.color === "red"
      ? {
          shell: "border-red-500 bg-red-50 shadow-[inset_0_0_0_3px_rgba(220,38,38,0.34),0_0_0_1px_rgba(127,29,29,0.7)]",
        }
      : {
          shell: "border-sky-500 bg-sky-50 shadow-[inset_0_0_0_3px_rgba(14,165,233,0.34),0_0_0_1px_rgba(12,74,110,0.7)]",
        };

  return (
    <div
      draggable={draggable}
      onDragStart={(event) => {
        onPreviewClear?.();
        onDragStart?.(event);
      }}
      onPointerDown={(event) => onPreviewHoldStart?.(piece, event, source)}
      className={`relative grid aspect-square w-full place-items-center overflow-hidden rounded-lg border-2 ${colorFrame.shell} ${selected ? "ring-2 ring-amber-300" : ""} ${compact ? "min-h-[38px]" : ""}`}
    >
      <img src={pieceImage(piece)} alt={PIECES[piece.type].label} className="piece-img h-full w-full object-contain" />
      {source === "board" ? (
        <span className="pointer-events-none absolute bottom-0 left-0 min-w-4 rounded-tr bg-black/70 px-1 py-0.5 text-center text-[9px] font-bold leading-none text-white sm:bottom-1 sm:left-1 sm:rounded sm:px-1.5 sm:text-[10px]">
          {pieceLevel(state, piece.id) + 1}
        </span>
      ) : null}
    </div>
  );
}

function MovementPopover({ type, color, left, top, width }) {
  return (
    <div
      className="pointer-events-none fixed z-50 -translate-x-1/2 rounded-lg border border-amber-300/40 bg-stone-950/95 p-2 shadow-2xl"
      style={{ left, top, width }}
    >
      <div className="grid grid-cols-3 gap-2">
        {[0, 1, 2].map((level) => (
          <MiniBoard key={level} type={type} color={color} level={level} compact />
        ))}
      </div>
    </div>
  );
}

function MiniBoard({ type, color = "blue", level, compact = false }) {
  const marks = compact ? orientedPreviewMarks(type, level, color) : previewMarks(type, level);
  const prefix = compact ? PLAYERS[color].prefix : "B";
  return (
    <div>
      <p className={`${compact ? "mb-1 px-1 py-0.5 text-[9px]" : "mb-1 px-2 py-1 text-xs"} rounded bg-black text-center font-bold text-stone-300`}>Nivel {level + 1}</p>
      <div className="grid aspect-square grid-cols-5 overflow-hidden rounded-lg border border-white/10 bg-stone-900">
        {Array.from({ length: 25 }).map((_, index) => {
          const r = Math.floor(index / 5);
          const c = index % 5;
          const isOrigin = r === 2 && c === 2;
          const move = marks.some(([mr, mc]) => mr === r && mc === c);
          return (
            <div key={index} className={`grid place-items-center border border-white/5 ${move ? "bg-amber-300/55" : "bg-white/[0.03]"}`}>
              {isOrigin ? <img src={`/assets/${prefix}${type}.png`} alt={PIECES[type].label} className={`${compact ? "h-full w-full" : "h-4/5 w-4/5"} object-contain`} /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function orientedPreviewMarks(type, level, color) {
  const marks = previewMarks(type, level);
  if (color !== "blue") return marks;
  return marks.map(([r, c]) => [4 - r, c]);
}

export default function Page() {
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center bg-stone-950 text-stone-100">Cargando partida...</main>}>
      <GamePageInner />
    </Suspense>
  );
}
