import type { CSSProperties } from "react";

const STATUS_COLORS = {
    correct: "#538d4e",
    present: "#b59f3b",
    crash: "#a8323e",
};

const ROOT_BG: CSSProperties = {
    background: "#0a0a0b",
};

export default function MarketingSplash() {
    return (
        <div
            className="crashdle-bg relative flex min-h-screen w-full items-center justify-center overflow-hidden text-white"
            style={ROOT_BG}
        >
            <div
                className="pointer-events-none absolute inset-0 opacity-[0.18]"
                style={{
                    backgroundImage:
                        "linear-gradient(rgba(251,191,36,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(251,191,36,0.08) 1px, transparent 1px)",
                    backgroundSize: "40px 40px",
                    maskImage:
                        "radial-gradient(ellipse at center, black 30%, transparent 80%)",
                    WebkitMaskImage:
                        "radial-gradient(ellipse at center, black 30%, transparent 80%)",
                }}
            />

            <div className="relative z-10 flex flex-col items-center gap-8 px-8 text-center md:gap-10">
                <div className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.32em] text-amber-400/70 md:text-xs">
                    <span className="text-amber-400">{"//"}</span>
                    <span>DAILY</span>
                    <span className="text-white/20">::</span>
                    <span>5 LETTERS</span>
                    <span className="text-white/20">::</span>
                    <span>6 GUESSES</span>
                    <span className="text-white/20">::</span>
                    <span>CRASH BONUS</span>
                </div>

                <svg
                    viewBox="0 0 40 32"
                    className="h-40 w-auto drop-shadow-[0_0_40px_rgba(83,141,78,0.25)] md:h-56 lg:h-64"
                    aria-hidden="true"
                >
                    <rect x="1" y="24" width="7" height="7" rx="1.4" fill={STATUS_COLORS.correct} />
                    <rect x="9" y="17" width="7" height="7" rx="1.4" fill={STATUS_COLORS.correct} />
                    <rect x="17" y="10" width="7" height="7" rx="1.4" fill={STATUS_COLORS.correct} />
                    <rect x="25" y="3" width="7" height="7" rx="1.4" fill={STATUS_COLORS.present} />
                    <rect
                        x="31.5"
                        y="10"
                        width="1.6"
                        height="5"
                        rx="0.8"
                        fill={STATUS_COLORS.crash}
                        transform="rotate(-15 32.3 12.5)"
                    />
                    <rect x="32" y="15" width="7" height="7" rx="1.4" fill={STATUS_COLORS.crash} />
                </svg>

                <h1 className="font-mono text-7xl font-bold leading-none tracking-[-0.045em] md:text-8xl lg:text-[10rem]">
                    CRASH<span className="text-amber-400">DLE</span>
                </h1>

                <p className="max-w-3xl font-mono text-xl text-white/80 md:text-3xl lg:text-4xl">
                    Solve the word.{" "}
                    <span className="text-amber-400">Risk the cash.</span>{" "}
                    <span className="text-rose-400">Don&apos;t crash.</span>
                </p>

                <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.28em] text-white/40 md:text-xs">
                    <span className="h-px w-10 bg-white/20 md:w-14" aria-hidden />
                    <span>crashdle.com</span>
                    <span className="h-px w-10 bg-white/20 md:w-14" aria-hidden />
                </div>
            </div>
        </div>
    );
}
