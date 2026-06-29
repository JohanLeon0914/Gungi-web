import { PIECES, PIECE_ORDER, PLAYERS, previewMarks } from "@/lib/gungiRules";

const RULE_SUMMARY = [
  "Cada jugador coloca sus piezas en sus tres filas antes de empezar la batalla.",
  "Una torre puede tener hasta tres piezas. Solo la pieza superior puede moverse.",
  "Las piezas capturadas cambian de color y pasan a la mano del jugador que captura.",
  "La Fortaleza no se mueve ni se captura. La Catapulta y la Fortaleza solo se colocan en el nivel inferior.",
  "La partida termina cuando se captura al Comandante rival o cuando un jugador pierde por tiempo.",
];

const PIECE_RULES = {
  Commander: "Mueve un paso en cualquier direccion.",
  Captain: "Nivel 1: frente y diagonales defensivas. Nivel 2: frente completo y diagonales traseras. Nivel 3: diagonales y saltos laterales.",
  Samurai: "Nivel 1: frente y lados. Niveles superiores: dos casillas verticales, lados y diagonales frontales.",
  Spy: "Salta dos hacia adelante y una columna al lado. En niveles superiores suma diagonales frontales.",
  Catapult: "No se mueve. Puede lanzar una torre propia si queda debajo de las piezas que se lanzan.",
  Fortress: "No se mueve. Sirve como base defensiva para torres propias y bloquea capturas rivales.",
  HiddenDragon: "Se mueve en linea recta por filas o columnas. En niveles superiores suma diagonales de un paso.",
  Prodigy: "Se mueve en diagonal. En niveles superiores suma pasos ortogonales.",
  Bow: "Usa saltos largos frontales y laterales segun el nivel.",
  Pawn: "Avanza hacia adelante. En niveles superiores suma laterales largos o diagonales frontales.",
};

export default function RulesPage() {
  return (
    <main className="min-h-screen px-4 py-6 text-stone-100 sm:px-6 lg:px-8">
      <section className="mx-auto flex max-w-6xl flex-col gap-5">
        <header className="rounded-2xl border border-white/10 bg-stone-950/80 p-5 shadow-glow">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-amber-200">Guia de Gungi</p>
              <h1 className="font-display text-4xl font-bold text-stone-50 md:text-5xl">Reglas y movimientos</h1>
            </div>
            <a
              href="/"
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-stone-100 transition hover:border-amber-300/50 hover:bg-amber-300/10"
            >
              Volver
            </a>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-2">
          {RULE_SUMMARY.map((rule) => (
            <article key={rule} className="rounded-xl border border-white/10 bg-stone-950/70 p-4 text-sm leading-relaxed text-stone-300 shadow-xl">
              {rule}
            </article>
          ))}
        </section>

        <section className="grid gap-4">
          {PIECE_ORDER.map((type) => (
            <article key={type} className="rounded-2xl border border-white/10 bg-stone-950/75 p-4 shadow-xl">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="grid h-12 w-12 place-items-center rounded-lg border border-sky-400/40 bg-stone-100">
                    <img src={`/assets/${PLAYERS.blue.prefix}${type}.png`} alt={PIECES[type].label} className="h-full w-full object-contain" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-stone-50">{PIECES[type].label}</h2>
                    <p className="text-sm text-stone-400">{PIECE_RULES[type]}</p>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {[0, 1, 2].map((level) => (
                  <MoveBoard key={level} type={type} level={level} />
                ))}
              </div>
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}

function MoveBoard({ type, level }) {
  const marks = previewMarks(type, level);

  return (
    <div>
      <p className="mb-2 rounded bg-black/70 px-2 py-1 text-center text-xs font-bold text-stone-300">Nivel {level + 1}</p>
      <div className="grid aspect-square grid-cols-5 overflow-hidden rounded-xl border border-white/10 bg-stone-900">
        {Array.from({ length: 25 }).map((_, index) => {
          const row = Math.floor(index / 5);
          const col = index % 5;
          const isOrigin = row === 2 && col === 2;
          const canMove = marks.some(([moveRow, moveCol]) => moveRow === row && moveCol === col);

          return (
            <div
              key={index}
              className={`grid place-items-center border border-white/5 ${canMove ? "bg-amber-300/55" : "bg-white/[0.03]"}`}
            >
              {isOrigin ? (
                <img src={`/assets/${PLAYERS.blue.prefix}${type}.png`} alt="" className="h-4/5 w-4/5 object-contain" />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
