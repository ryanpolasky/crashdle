import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
} from "react";
import { AnimatePresence, motion } from "framer-motion";

type LetterStatus = "correct" | "present" | "absent" | "empty";
type Phase = "word" | "bet" | "crash" | "done";
type CrashState = "ready" | "countdown" | "running" | "cashed" | "busted";

interface SavedState {
    dayNumber: number;
    guesses: string[];
    phase: Phase;
    betAmount: number;
    cashOutMultiplier: number | null;
    finalAmount: number;
}

interface DailyPuzzle {
    word: string;
    crashPoint: number;
    day: number;
}

interface CrashHistoryEntry {
    day: number;
    crashPoint: number;
}

interface StoredStats {
    gamesPlayed: number;
    wins: number;
    currentStreak: number;
    bestStreak: number;
    lastCompletedDay: number | null;
    guessDistribution: number[];
}

const ACCENT = "#8b5cf6";
const WORD_LENGTH = 5;
const MAX_GUESSES = 6;
const MULTIPLIER_SPEED = 0.08;
const STORAGE_KEY = "crashdle-state-v2";
const STATS_KEY = "crashdle-stats-v2";

const REWARDS: Record<number, number> = {
    1: 10000,
    2: 5000,
    3: 3000,
    4: 1800,
    5: 1200,
    6: 800,
};

const STATUS_COLORS: Record<LetterStatus, string> = {
    correct: "#538d4e",
    present: "#b59f3b",
    absent: "#3a3a3c",
    empty: "transparent",
};

const STATUS_EMOJI: Record<Exclude<LetterStatus, "empty">, string> = {
    correct: "🟩",
    present: "🟨",
    absent: "⬛",
};

const KB_ROWS = [
    ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
    ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
    ["ENTER", "Z", "X", "C", "V", "B", "N", "M", "⌫"],
] as const;

const ROOT_BG: CSSProperties = {
    background: `
    radial-gradient(circle at top, rgba(139,92,246,0.20), transparent 28%),
    radial-gradient(circle at 85% 15%, rgba(34,197,94,0.10), transparent 18%),
    radial-gradient(circle at 15% 80%, rgba(59,130,246,0.10), transparent 20%),
    linear-gradient(180deg, #18181b 0%, #121213 40%, #0d0d0f 100%)
  `,
};

function canUseDOM() {
    return typeof window !== "undefined";
}

function alpha(hex: string, a: string) {
    return `${hex}${a}`;
}

function hexToHsl(hex: string): [number, number, number] {
    const c = hex.replace("#", "");
    const r = parseInt(c.substring(0, 2), 16) / 255;
    const g = parseInt(c.substring(2, 4), 16) / 255;
    const b = parseInt(c.substring(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r:
                h = (g - b) / d + (g < b ? 6 : 0);
                break;
            case g:
                h = (b - r) / d + 2;
                break;
            default:
                h = (r - g) / d + 4;
        }
        h /= 6;
    }
    return [h * 360, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number) {
    s /= 100;
    l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * Math.max(0, Math.min(1, color)))
            .toString(16)
            .padStart(2, "0");
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

function toButtonBg(hex: string) {
    const [h, s, l] = hexToHsl(hex);
    return hslToHex(h, Math.min(s + 5, 100), Math.min(l, 28));
}

const BUTTON_BG = toButtonBg(ACCENT);

async function fetchDailyPuzzle(): Promise<DailyPuzzle> {
    const res = await fetch("/api/crashdle/today");
    if (!res.ok) throw new Error("Failed to fetch puzzle");
    return res.json();
}

async function fetchCrashHistory(count = 5): Promise<CrashHistoryEntry[]> {
    const res = await fetch(`/api/crashdle/history?count=${count}`);
    if (!res.ok) return [];
    return res.json();
}

async function fetchValidWords(): Promise<Set<string>> {
    const res = await fetch("/api/crashdle/words");
    if (!res.ok) return new Set();
    const words: string[] = await res.json();
    return new Set(words.map((w) => w.toUpperCase()));
}

function evaluate(guess: string, answer: string): LetterStatus[] {
    const result: LetterStatus[] = Array(WORD_LENGTH).fill("absent");
    const used = Array(WORD_LENGTH).fill(false);
    const g = guess.split("");
    const a = answer.split("");
    for (let i = 0; i < WORD_LENGTH; i++) {
        if (g[i] === a[i]) {
            result[i] = "correct";
            used[i] = true;
        }
    }
    for (let i = 0; i < WORD_LENGTH; i++) {
        if (result[i] === "correct") continue;
        for (let j = 0; j < WORD_LENGTH; j++) {
            if (!used[j] && g[i] === a[j]) {
                result[i] = "present";
                used[j] = true;
                break;
            }
        }
    }
    return result;
}

function getEarnedFromGuesses(guesses: string[], answer: string) {
    if (!guesses.length) return 0;
    return guesses[guesses.length - 1] === answer
        ? REWARDS[guesses.length] ?? 0
        : 0;
}

function loadState(day: number): SavedState | null {
    if (!canUseDOM()) return null;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const p = JSON.parse(raw) as SavedState;
        return p.dayNumber === day ? p : null;
    } catch {
        return null;
    }
}

function saveState(s: SavedState) {
    if (canUseDOM()) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

function clearState() {
    if (canUseDOM()) localStorage.removeItem(STORAGE_KEY);
}

function defaultStats(): StoredStats {
    return {
        gamesPlayed: 0,
        wins: 0,
        currentStreak: 0,
        bestStreak: 0,
        lastCompletedDay: null,
        guessDistribution: [0, 0, 0, 0, 0, 0],
    };
}

function loadStats(): StoredStats {
    if (!canUseDOM()) return defaultStats();
    try {
        const raw = localStorage.getItem(STATS_KEY);
        if (!raw) return defaultStats();
        const p = JSON.parse(raw) as StoredStats;
        return {
            ...defaultStats(),
            ...p,
            guessDistribution: Array.isArray(p.guessDistribution)
                ? p.guessDistribution.slice(0, 6)
                : [0, 0, 0, 0, 0, 0],
        };
    } catch {
        return defaultStats();
    }
}

function saveStats(s: StoredStats) {
    if (canUseDOM()) localStorage.setItem(STATS_KEY, JSON.stringify(s));
}

function updateStoredStats(
    day: number,
    solved: boolean,
    guessCount: number,
): StoredStats {
    const stats = loadStats();
    if (stats.lastCompletedDay === day) return stats;
    const next = { ...stats };
    next.gamesPlayed += 1;
    next.lastCompletedDay = day;
    if (solved) {
        next.wins += 1;
        next.currentStreak =
            stats.lastCompletedDay === day - 1 ? stats.currentStreak + 1 : 1;
        next.bestStreak = Math.max(next.bestStreak, next.currentStreak);
        if (guessCount >= 1 && guessCount <= 6)
            next.guessDistribution[guessCount - 1] += 1;
    } else {
        next.currentStreak = 0;
    }
    saveStats(next);
    return next;
}

function buildShareText(
    day: number,
    guesses: string[],
    answer: string,
    finalAmount: number,
) {
    const solved = guesses.length > 0 && guesses[guesses.length - 1] === answer;
    let text = `Crashdle #${day}\n`;
    for (const g of guesses) {
        text += `${evaluate(g, answer)
            .map((s) =>
                s === "empty" ? "" : STATUS_EMOJI[s as Exclude<LetterStatus, "empty">],
            )
            .join("")}\n`;
    }
    text += solved
        ? `Solved in ${guesses.length}/${MAX_GUESSES}\n`
        : "Missed it\n";
    text += `Final: $${finalAmount.toLocaleString()} 💰`;
    return text.trim();
}

function TickingNumber({
                           value,
                           duration = 500,
                           className,
                           style,
                       }: {
    value: number;
    duration?: number;
    className?: string;
    style?: CSSProperties;
}) {
    const [display, setDisplay] = useState(value);
    const raf = useRef(0);
    const cur = useRef(value);

    useEffect(() => {
        const from = cur.current;
        if (from === value) return;
        const start = performance.now();
        const tick = () => {
            const t = Math.min((performance.now() - start) / duration, 1);
            const eased = 1 - (1 - t) * (1 - t);
            const v = Math.round(from + (value - from) * eased);
            cur.current = v;
            setDisplay(v);
            if (t < 1) raf.current = requestAnimationFrame(tick);
        };
        raf.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf.current);
    }, [value, duration]);

    return (
        <span className={className} style={style}>
      {display.toLocaleString()}
    </span>
    );
}

function CountdownToMidnight() {
    const [label, setLabel] = useState("00:00:00");

    useEffect(() => {
        const update = () => {
            const now = new Date();
            const next = new Date(now);
            next.setHours(24, 0, 0, 0);
            const diff = Math.max(0, next.getTime() - now.getTime());
            const h = Math.floor(diff / 3_600_000);
            const m = Math.floor((diff % 3_600_000) / 60_000);
            const s = Math.floor((diff % 60_000) / 1000);
            setLabel([h, m, s].map((v) => String(v).padStart(2, "0")).join(":"));
        };
        update();
        const id = window.setInterval(update, 1000);
        return () => window.clearInterval(id);
    }, []);

    return <span>{label}</span>;
}

function ModalShell({
                        open,
                        onClose,
                        closeDisabled = false,
                        children,
                        widthClass = "max-w-lg",
                    }: {
    open: boolean;
    onClose?: () => void;
    closeDisabled?: boolean;
    children: React.ReactNode;
    widthClass?: string;
}) {
    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-md"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => !closeDisabled && onClose?.()}
                >
                    <motion.div
                        className={`relative w-full ${widthClass} max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[28px] border border-white/10 bg-[#18181d]/95 shadow-[0_30px_80px_rgba(0,0,0,0.45)] flex flex-col`}
                        initial={{ opacity: 0, y: 24, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 18, scale: 0.98 }}
                        transition={{ duration: 0.18 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {!closeDisabled && onClose && (
                            <button
                                onClick={onClose}
                                className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-lg text-white/70 transition hover:bg-white/10 hover:text-white"
                            >
                                ✕
                            </button>
                        )}
                        {children}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

function TileGrid({
                      guesses,
                      currentGuess,
                      answer,
                      shakeRow,
                  }: {
    guesses: string[];
    currentGuess: string;
    answer: string;
    shakeRow: number;
}) {
    const rows: { letters: string[]; statuses: LetterStatus[] }[] = [];
    for (let r = 0; r < MAX_GUESSES; r++) {
        if (r < guesses.length) {
            rows.push({
                letters: guesses[r].split(""),
                statuses: evaluate(guesses[r], answer),
            });
        } else if (r === guesses.length) {
            rows.push({
                letters: currentGuess
                    .padEnd(WORD_LENGTH)
                    .split("")
                    .slice(0, WORD_LENGTH),
                statuses: Array(WORD_LENGTH).fill("empty"),
            });
        } else {
            rows.push({
                letters: Array(WORD_LENGTH).fill(""),
                statuses: Array(WORD_LENGTH).fill("empty"),
            });
        }
    }

    return (
        <div className="flex flex-col items-center gap-1 md:gap-1.5">
            {rows.map((row, ri) => (
                <motion.div
                    key={ri}
                    className="flex gap-1 md:gap-1.5"
                    animate={
                        shakeRow === ri ? { x: [0, -8, 8, -7, 7, -5, 5, 0] } : undefined
                    }
                    transition={{ duration: 0.42 }}
                >
                    {row.letters.map((letter, ci) => {
                        const revealed = ri < guesses.length;
                        const status = row.statuses[ci];
                        const bg = revealed
                            ? STATUS_COLORS[status]
                            : "rgba(255,255,255,0.02)";
                        const border = revealed
                            ? STATUS_COLORS[status]
                            : letter.trim()
                                ? alpha(ACCENT, "88")
                                : "rgba(255,255,255,0.14)";

                        return (
                            <motion.div
                                key={`${ri}-${ci}`}
                                className="flex items-center justify-center rounded-xl border-2 text-lg font-black uppercase text-white md:text-2xl"
                                style={{
                                    width: "clamp(2.8rem, min(10.6vw, 5.9vh), 3.9rem)",
                                    height: "clamp(2.8rem, min(10.6vw, 5.9vh), 3.9rem)",
                                    backgroundColor: bg,
                                    borderColor: border,
                                    boxShadow: revealed
                                        ? `inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 24px ${alpha(STATUS_COLORS[status], "22")}`
                                        : "inset 0 1px 0 rgba(255,255,255,0.04)",
                                }}
                                initial={false}
                                animate={
                                    revealed
                                        ? { rotateX: [90, 0], scale: [1, 1.06, 1], opacity: 1 }
                                        : letter.trim()
                                            ? { scale: [0.96, 1.04, 1] }
                                            : undefined
                                }
                                transition={
                                    revealed
                                        ? { delay: ci * 0.12, duration: 0.35 }
                                        : { duration: 0.14 }
                                }
                            >
                                {letter}
                            </motion.div>
                        );
                    })}
                </motion.div>
            ))}
        </div>
    );
}

function Keyboard({
                      onKey,
                      letterStates,
                      disabled = false,
                  }: {
    onKey: (key: string) => void;
    letterStates: Record<string, LetterStatus>;
    disabled?: boolean;
}) {
    return (
        <div
            className={`flex flex-col items-center gap-1 transition ${disabled ? "pointer-events-none opacity-50" : ""}`}
        >
            {KB_ROWS.map((row) => (
                <div key={row.join("")} className="flex w-full justify-center gap-1">
                    {row.map((key) => {
                        const wide = key === "ENTER" || key === "⌫";
                        const status = letterStates[key];
                        const bg = status
                            ? STATUS_COLORS[status]
                            : "rgba(255,255,255,0.14)";

                        return (
                            <button
                                key={key}
                                onClick={() => onKey(key)}
                                disabled={disabled}
                                className={`flex items-center justify-center rounded-lg font-bold text-white transition active:scale-95 ${
                                    wide
                                        ? "px-2 text-[10px] md:text-xs"
                                        : "text-[11px] md:text-sm"
                                }`}
                                style={{
                                    width: wide
                                        ? "clamp(2.8rem, min(12vw, 7.2vh), 4.4rem)"
                                        : "clamp(1.8rem, min(8.2vw, 5.2vh), 2.8rem)",
                                    height: "clamp(2rem, min(7.2vw, 4.5vh), 2.9rem)",
                                    backgroundColor: bg,
                                    opacity: status === "absent" ? 0.5 : 1,
                                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
                                }}
                            >
                                {key}
                            </button>
                        );
                    })}
                </div>
            ))}
        </div>
    );
}

function HelpModal({
                       open,
                       onClose,
                   }: {
    open: boolean;
    onClose: () => void;
}) {
    const items = [
        "Guess the 5-letter word in 6 tries. Green means right spot, yellow means wrong spot, gray means not in the word.",
        "Solve faster to win more: $10,000 on guess 1, then $5,000, $3,000, $1,800, $1,200, and 800 on guess 6.",
        "If you solve the word game, you unlock the bonus round. Risk some of your winnings or keep everything safe.",
        "In the crash round, the multiplier rises from 1.00x. Cash out before the crash to multiply your wager or lose that portion when it crashes.",
    ];

    return (
        <ModalShell open={open} onClose={onClose} widthClass="max-w-xl">
            <div className="px-6 pb-6 pt-7 md:px-8">
                <div className="mb-2 text-center text-xs uppercase tracking-[0.28em] text-violet-300/80">
                    How to play
                </div>
                <div className="mb-6 text-center text-3xl font-black text-white">
                    Crash<span style={{ color: "#c4b5fd" }}>dle</span>
                </div>
                <div className="space-y-4 text-sm leading-6 text-white/70">
                    {items.map((t, i) => (
                        <div
                            key={i}
                            className="rounded-2xl border border-white/10 bg-white/5 p-4"
                        >
                            {t}
                        </div>
                    ))}
                </div>
                <div className="mt-4 text-center text-sm tracking-wide text-white/60">
                    made w/ love by{" "}
                    <a
                        href="https://www.linkedin.com/in/ryan-polasky/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold transition-opacity hover:opacity-80"
                        style={{ color: "#c4b5fd" }}
                    >
                        ryan polasky
                    </a>
                </div>
            </div>
        </ModalShell>
    );
}

function BetModal({
                      open,
                      earned,
                      onConfirm,
                  }: {
    open: boolean;
    earned: number;
    onConfirm: (betAmount: number) => void;
}) {
    const [selected, setSelected] = useState<
        "none" | "half" | "full" | "custom"
    >("full");
    const [customValue, setCustomValue] = useState("");

    useEffect(() => {
        if (!open) {
            setSelected("full");
            setCustomValue("");
        }
    }, [open]);

    const betAmount = useMemo(() => {
        switch (selected) {
            case "none":
                return 0;
            case "half":
                return Math.round(earned / 2);
            case "full":
                return earned;
            case "custom": {
                const v = parseInt(customValue, 10);
                return Number.isNaN(v) || v <= 0 ? 0 : Math.min(v, earned);
            }
        }
    }, [selected, customValue, earned]);

    const safeAmount = earned - betAmount;
    const presets = [
        { id: "none" as const, label: "Keep all" },
        { id: "half" as const, label: "Half" },
        { id: "full" as const, label: "All in" },
    ];

    return (
        <ModalShell open={open} closeDisabled widthClass="max-w-xl">
            <div className="px-6 pb-6 pt-7 md:px-8">
                <div className="mb-2 text-center text-xs uppercase tracking-[0.28em] text-violet-300/80">
                    Bonus unlocked
                </div>
                <div className="mb-1 text-center text-3xl font-black text-white">
                    Risk your winnings?
                </div>
                <div className="mb-6 text-center text-white/60">
                    Keep it classic and bank everything, or send some into the crash
                    round.
                </div>

                <div className="mb-6 rounded-[28px] border border-violet-400/20 bg-gradient-to-br from-violet-500/15 to-white/5 p-5 text-center">
                    <div className="text-xs uppercase tracking-[0.24em] text-white/45">
                        Guaranteed bank
                    </div>
                    <div className="mt-2 text-5xl font-black text-white">
                        {earned.toLocaleString()}
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                    {presets.map((o) => {
                        const active = selected === o.id;
                        return (
                            <button
                                key={o.id}
                                onClick={() => setSelected(o.id)}
                                className={`rounded-2xl border px-4 py-3 text-sm font-bold transition ${
                                    active
                                        ? "border-violet-300/40 text-white"
                                        : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
                                }`}
                                style={active ? { backgroundColor: BUTTON_BG } : undefined}
                            >
                                {o.label}
                            </button>
                        );
                    })}
                </div>

                <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-3">
                    <div className="mb-2 flex items-center justify-between">
            <span className="text-xs uppercase tracking-[0.24em] text-white/45">
              Custom wager
            </span>
                        <button
                            onClick={() => setSelected("custom")}
                            className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                                selected === "custom"
                                    ? "text-white"
                                    : "bg-white/8 text-white/50 hover:bg-white/12"
                            }`}
                            style={
                                selected === "custom"
                                    ? { backgroundColor: BUTTON_BG }
                                    : undefined
                            }
                        >
                            Use custom
                        </button>
                    </div>
                    <div className="relative">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-white/35">
              $
            </span>
                        <input
                            type="text"
                            value={customValue}
                            onFocus={() => setSelected("custom")}
                            onChange={(e) => {
                                setCustomValue(e.target.value.replace(/[^0-9]/g, ""));
                                setSelected("custom");
                            }}
                            placeholder="0"
                            className="w-full rounded-2xl border border-white/10 bg-black/20 py-3 pl-8 pr-4 text-white outline-none transition focus:border-white/25"
                        />
                    </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="text-xs uppercase tracking-[0.24em] text-white/45">
                            At risk
                        </div>
                        <div className="mt-1 text-2xl font-black text-white">
                            {betAmount.toLocaleString()}
                        </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="text-xs uppercase tracking-[0.24em] text-white/45">
                            Safe now
                        </div>
                        <div className="mt-1 text-2xl font-black text-white">
                            {safeAmount.toLocaleString()}
                        </div>
                    </div>
                </div>

                <motion.button
                    onClick={() => onConfirm(betAmount)}
                    className="mt-6 w-full rounded-2xl py-4 text-base font-black text-white shadow-lg"
                    style={{
                        backgroundColor: betAmount > 0 ? BUTTON_BG : STATUS_COLORS.correct,
                    }}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                >
                    {betAmount > 0
                        ? `Start bonus round • ${betAmount.toLocaleString()}`
                        : `Bank ${earned.toLocaleString()}`}
                </motion.button>
            </div>
        </ModalShell>
    );
}

function CrashGameModal({
                            open,
                            stake,
                            crashPoint,
                            crashHistory,
                            onComplete,
                        }: {
    open: boolean;
    stake: number;
    crashPoint: number;
    crashHistory: CrashHistoryEntry[];
    onComplete: (cashOutMult: number | null, crashWinnings: number) => void;
}) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const multDisplayRef = useRef<HTMLSpanElement | null>(null);
    const rafRef = useRef(0);
    const timerRef = useRef<number | null>(null);
    const startTimeRef = useRef(0);
    const stateRef = useRef<CrashState>("ready");
    const autoCashOutRef = useRef(0);

    const [state, setState] = useState<CrashState>("ready");
    const [finalMult, setFinalMult] = useState(1);
    const [autoCashOut, setAutoCashOut] = useState("");
    const [showTips, setShowTips] = useState(false);

    stateRef.current = state;

    const drawGraph = useCallback(
        (
            elapsed: number,
            currentMult: number,
            finalState?: "cashed" | "busted",
        ) => {
            const canvas = canvasRef.current;
            const container = containerRef.current;
            if (!canvas || !container) return;

            const rect = container.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            const w = rect.width;
            const h = rect.height;
            if (w < 2 || h < 2) return;

            if (
                canvas.width !== Math.round(w * dpr) ||
                canvas.height !== Math.round(h * dpr)
            ) {
                canvas.width = Math.round(w * dpr);
                canvas.height = Math.round(h * dpr);
            }

            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, w, h);

            const pad = { top: 18, right: 16, bottom: 24, left: 44 };
            const gw = w - pad.left - pad.right;
            const gh = h - pad.top - pad.bottom;
            const maxTime = Math.max(elapsed, 2);
            const maxMult = Math.max(currentMult + 0.2, 2.2);
            const lineColor =
                finalState === "busted"
                    ? "#ef4444"
                    : finalState === "cashed"
                        ? "#22c55e"
                        : ACCENT;

            ctx.strokeStyle = "rgba(255,255,255,0.06)";
            ctx.lineWidth = 1;
            for (let m = 1; m <= maxMult; m += maxMult > 6 ? 1 : 0.5) {
                const y = pad.top + gh - ((m - 1) / (maxMult - 1)) * gh;
                ctx.beginPath();
                ctx.moveTo(pad.left, y);
                ctx.lineTo(pad.left + gw, y);
                ctx.stroke();
                ctx.fillStyle = "rgba(255,255,255,0.22)";
                ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
                ctx.textAlign = "right";
                ctx.fillText(`${m.toFixed(1)}x`, pad.left - 6, y + 3);
            }

            const step = Math.max(0.016, elapsed / 70);
            const toXY = (t: number) => {
                const m = Math.exp(MULTIPLIER_SPEED * t);
                return {
                    x: pad.left + (t / maxTime) * gw,
                    y: pad.top + gh - ((m - 1) / (maxMult - 1)) * gh,
                };
            };

            ctx.beginPath();
            let started = false;
            for (let t = 0; t <= elapsed; t += step) {
                const p = toXY(t);
                started ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
                started = true;
            }

            const lastX = pad.left + (elapsed / maxTime) * gw;
            const lastY =
                pad.top + gh - ((currentMult - 1) / (maxMult - 1)) * gh;
            ctx.lineTo(lastX, lastY);
            ctx.lineTo(lastX, pad.top + gh);
            ctx.lineTo(pad.left, pad.top + gh);
            ctx.closePath();

            const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + gh);
            gradient.addColorStop(0, alpha(lineColor, "33"));
            gradient.addColorStop(1, alpha(lineColor, "04"));
            ctx.fillStyle = gradient;
            ctx.fill();

            ctx.beginPath();
            started = false;
            for (let t = 0; t <= elapsed; t += step) {
                const p = toXY(t);
                started ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
                started = true;
            }
            ctx.lineTo(lastX, lastY);
            ctx.strokeStyle = lineColor;
            ctx.lineWidth = 3;
            ctx.lineCap = "round";
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(lastX, lastY, 5, 0, Math.PI * 2);
            ctx.fillStyle = lineColor;
            ctx.fill();
            ctx.beginPath();
            ctx.arc(lastX, lastY, 12, 0, Math.PI * 2);
            ctx.fillStyle = alpha(lineColor, "30");
            ctx.fill();

            if (finalState) {
                ctx.font = "bold 12px Inter, sans-serif";
                ctx.textAlign = "center";
                ctx.fillStyle = lineColor;
                ctx.fillText(
                    finalState === "cashed" ? "CASHED OUT" : "CRASHED",
                    lastX,
                    Math.max(20, lastY - 20),
                );
            }
        },
        [],
    );

    useEffect(() => {
        if (!open) {
            setShowTips(false);
            return;
        }
        setState("ready");
        setFinalMult(1);
        setAutoCashOut("");
        autoCashOutRef.current = 0;
        if (multDisplayRef.current) multDisplayRef.current.textContent = "1.00x";
        const t = window.setTimeout(() => drawGraph(0.01, 1), 20);
        return () => window.clearTimeout(t);
    }, [open, drawGraph]);

    useEffect(() => {
        const v = parseFloat(autoCashOut);
        autoCashOutRef.current = v > 1 ? v : 0;
    }, [autoCashOut]);

    useEffect(() => {
        return () => {
            cancelAnimationFrame(rafRef.current);
            if (timerRef.current) window.clearTimeout(timerRef.current);
        };
    }, []);

    const handleStart = useCallback(() => {
        if (stateRef.current !== "ready") return;
        setState("countdown");
        window.setTimeout(() => {
            startTimeRef.current = performance.now();
            setState("running");
        }, 800);
    }, []);

    useEffect(() => {
        if (state !== "running") return;
        const animate = () => {
            if (stateRef.current !== "running") return;
            const elapsed = (performance.now() - startTimeRef.current) / 1000;
            const mult = Math.exp(MULTIPLIER_SPEED * elapsed);

            if (mult >= crashPoint) {
                cancelAnimationFrame(rafRef.current);
                setFinalMult(crashPoint);
                setState("busted");
                if (multDisplayRef.current)
                    multDisplayRef.current.textContent = `${crashPoint.toFixed(2)}x`;
                drawGraph(
                    Math.log(crashPoint) / MULTIPLIER_SPEED,
                    crashPoint,
                    "busted",
                );
                timerRef.current = window.setTimeout(
                    () => onComplete(null, 0),
                    1500,
                );
                return;
            }

            if (autoCashOutRef.current > 1 && mult >= autoCashOutRef.current) {
                cancelAnimationFrame(rafRef.current);
                const m = parseFloat(autoCashOutRef.current.toFixed(2));
                setFinalMult(m);
                setState("cashed");
                if (multDisplayRef.current)
                    multDisplayRef.current.textContent = `${m.toFixed(2)}x`;
                drawGraph(Math.log(m) / MULTIPLIER_SPEED, m, "cashed");
                timerRef.current = window.setTimeout(
                    () => onComplete(m, Math.round(stake * m)),
                    1500,
                );
                return;
            }

            if (multDisplayRef.current)
                multDisplayRef.current.textContent = `${mult.toFixed(2)}x`;
            drawGraph(elapsed, mult);
            rafRef.current = requestAnimationFrame(animate);
        };
        rafRef.current = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(rafRef.current);
    }, [state, crashPoint, drawGraph, onComplete, stake]);

    const handleCashOut = useCallback(() => {
        if (stateRef.current !== "running") return;
        cancelAnimationFrame(rafRef.current);
        const elapsed = (performance.now() - startTimeRef.current) / 1000;
        const mult = parseFloat(Math.exp(MULTIPLIER_SPEED * elapsed).toFixed(2));
        setFinalMult(mult);
        setState("cashed");
        if (multDisplayRef.current)
            multDisplayRef.current.textContent = `${mult.toFixed(2)}x`;
        drawGraph(elapsed, mult, "cashed");
        timerRef.current = window.setTimeout(
            () => onComplete(mult, Math.round(stake * mult)),
            1500,
        );
    }, [drawGraph, onComplete, stake]);

    const isFinal = state === "cashed" || state === "busted";

    return (
        <ModalShell open={open} closeDisabled widthClass="max-w-lg">
            <div className="relative flex flex-col px-5 pb-5 pt-6 md:px-6">
                <div className="mb-4 flex items-start justify-between">
                    <div>
                        <div className="mb-1 text-xs uppercase tracking-[0.28em] text-violet-300/80">
                            Bonus round
                        </div>
                        <div className="text-2xl font-black leading-none text-white md:text-3xl">
                            Catch the multiplier
                        </div>
                    </div>
                    <button
                        onClick={() => setShowTips(true)}
                        className="flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:bg-white/10 hover:text-white"
                    >
                        💡 Tips
                    </button>
                </div>

                <div className="mb-4 text-sm text-white/60">
                    Risking <span className="font-bold text-white">{stake.toLocaleString()}</span>. Cash out before it crashes. Recents crash points:
                </div>

                <div className="mb-4 flex flex-wrap items-center gap-2">
                    {crashHistory.slice(0, 5).map((entry) => (
                        <span
                            key={entry.day}
                            className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                                entry.crashPoint >= 2
                                    ? "bg-green-500/15 text-green-300"
                                    : "bg-red-500/15 text-red-300"
                            }`}
                        >
              {entry.crashPoint.toFixed(2)}x
            </span>
                    ))}
                </div>

                <div className="mb-4 flex flex-col rounded-[28px] border border-white/10 bg-white/5 p-4">
                    <div className="mb-3 text-center">
                        <motion.span
                            ref={multDisplayRef}
                            className={`font-mono text-5xl font-black tracking-tight md:text-6xl ${
                                state === "busted"
                                    ? "text-red-400"
                                    : state === "cashed"
                                        ? "text-green-400"
                                        : state === "ready" || state === "countdown"
                                            ? "text-white/35"
                                            : "text-white"
                            }`}
                            animate={
                                state === "running"
                                    ? {
                                        textShadow: [
                                            "0 0 0 rgba(139,92,246,0.2)",
                                            "0 0 26px rgba(139,92,246,0.55)",
                                            "0 0 0 rgba(139,92,246,0.2)",
                                        ],
                                    }
                                    : undefined
                            }
                            transition={{ repeat: Infinity, duration: 1.2 }}
                        >
                            1.00x
                        </motion.span>

                        {state === "cashed" && (
                            <motion.div
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="mt-1 text-sm font-bold text-green-400"
                            >
                                Won {(Math.round(stake * finalMult) - stake).toLocaleString()}
                            </motion.div>
                        )}

                        {state === "busted" && (
                            <motion.div
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="mt-1 text-sm font-bold text-red-400"
                            >
                                Busted
                            </motion.div>
                        )}
                    </div>

                    <div
                        ref={containerRef}
                        className="relative h-[200px] w-full overflow-hidden rounded-2xl border border-white/8 bg-black/15"
                    >
                        <canvas
                            ref={canvasRef}
                            className="absolute inset-0 h-full w-full"
                        />
                    </div>
                </div>

                {autoCashOutRef.current > 1 && state !== "ready" && !isFinal && (
                    <div className="mb-3 text-center font-mono text-xs text-white/35">
                        Auto cash out at{" "}
                        <span className="font-bold text-white/60">
              {autoCashOutRef.current.toFixed(2)}x
            </span>
                    </div>
                )}

                {!isFinal ? (
                    <>
                        {state === "ready" && (
                            <div className="mb-3 flex items-center gap-3">
                                <div className="relative flex-1">
                                    <input
                                        type="number"
                                        min="1"
                                        step="0.01"
                                        value={autoCashOut}
                                        onChange={(e) => {
                                            let v = e.target.value;
                                            if (v !== "" && parseFloat(v) < 1) v = "1";
                                            setAutoCashOut(v);
                                        }}
                                        placeholder="Optional auto cash-out multi (i.e. 2x)"
                                        className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none transition focus:border-white/25"
                                    />
                                </div>
                            </div>
                        )}

                        <motion.button
                            onClick={state === "running" ? handleCashOut : handleStart}
                            disabled={state === "countdown"}
                            className="w-full rounded-2xl py-4 text-lg font-black uppercase tracking-[0.18em] text-white disabled:opacity-50"
                            style={{ backgroundColor: BUTTON_BG }}
                            whileHover={{ scale: 1.01 }}
                            whileTap={{ scale: 0.98 }}
                            animate={
                                state === "running"
                                    ? {
                                        boxShadow: [
                                            `0 0 0 ${alpha(ACCENT, "00")}`,
                                            `0 0 24px ${alpha(ACCENT, "66")}`,
                                            `0 0 0 ${alpha(ACCENT, "00")}`,
                                        ],
                                    }
                                    : undefined
                            }
                            transition={
                                state === "running"
                                    ? { repeat: Infinity, duration: 1.3 }
                                    : undefined
                            }
                        >
                            {state === "countdown"
                                ? "Starting..."
                                : state === "running"
                                    ? "Cash out"
                                    : "Let it ride"}
                        </motion.button>
                    </>
                ) : (
                    <div
                        className={`rounded-2xl py-4 text-center text-lg font-black ${
                            state === "cashed"
                                ? "bg-green-500/15 text-green-300"
                                : "bg-red-500/15 text-red-300"
                        }`}
                    >
                        {state === "cashed"
                            ? `Won ${Math.round(stake * finalMult).toLocaleString()}`
                            : `Lost ${stake.toLocaleString()}`}
                    </div>
                )}

                <AnimatePresence>
                    {showTips && (
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 10 }}
                            className="absolute inset-0 z-20 flex flex-col bg-[#18181d]/98 p-6 backdrop-blur-md"
                        >
                            <div className="mb-6 flex items-center justify-between">
                                <div className="text-xl font-black text-white">Quick notes</div>
                                <button
                                    onClick={() => setShowTips(false)}
                                    className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition hover:bg-white/10 hover:text-white"
                                >
                                    ✕
                                </button>
                            </div>
                            <div className="space-y-3 text-sm text-white/65">
                                {[
                                    "The curve climbs exponentially, so waiting longer gets more rewarding and more dangerous.",
                                    "Recent spikes can be tempting, but each day has its own hidden crash point.",
                                    "Cashing out manually gives you the best sweat. Auto cash-out is there for discipline.",
                                ].map((t, i) => (
                                    <div
                                        key={i}
                                        className="rounded-2xl border border-white/10 bg-white/5 p-4"
                                    >
                                        {t}
                                    </div>
                                ))}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </ModalShell>
    );
}

function ResultModal({
                         open,
                         onClose,
                         dayNumber,
                         guesses,
                         answer,
                         earned,
                         betAmount,
                         cashOutMult,
                         finalAmount,
                         onShare,
                     }: {
    open: boolean;
    onClose: () => void;
    dayNumber: number;
    guesses: string[];
    answer: string;
    earned: number;
    betAmount: number;
    cashOutMult: number | null;
    finalAmount: number;
    onShare: () => void;
}) {
    const solved =
        guesses.length > 0 && guesses[guesses.length - 1] === answer;
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!open) setCopied(false);
    }, [open]);

    const handleShare = async () => {
        await onShare();
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
    };

    return (
        <ModalShell open={open} onClose={onClose} widthClass="max-w-xl">
            <div className="px-6 pb-6 pt-7 md:px-8">
                <div className="mb-2 text-center text-xs uppercase tracking-[0.28em] text-violet-300/80">
                    Day {dayNumber}
                </div>
                <div className="mb-1 text-center text-3xl font-black text-white">
                    {solved ? "Puzzle cleared" : "Round over"}
                </div>
                <div className="mb-6 text-center text-white/60">
                    {solved
                        ? `You solved it in ${guesses.length}/${MAX_GUESSES}.`
                        : `The word was ${answer}.`}
                </div>

                <div
                    className={`mb-5 rounded-[28px] border p-5 text-center ${
                        solved
                            ? "border-violet-300/20 bg-gradient-to-br from-violet-500/15 to-white/5"
                            : "border-red-400/20 bg-gradient-to-br from-red-500/12 to-white/5"
                    }`}
                >
                    <div className="text-xs uppercase tracking-[0.24em] text-white/45">
                        Final bank
                    </div>
                    <div
                        className={`mt-2 text-6xl font-black ${solved ? "text-white" : "text-red-300"}`}
                    >
                        {finalAmount.toLocaleString()}
                    </div>
                </div>

                <div className="mb-5 grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="text-xs uppercase tracking-[0.24em] text-white/45">
                            Word reward
                        </div>
                        <div className="mt-1 text-2xl font-black text-white">
                            {earned.toLocaleString()}
                        </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="text-xs uppercase tracking-[0.24em] text-white/45">
                            Bonus result
                        </div>
                        <div
                            className={`mt-1 text-2xl font-black ${
                                betAmount === 0
                                    ? "text-white"
                                    : cashOutMult !== null
                                        ? "text-green-400"
                                        : "text-red-400"
                            }`}
                        >
                            {betAmount === 0
                                ? "Safe"
                                : cashOutMult !== null
                                    ? `${cashOutMult.toFixed(2)}x`
                                    : "Busted"}
                        </div>
                    </div>
                </div>

                <div className="mb-6 flex flex-col items-center gap-2">
                    {guesses.map((guess, ri) => (
                        <div key={`${guess}-${ri}`} className="flex gap-2">
                            {evaluate(guess, answer).map((status, ci) => (
                                <div
                                    key={`${ri}-${ci}`}
                                    className="h-8 w-8 rounded-lg"
                                    style={{ backgroundColor: STATUS_COLORS[status] }}
                                />
                            ))}
                        </div>
                    ))}
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <motion.button
                        onClick={handleShare}
                        className="rounded-2xl py-4 text-base font-black text-white"
                        style={{ backgroundColor: BUTTON_BG }}
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.98 }}
                    >
                        {copied ? "Copied!" : "Share result"}
                    </motion.button>
                    <button
                        onClick={onClose}
                        className="rounded-2xl border border-white/10 bg-white/5 py-4 text-base font-black text-white transition hover:bg-white/10"
                    >
                        Close
                    </button>
                </div>
            </div>
        </ModalShell>
    );
}

function CrashdleInner({
                           puzzle,
                           crashHistory,
                           validWords,
                       }: {
    puzzle: DailyPuzzle;
    crashHistory: CrashHistoryEntry[];
    validWords: Set<string>;
}) {
    const saved = useMemo(() => loadState(puzzle.day), [puzzle.day]);

    const [phase, setPhase] = useState<Phase>(saved?.phase ?? "word");
    const [guesses, setGuesses] = useState<string[]>(saved?.guesses ?? []);
    const [currentGuess, setCurrentGuess] = useState("");
    const [shakeRow, setShakeRow] = useState(-1);
    const [invalidWord, setInvalidWord] = useState(false);
    const [earnedMoney, setEarnedMoney] = useState(
        getEarnedFromGuesses(saved?.guesses ?? [], puzzle.word),
    );
    const [betAmount, setBetAmount] = useState(saved?.betAmount ?? 0);
    const [cashOutMult, setCashOutMult] = useState<number | null>(
        saved?.cashOutMultiplier ?? null,
    );
    const [finalAmount, setFinalAmount] = useState(saved?.finalAmount ?? 0);
    const [showHelp, setShowHelp] = useState(false);
    const [showResult, setShowResult] = useState(saved?.phase === "done");

    const solved =
        guesses.length > 0 && guesses[guesses.length - 1] === puzzle.word;

    useEffect(() => {
        const s = loadState(puzzle.day);
        if (!s) {
            clearState();
            setPhase("word");
            setGuesses([]);
            setCurrentGuess("");
            setShakeRow(-1);
            setInvalidWord(false);
            setEarnedMoney(0);
            setBetAmount(0);
            setCashOutMult(null);
            setFinalAmount(0);
            setShowResult(false);
            return;
        }
        setPhase(s.phase);
        setGuesses(s.guesses);
        setCurrentGuess("");
        setShakeRow(-1);
        setInvalidWord(false);
        setEarnedMoney(getEarnedFromGuesses(s.guesses, puzzle.word));
        setBetAmount(s.betAmount ?? 0);
        setCashOutMult(s.cashOutMultiplier ?? null);
        setFinalAmount(s.finalAmount ?? 0);
        setShowResult(s.phase === "done");
    }, [puzzle.day, puzzle.word]);

    useEffect(() => {
        if (phase !== "done") return;
        setShowResult(true);
        updateStoredStats(puzzle.day, solved, guesses.length);
    }, [phase, puzzle.day, solved, guesses.length]);

    const displayedReward = useMemo(() => {
        if (solved) return earnedMoney;
        const next = guesses.length + 1;
        return next <= MAX_GUESSES ? REWARDS[next] ?? 0 : 0;
    }, [solved, earnedMoney, guesses.length]);

    const letterStates = useMemo(() => {
        const states: Record<string, LetterStatus> = {};
        for (const g of guesses) {
            const ev = evaluate(g, puzzle.word);
            for (let i = 0; i < WORD_LENGTH; i++) {
                const letter = g[i];
                const status = ev[i];
                const cur = states[letter];
                if (status === "correct") states[letter] = "correct";
                else if (status === "present" && cur !== "correct")
                    states[letter] = "present";
                else if (!cur) states[letter] = "absent";
            }
        }
        return states;
    }, [guesses, puzzle.word]);

    const shareResults = useCallback(async () => {
        const text = buildShareText(
            puzzle.day,
            guesses,
            puzzle.word,
            finalAmount,
        );
        try {
            await navigator.clipboard.writeText(text);
        } catch {}
    }, [puzzle.day, guesses, puzzle.word, finalAmount]);

    const bounceRow = useCallback((ri: number) => {
        setShakeRow(ri);
        window.setTimeout(() => setShakeRow(-1), 500);
    }, []);

    const handleKey = useCallback(
        (key: string) => {
            if (phase !== "word") return;

            if (key === "⌫" || key === "BACKSPACE") {
                setCurrentGuess((p) => p.slice(0, -1));
                return;
            }

            if (key === "ENTER") {
                if (currentGuess.length !== WORD_LENGTH) {
                    bounceRow(guesses.length);
                    return;
                }
                if (validWords.size > 0 && !validWords.has(currentGuess)) {
                    bounceRow(guesses.length);
                    setInvalidWord(true);
                    window.setTimeout(() => setInvalidWord(false), 1200);
                    return;
                }

                const newGuesses = [...guesses, currentGuess];
                const solvedNow = currentGuess === puzzle.word;
                const reward = solvedNow ? REWARDS[newGuesses.length] ?? 0 : 0;

                setGuesses(newGuesses);
                setCurrentGuess("");

                if (solvedNow) {
                    setEarnedMoney(reward);
                    window.setTimeout(() => {
                        setPhase("bet");
                        saveState({
                            dayNumber: puzzle.day,
                            guesses: newGuesses,
                            phase: "bet",
                            betAmount: 0,
                            cashOutMultiplier: null,
                            finalAmount: 0,
                        });
                    }, WORD_LENGTH * 120 + 240);
                    return;
                }

                if (newGuesses.length >= MAX_GUESSES) {
                    window.setTimeout(() => {
                        setPhase("done");
                        saveState({
                            dayNumber: puzzle.day,
                            guesses: newGuesses,
                            phase: "done",
                            betAmount: 0,
                            cashOutMultiplier: null,
                            finalAmount: 0,
                        });
                    }, WORD_LENGTH * 120 + 240);
                    return;
                }

                saveState({
                    dayNumber: puzzle.day,
                    guesses: newGuesses,
                    phase: "word",
                    betAmount: 0,
                    cashOutMultiplier: null,
                    finalAmount: 0,
                });
                return;
            }

            if (/^[A-Z]$/.test(key) && currentGuess.length < WORD_LENGTH) {
                setCurrentGuess((p) => p + key);
            }
        },
        [phase, currentGuess, validWords, guesses, puzzle.day, puzzle.word, bounceRow],
    );

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement | null)?.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA") return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if (e.key === "Enter") handleKey("ENTER");
            else if (e.key === "Backspace") handleKey("BACKSPACE");
            else if (/^[a-zA-Z]$/.test(e.key)) handleKey(e.key.toUpperCase());
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [handleKey]);

    const handleBetConfirm = useCallback(
        (amount: number) => {
            setBetAmount(amount);
            if (amount <= 0) {
                setFinalAmount(earnedMoney);
                setCashOutMult(null);
                setPhase("done");
                saveState({
                    dayNumber: puzzle.day,
                    guesses,
                    phase: "done",
                    betAmount: 0,
                    cashOutMultiplier: null,
                    finalAmount: earnedMoney,
                });
                return;
            }
            setPhase("crash");
            saveState({
                dayNumber: puzzle.day,
                guesses,
                phase: "crash",
                betAmount: amount,
                cashOutMultiplier: null,
                finalAmount: 0,
            });
        },
        [earnedMoney, puzzle.day, guesses],
    );

    const handleCrashComplete = useCallback(
        (mult: number | null, crashWinnings: number) => {
            const total = earnedMoney - betAmount + crashWinnings;
            setCashOutMult(mult);
            setFinalAmount(total);
            setPhase("done");
            saveState({
                dayNumber: puzzle.day,
                guesses,
                phase: "done",
                betAmount,
                cashOutMultiplier: mult,
                finalAmount: total,
            });
        },
        [earnedMoney, betAmount, puzzle.day, guesses],
    );

    const showSolveNow =
        phase === "word" && !solved && guesses.length < MAX_GUESSES;

    return (
        <div className="h-[100dvh] w-full overflow-hidden text-white" style={ROOT_BG}>
            <div
                className="pointer-events-none fixed inset-0 opacity-[0.14]"
                style={{
                    backgroundImage:
                        "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
                    backgroundSize: "24px 24px",
                    maskImage:
                        "radial-gradient(circle at center, black 30%, transparent 82%)",
                }}
            />

            <div className="relative mx-auto grid h-full w-full max-w-4xl grid-rows-[auto_1fr] gap-2 px-3 py-3 md:px-4 md:py-4 box-border">
                <header className="flex min-h-0 flex-col items-center gap-3 text-center md:flex-row md:items-center md:justify-between md:text-left">
                    <div className="min-w-0 w-full md:w-auto">
                        <div className="truncate text-[10px] font-bold uppercase tracking-[0.2em] text-violet-200/80 md:text-[11px]">
                            Day {puzzle.day} • resets in <CountdownToMidnight />
                        </div>
                        <h1 className="mt-0.5 text-center text-2xl font-black tracking-tight md:text-left md:text-4xl">
                            Crash<span style={{ color: "#c4b5fd" }}>dle</span>
                        </h1>
                    </div>

                    <div className="flex shrink-0 items-center justify-center gap-2 md:justify-end">
                        <button
                            onClick={() => setShowHelp(true)}
                            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:bg-white/10 hover:text-white md:px-4 md:py-2 md:text-sm"
                        >
                            Help
                        </button>
                        <button
                            onClick={() => {
                                if (phase === "done") setShowResult(true);
                            }}
                            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition md:px-4 md:py-2 md:text-sm ${
                                phase === "done"
                                    ? "text-white"
                                    : "cursor-not-allowed border border-white/10 bg-white/5 text-white/35"
                            }`}
                            style={
                                phase === "done" ? { backgroundColor: BUTTON_BG } : undefined
                            }
                        >
                            Results
                        </button>
                    </div>
                </header>

                <main className="min-h-0 rounded-[24px] border border-white/10 bg-white/5 p-2.5 shadow-[0_20px_70px_rgba(0,0,0,0.35)] backdrop-blur-xl md:rounded-[28px] md:p-4">
                    <div className="grid h-full min-h-0 grid-rows-[auto_1fr_auto] items-stretch">
                        <div className="text-center">
                            <div className="text-[10px] uppercase tracking-[0.24em] text-white/40 md:text-[11px]">
                                Today&apos;s board
                            </div>
                            {showSolveNow && (
                                <div className="mt-0.5 text-xs font-semibold text-violet-200 md:text-sm">
                                    Solve now for $
                                    <TickingNumber
                                        value={displayedReward}
                                        className="font-mono font-black text-white"
                                    />
                                </div>
                            )}
                        </div>

                        <div className="flex min-h-0 flex-col items-center justify-center gap-2 md:gap-3">
                            <TileGrid
                                guesses={guesses}
                                currentGuess={currentGuess}
                                answer={puzzle.word}
                                shakeRow={shakeRow}
                            />
                            <AnimatePresence>
                                {invalidWord && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -6 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -6 }}
                                        className="rounded-full border border-red-300/15 bg-red-500/10 px-3 py-1 text-[11px] font-semibold text-red-200 md:px-4 md:py-1.5 md:text-sm"
                                    >
                                        Not a valid word
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>

                        <div className="mx-auto w-full max-w-[20rem] min-[376px]:max-w-[21.5rem] sm:max-w-2xl">
                            <Keyboard
                                onKey={handleKey}
                                letterStates={letterStates}
                                disabled={phase !== "word"}
                            />
                        </div>
                    </div>
                </main>
            </div>

            <HelpModal open={showHelp} onClose={() => setShowHelp(false)} />
            <BetModal
                open={phase === "bet"}
                earned={earnedMoney}
                onConfirm={handleBetConfirm}
            />
            <CrashGameModal
                open={phase === "crash"}
                stake={betAmount}
                crashPoint={puzzle.crashPoint}
                crashHistory={crashHistory}
                onComplete={handleCrashComplete}
            />
            <ResultModal
                open={showResult && phase === "done"}
                onClose={() => setShowResult(false)}
                dayNumber={puzzle.day}
                guesses={guesses}
                answer={puzzle.word}
                earned={earnedMoney}
                betAmount={betAmount}
                cashOutMult={cashOutMult}
                finalAmount={finalAmount}
                onShare={shareResults}
            />
        </div>
    );
}

export default function CrashdleGame() {
    const [puzzle, setPuzzle] = useState<DailyPuzzle | null>(null);
    const [crashHistory, setCrashHistory] = useState<CrashHistoryEntry[]>([]);
    const [validWords, setValidWords] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            fetchDailyPuzzle(),
            fetchCrashHistory(5),
            fetchValidWords(),
        ])
            .then(([daily, history, words]) => {
                if (cancelled) return;
                setPuzzle(daily);
                setCrashHistory(history);
                setValidWords(words);
                setLoading(false);
            })
            .catch(() => {
                if (cancelled) return;
                setError("Failed to load today's puzzle.");
                setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    if (loading) {
        return (
            <div
                className="flex min-h-screen items-center justify-center text-white"
                style={ROOT_BG}
            >
                <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-4 text-sm font-semibold text-white/55 backdrop-blur-xl">
                    Loading puzzle...
                </div>
            </div>
        );
    }

    if (error || !puzzle) {
        return (
            <div
                className="flex min-h-screen items-center justify-center px-6 text-center text-white"
                style={ROOT_BG}
            >
                <div className="max-w-md rounded-[28px] border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
                    <div className="mb-2 text-2xl font-black text-white">
                        Couldn't load Crash<span style={{ color: "#c4b5fd" }}>dle</span>
                    </div>
                    <div className="text-sm text-white/55">
                        {error ?? "Unknown error."}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <CrashdleInner
            puzzle={puzzle}
            crashHistory={crashHistory}
            validWords={validWords}
        />
    );
}