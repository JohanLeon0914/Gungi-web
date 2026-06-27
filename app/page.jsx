"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import {
  BOARD_SIZE,
  PIECES,
  PIECE_ORDER,
  PLAYERS,
  applyMove,
  applyPass,
  applyPlacement,
  completeAction,
  createInitialState,
  createRoomId,
  isSetupPhase,
  legalDropsFor,
  legalMovesFor,
  normalizeState,
  pieceImage,
  pieceLevel,
  piecePosition,
  previewMarks,
  sameTarget,
  structuredCloneSafe,
  topPiece,
} from "@/lib/gungiRules";

function GamePageInner() {
  const searchParams = useSearchParams();
  const initialRoomId = searchParams.get("id") || "loading";
  const [roomId, setRoomId] = useState(initialRoomId);
  const [gameState, setGameStateRaw] = useState(() => createInitialState(initialRoomId));
  const [selected, setSelected] = useState(null);
  const [selectedCell, setSelectedCell] = useState(null);
  const [legalTargets, setLegalTargets] = useState([]);
  const [previewPiece, setPreviewPiece] = useState("Commander");
  const [honorMode, setHonorMode] = useState(true);
  const [syncStatus, setSyncStatus] = useState(isSupabaseConfigured ? "Conectando" : "Sin Supabase");
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const stateRef = useRef(gameState);
  const roomRef = useRef(roomId);
  const clientIdRef = useRef("");
  const syncInFlightRef = useRef(false);

  const setGameState = useCallback((next) => {
    stateRef.current = next;
    setGameStateRaw(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(`gungi-web:${next.roomId}`, JSON.stringify(next));
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
      const localMoveNumber = stateRef.current.moveNumber || 0;
      const remoteMoveNumber = normalized.moveNumber || 0;
      if (remoteMoveNumber <= localMoveNumber) return false;

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

  const roomUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/?id=${roomId}`;
  }, [roomId]);

  const canAct = useCallback(
    (color) => {
      if (gameState.winner) return false;
      if (isSetupPhase(gameState)) return gameState.turn === color;
      return !honorMode || gameState.turn === color;
    },
    [gameState, honorMode],
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
    const piece = gameState.pieces[pieceId];
    if (!canAct(piece.color)) return;
    setSelected({ kind: "hand", pieceId });
    setSelectedCell(null);
    setLegalTargets(legalDropsFor(gameState, pieceId));
  };

  const selectBoardPiece = (pieceId) => {
    const piece = gameState.pieces[pieceId];
    const pos = piecePosition(gameState, pieceId);
    if (!pos) return;
    const stack = gameState.board[pos.row][pos.col];
    if (stack[stack.length - 1] !== pieceId || isSetupPhase(gameState) || !canAct(piece.color)) {
      setSelected({ kind: "inspect", pieceId });
      setSelectedCell(pos);
      setLegalTargets(legalMovesFor(gameState, pieceId));
      return;
    }
    setSelected({ kind: "board", pieceId, from: pos });
    setSelectedCell(pos);
    setLegalTargets(legalMovesFor(gameState, pieceId));
  };

  const handleCellClick = (row, col) => {
    if (selected && selected.kind !== "inspect" && legalTargets.some((target) => sameTarget(target, { row, col }))) {
      const result =
        selected.kind === "hand"
          ? applyPlacement(gameState, selected.pieceId, row, col)
          : applyMove(gameState, selected.pieceId, selected.from, row, col);
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
    const raw = event.dataTransfer.getData("application/json");
    if (!raw) return;

    try {
      const dragged = JSON.parse(raw);
      const targets = dragged.kind === "hand" ? legalDropsFor(gameState, dragged.pieceId) : legalMovesFor(gameState, dragged.pieceId);
      if (!targets.some((target) => sameTarget(target, { row, col }))) return;

      const result =
        dragged.kind === "hand"
          ? applyPlacement(gameState, dragged.pieceId, row, col)
          : applyMove(gameState, dragged.pieceId, dragged.from, row, col);
      commitAction(result.next, result.action, { row, col });
    } catch {
      return;
    }
  };

  const handlePass = (color) => {
    if (isSetupPhase(gameState) || !canAct(color)) return;
    const { next, action } = applyPass(gameState, color);
    setGameState(next);
    resetSelection();
    saveOnline(next, action);
  };

  const createNewGame = () => {
    const nextRoomId = createRoomId();
    const next = createInitialState(nextRoomId);
    roomRef.current = nextRoomId;
    setRoomId(nextRoomId);
    setGameState(next);
    resetSelection();
    window.history.replaceState(null, "", `/?id=${nextRoomId}`);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(roomUrl);
      setSyncStatus("Link copiado");
    } catch {
      setSyncStatus("No se pudo copiar");
    }
  };

  const turnLabel = PLAYERS[gameState.turn].label;
  const selectedPiece = selected?.pieceId ? gameState.pieces[selected.pieceId] : null;
  const currentTower = selectedCell ? gameState.board[selectedCell.row][selectedCell.col] : [];

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
          <div className="mt-4 flex flex-wrap gap-2 md:mt-0 md:justify-end">
            <ActionButton onClick={createNewGame}>Nueva partida</ActionButton>
            <ActionButton onClick={copyLink}>Copiar link</ActionButton>
          </div>
        </header>

        <section className="grid items-start gap-5 xl:grid-cols-[220px_minmax(520px,1fr)_220px]">
          <HandPanel
            color="red"
            state={gameState}
            selected={selected}
            onSelect={selectHandPiece}
            onPass={() => handlePass("red")}
            canAct={canAct}
          />

          <section className="rounded-2xl border border-white/10 bg-[#11100e]/90 p-3 shadow-glow sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className={`rounded-full px-4 py-2 text-sm font-bold text-white ${gameState.turn === "red" ? "bg-red-700" : "bg-sky-700"}`}>
                {gameState.winner ? `Gana ${PLAYERS[gameState.winner].label}` : isSetupPhase(gameState) ? `Posicionamiento: ${turnLabel}` : `Turno ${turnLabel}`}
              </div>
              <label className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-stone-300">
                <input type="checkbox" checked={honorMode} onChange={(event) => setHonorMode(event.target.checked)} />
                Respetar turnos
              </label>
            </div>

            <div className="mx-auto grid aspect-square w-full max-w-[680px] board-grid overflow-hidden rounded-xl border-[10px] border-[#211b14] bg-[#2a2118] shadow-2xl">
              {gameState.board.map((rowCells, row) =>
                rowCells.map((stack, col) => {
                  const top = stack.length ? gameState.pieces[stack[stack.length - 1]] : null;
                  const valid = legalTargets.some((target) => sameTarget(target, { row, col }));
                  const isSelected = selectedCell?.row === row && selectedCell?.col === col;
                  const zone = row <= 2 ? "bg-red-950/35" : row >= 6 ? "bg-sky-950/35" : "bg-stone-900/80";
                  return (
                    <button
                      key={`${row}-${col}`}
                      type="button"
                      onClick={() => handleCellClick(row, col)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => handleDropOnCell(row, col, event)}
                      className={`relative border border-stone-700/70 p-1 transition hover:bg-amber-400/15 ${zone} ${valid ? "ring-2 ring-amber-300 ring-inset" : ""} ${isSelected ? "outline outline-2 outline-emerald-300" : ""}`}
                      aria-label={`Fila ${row + 1}, columna ${col + 1}`}
                    >
                      {top ? (
                        <PieceButton
                          piece={top}
                          state={gameState}
                          source="board"
                          stackSize={stack.length}
                          selected={selected?.pieceId === top.id}
                          draggable={!isSetupPhase(gameState) && canAct(top.color)}
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
                  <p>{gameState.log[0] || "Selecciona una pieza."}</p>
                )}
              </InfoPanel>
              <InfoPanel title="Torre">
                {currentTower?.length ? (
                  <div className="flex flex-wrap gap-2">
                    {currentTower.map((pieceId, index) => {
                      const piece = gameState.pieces[pieceId];
                      return (
                        <span key={pieceId} className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-stone-300">
                          N{index + 1} {PIECES[piece.type].label}
                        </span>
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
            state={gameState}
            selected={selected}
            onSelect={selectHandPiece}
            onPass={() => handlePass("blue")}
            canAct={canAct}
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
              {gameState.log.slice(0, 6).map((line, index) => (
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
    </main>
  );
}

function ActionButton({ children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-stone-100 transition hover:border-amber-300/50 hover:bg-amber-300/10"
    >
      {children}
    </button>
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

function HandPanel({ color, state, selected, onSelect, onPass, canAct }) {
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
            <PieceButton piece={state.pieces[pieceId]} state={state} source="hand" selected={selected?.pieceId === pieceId} compact />
          </button>
        ))}
      </div>
    </aside>
  );
}

function PieceButton({ piece, state, source, stackSize, selected, compact = false, draggable = false, onDragStart }) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      className={`relative grid aspect-square w-full place-items-center overflow-hidden rounded-lg border bg-stone-100/95 ${compact ? "min-h-[38px]" : ""} ${piece.color === "red" ? "border-red-700" : "border-sky-700"} ${selected ? "ring-2 ring-amber-300" : ""}`}
    >
      <img src={pieceImage(piece)} alt={PIECES[piece.type].label} className="piece-img h-full w-full object-contain" />
      {source === "board" ? (
        <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white">
          {pieceLevel(state, piece.id) + 1}
        </span>
      ) : null}
      {stackSize > 1 ? (
        <span className="absolute bottom-1 left-1 rounded bg-emerald-800/90 px-1.5 py-0.5 text-[10px] font-bold text-white">
          x{stackSize}
        </span>
      ) : null}
    </div>
  );
}

function MiniBoard({ type, level }) {
  const marks = previewMarks(type, level);
  return (
    <div>
      <p className="mb-1 rounded bg-black px-2 py-1 text-center text-xs font-bold text-stone-300">Nivel {level + 1}</p>
      <div className="grid aspect-square grid-cols-5 overflow-hidden rounded-lg border border-white/10 bg-stone-900">
        {Array.from({ length: 25 }).map((_, index) => {
          const r = Math.floor(index / 5);
          const c = index % 5;
          const isOrigin = r === 2 && c === 2;
          const move = marks.some(([mr, mc]) => mr === r && mc === c);
          return (
            <div key={index} className={`grid place-items-center border border-white/5 ${move ? "bg-amber-300/55" : "bg-white/[0.03]"}`}>
              {isOrigin ? <img src={`/assets/B${type}.png`} alt={PIECES[type].label} className="h-4/5 w-4/5 object-contain" /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center bg-stone-950 text-stone-100">Cargando partida...</main>}>
      <GamePageInner />
    </Suspense>
  );
}
