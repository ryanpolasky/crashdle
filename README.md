# Crashdle

A daily word puzzle fused with a crash-style risk game. Solve the five-letter word, earn fake currency based on how few guesses you needed, then optionally risk your winnings on a real-time multiplier that could bust at any moment. New puzzle every day at midnight UTC.

**Live at [crashdle.com](https://crashdle.com)**

## How It Works

1. **Word phase** — Classic Wordle-style deduction. Six guesses to find the daily five-letter word. Fewer guesses = higher payout (10,000 for a first-guess solve, down to 800 for six).
2. **Bet phase** — Choose how much of your word reward to risk (or skip entirely to bank it safe).
3. **Crash phase** — A multiplier climbs exponentially from 1.00x on a live canvas graph. Cash out before it busts to multiply your bet. Wait too long and you lose it all. Each day has a deterministic crash point seeded server-side.
4. **Results** — Final bank tallied, shareable result card with emoji grid + crash outcome.

## Architecture

### Frontend

Single-page React app — the entire game lives in one component file (`CrashdleGame.tsx`, ~1800 lines). No router, no state library. Intentionally kept as a single module to minimize abstraction overhead for a self-contained daily game.

- **React 19** + **TypeScript 5.9** — strict mode, no `any`
- **Vite 7** — dev server with API proxy to local worker on `:8787`
- **Tailwind CSS 3** — utility-first styling, no custom component library
- **Framer Motion** — modal transitions, tile flip animations, button micro-interactions
- **Canvas 2D** — the crash multiplier graph is drawn via `requestAnimationFrame` on an HTML canvas with DPR-aware sizing, not SVG or a charting library
- **localStorage** — game state (`crashdle-state-v2`) and stats (`crashdle-stats-v2`) are persisted client-side so progress survives refresh

### Backend

The frontend calls three API routes, proxied through Vite in dev:

| Endpoint | Purpose |
|---|---|
| `GET /api/crashdle/today` | Returns today's word + crash point |
| `GET /api/crashdle/history?count=N` | Recent crash points for the history ticker |
| `GET /api/crashdle/words` | Valid five-letter word list for input validation |

The backend runs on Cloudflare Workers (port 8787 locally via `wrangler dev`).

### Key Design Decisions

- **Deterministic daily seed** — the crash point and word are fixed per day server-side, so everyone gets the same puzzle
- **No auth** — anonymous play, all state is local. No accounts, no leaderboards, no tracking
- **Single-file component** — game phases are managed with a simple `Phase` union type (`"word" | "bet" | "crash" | "done"`) and `useState`. Modals are self-contained functions within the same file. This avoids prop-drilling across a component tree for what is fundamentally a linear state machine
- **Canvas over SVG** — the crash graph redraws at 60fps with exponential curve plotting. Canvas is more performant here than re-rendering SVG elements every frame
- **Mobile-first layout** — `dvh` viewport units for modal height constraints, responsive grid layouts, touch-friendly keyboard with flexbox sizing

## Local Development

```bash
# install dependencies
npm install

# start the dev server (frontend on :5173, expects API on :8787)
npm run dev

# type-check + build for production
npm run build
```

The Vite dev server proxies `/api/*` requests to `http://127.0.0.1:8787`, so you'll need the backend worker running locally for the game to load.

## Tech Stack

| Layer | Tech |
|---|---|
| UI | React 19, TypeScript, Tailwind CSS 3 |
| Animation | Framer Motion, Canvas 2D |
| Build | Vite 7, PostCSS, ESLint |
| Backend | Cloudflare Workers |
| Hosting | Cloudflare Pages |
