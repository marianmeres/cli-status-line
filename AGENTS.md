# @marianmeres/cli-status-line — Agent Guide

## Package Identity

```yaml
name: "@marianmeres/cli-status-line"
version: "0.1.0"
license: "MIT"
author: "Marian Meres"
registry_jsr: "https://jsr.io/@marianmeres/cli-status-line"
runtime: "Deno only (v1)"
```

## Purpose

Single-line, tick-only CLI status renderer with a plain-text fallback for
redirected output. Answers "is it still alive?" for long-running work without
spamming the transcript. Extracted from an internal driver.

## Quick Reference

- **Runtime**: Deno (single adapter; Node deferred to backlog T13)
- **Test**: `deno task test`
- **Lint**: `deno task lint`
- **Format check**: `deno fmt --check`
- **Type check**: `deno task check`
- **Publish dry-run**: `deno publish --dry-run`

## Project Structure

```
src/
├── mod.ts          # Public surface (only re-exports; nothing new here)
├── status-line.ts  # Runtime — statusLine(), spinner frames, StatusLine iface
├── layout.ts       # Pure layout() + paint() — the degradation ladder
├── fallback.ts     # Fallback policies, isAnimated(), isCi()
├── width.ts        # displayWidth / truncateToWidth / sanitize
└── io.ts           # Platform seam (`Io` iface, `denoIo`, `resolveIo`)
tests/
├── _fake-io.ts     # Memory-backed Io + helpers (out, bytes, exitFns, unrefd)
├── width.test.ts
├── layout.test.ts
├── io.test.ts
├── status-line.test.ts
├── fallback.test.ts
└── cursor.test.ts
scripts/
└── demo.ts         # Manual eyeball check (run animated / | cat / COLUMNS=40)
docs/v1-plan/       # Multistep plan tracker + source docs
deno.json           # Deno config, version, tasks, imports
```

## Public API

Exports from `src/mod.ts`:

| Export                  | Kind     | Description                                                                       |
| ----------------------- | -------- | --------------------------------------------------------------------------------- |
| `statusLine`            | Function | Factory. Returns a `StatusLine`. Starts the interval when animated.               |
| `BRAILLE_FRAMES`        | Const    | Default spinner frames (10 U+28xx glyphs).                                        |
| `ASCII_FRAMES`          | Const    | Text-only spinner (four-phase `-` `\` `\|` `/`).                                  |
| `StatusLine`            | Type     | Live line interface: `set`, `inc`, `log`, `pause`, `resume`, `stop`, `elapsedMs`. |
| `StatusLineOptions`     | Type     | Options for `statusLine()`.                                                       |
| `StatusLineSetOptions`  | Type     | `{ notable?: boolean }` for `set()`.                                              |
| `StatusLineStopOptions` | Type     | `{ clear?: boolean, text?: string }` for `stop()`.                                |
| `CounterDecl`           | Type     | `{ key: string, glyph: string }` — declared up front for stable width math.       |
| `FallbackPolicy`        | Type     | `"silent" \| "notable" \| (snap) => string \| null`.                              |
| `StatusSnapshot`        | Type     | Fields passed to a custom fallback function.                                      |
| `Io`                    | Type     | Platform seam interface. `denoIo` is internal; consumers inject partials.         |

Nothing from `width.ts` / `layout.ts` / `fallback.ts` (bar the type re-exports)
is on the public surface — those are internal seams.

## Function Signatures

```typescript
function statusLine(options?: StatusLineOptions): StatusLine;

interface StatusLine {
	set(label: string, detail?: string, opts?: StatusLineSetOptions): void;
	inc(key: string, by?: number): void;
	log(...args: unknown[]): void;
	pause(): void;
	resume(): void;
	stop(opts?: StatusLineStopOptions): void;
	readonly elapsedMs: number;
}

interface StatusLineOptions {
	intervalMs?: number; // default 100
	frames?: readonly string[]; // default BRAILLE_FRAMES
	clock?: boolean; // default true
	counters?: readonly CounterDecl[]; // default []
	enabled?: boolean; // default: auto (isTerminal && TERM!=dumb && !CI)
	fallback?: FallbackPolicy; // default "notable"
	hideCursor?: boolean; // default false
	io?: Partial<Io>; // test seam; merged over denoIo
}

interface CounterDecl {
	key: string;
	glyph: string;
}
interface StatusLineSetOptions {
	notable?: boolean;
}
interface StatusLineStopOptions {
	clear?: boolean;
	text?: string;
}

type FallbackPolicy =
	| "silent"
	| "notable"
	| ((snap: StatusSnapshot) => string | null);

interface StatusSnapshot {
	elapsedMs: number;
	clock: string; // "m:ss" when enabled, "" otherwise
	label: string;
	detail: string;
	counters: Readonly<Record<string, number>>;
	notable: boolean;
}

interface Io {
	write(s: string): void; // never throws; short writes drained
	columns(): number; // defaults to 80 when unknown
	isTerminal(): boolean;
	env(key: string): string | undefined; // never throws (permission-denied → undefined)
	unrefTimer(id: number): void;
	now(): number;
	onExit(fn: () => void): () => void; // returns unsubscribe
}
```

## Critical Conventions

1. **Never throw into the host.** Every `StatusLine` method wraps its body in a
   swallowing `try/catch`; `io.write` is already non-throwing. A bad frame must
   not kill the run. Preserve this in every change.
2. **Never keep the host alive or change how it dies.** The interval is
   unref'd via `io.unrefTimer` the moment it is created; `stop()` clears it
   and unsubscribes the `onExit` hook. **No signal listener is ever
   registered** — a Deno `SIGINT` listener disables default terminate-on-Ctrl-C.
3. **Tick-only drawing.** `set()` / `inc()` mutate state and return; the next
   `intervalMs` tick reads state, re-reads `io.columns()`, composes via
   `layout()` + `paint()`, and writes `\r` + line + `\x1b[K`. Worst-case
   update latency is one interval (100 ms). The fallback path is the only
   place `set()` writes directly (no tick to piggyback on).
4. **Undeclared counter keys are a silent no-op.** The never-throw rule
   outranks typo detection (D8).
5. **Sanitize `label` / `detail` on the way in.** A newline would break the
   single-line contract; the library cannot trust the caller (D10).
6. **Colour after truncation.** ANSI escape bytes are counted as columns by
   every terminal-width measure. `layout()` measures raw text; `paint()`
   wraps the surviving parts.
7. **Direct `io.write` for everything, including fallback lines.** Zero
   `console.*` in `src/` — the ecosystem's clog rule does not apply, since
   the package's output _is_ its product (D5).
8. **Post-`stop()` calls are no-ops.** First `stop()` wins; `elapsedMs`
   freezes at that moment.
9. **`hideCursor` restores via `stop()` and `io.onExit`; no signal handling.**
   Host owns signals — see the cursor contract in README.

## Layout invariants

- Fixed order: `spinner clock · counters label detail`.
- Budget is `columns - 1` (last column left blank because many terminals
  auto-wrap when the final column is written).
- Degradation ladder: truncate `detail` (keep `MIN_TAIL = 8` cols for label +
  detail when the head allows) → drop `detail`, truncate `label` → drop
  `counters` and retry → drop `clock` and retry → spinner only → all-empty
  (caller writes just `\r\x1b[K`).
- `layout()` is pure: no I/O, no globals, `columns` is an argument so the
  runtime re-reads it per frame (that is how a resize is handled without a
  `SIGWINCH` listener).

## Fallback path

`isAnimated(io, options.enabled)` chooses:

```
enabled ?? (isTerminal() && TERM !== "dumb" && !isCi())
```

`isCi` treats `CI` as absent when its value is `""`, `"0"`, or `"false"`
(D9). Explicit `enabled: true`/`false` always wins over the probe.

Policies: `"silent"` → `null`; `"notable"` → gate `renderNotable()` on
`snap.notable`; function → return as-is. The runtime suppresses consecutive
identical lines regardless of policy.

## Testing

`tests/_fake-io.ts` exposes a memory-backed `Io` plus:

- `out: string[]` — every write, in order.
- `bytes(): string` — `out.join("")`.
- `exitFns: (() => void)[]` — what `onExit` registered and not yet
  unsubscribed.
- `unrefd: number[]` — timer ids passed to `unrefTimer`.
- `set({ cols?, env? })` — mutate the fake after construction.

Time is driven by `FakeTime` from `@std/testing/time` (`using time = new
FakeTime(); time.tick(100)`). Assertions are on `io.bytes()` / `io.out` with
exact strings including `\r` and `\x1b[K` — no snapshot files.

Colour is turned off per suite via `setColorEnabled(false)` from
`@std/fmt/colors`; a dedicated cursor/colour test flips it on and uses
`stripAnsiCode` to compare the plain text.

Suite → source file map is 1:1 (`width`, `layout`, `io`, `status-line`,
`fallback`, `cursor`).

## Before Making Changes

- [ ] Read the invariants above.
- [ ] Preserve never-throw and never-keep-alive in every branch.
- [ ] `layout()` stays pure — no `io.*` calls in `src/layout.ts` or
      `src/width.ts`.
- [ ] Every new public export gets JSDoc (JSR scores it and refuses slow
      types).
- [ ] Add or extend tests in the matching suite.
- [ ] Run: `deno task test` → `deno fmt --check` → `deno lint`.
- [ ] `deno publish --dry-run` stays clean if you touched `mod.ts` /
      `deno.json`.

## Commands

| Task              | Command                                          |
| ----------------- | ------------------------------------------------ |
| Run tests         | `deno task test`                                 |
| Watch tests       | `deno task test:watch`                           |
| Lint              | `deno task lint`                                 |
| Type check        | `deno task check`                                |
| Format check      | `deno fmt --check`                               |
| Publish dry-run   | `deno publish --dry-run`                         |
| Release + publish | `deno task rp` (patch) / `deno task rpm` (minor) |
| Manual demo       | `deno run scripts/demo.ts`                       |

Run the demo three ways to eyeball all three paths:

```bash
deno run scripts/demo.ts              # animated on a tty
deno run scripts/demo.ts | cat        # non-tty → notable lines only
COLUMNS=40 deno run scripts/demo.ts   # narrow → degradation ladder
```

## Dependencies

Only `@std/*` from JSR:

- `@std/cli` — `unicodeWidth` for grapheme-safe width measurement.
- `@std/fmt` — `dim`, `cyan`, `yellow`, `setColorEnabled` for `paint()`.
- `@std/assert` — test assertions.
- `@std/testing` — `FakeTime` for tick-driven tests.

No runtime `@marianmeres/*` dependencies. Uses `Deno.stdout`,
`Deno.consoleSize`, `Deno.env.get`, `Deno.unrefTimer` — all confined to
`src/io.ts`.

## Design Principles

1. **Reassurance, not a transcript** — one line, tick-only, plain-text
   fallback for redirects.
2. **Pure core, thin runtime** — `layout()` and `width.ts` are
   side-effect-free; `status-line.ts` is the only stateful file.
3. **Platform via one seam** — `Io` isolates `Deno.*` so tests are
   byte-exact and a Node adapter is a single file (deferred to T13).
4. **Never throw, never keep-alive** — the two invariants that shape every
   line of `status-line.ts`.
5. **Fixed layout order in v1** — a segment/priority system is deferred
   until a caller needs a different order (T14).

## File Locations

| Concern              | File                                                 |
| -------------------- | ---------------------------------------------------- |
| Public surface       | [src/mod.ts](src/mod.ts)                             |
| Runtime              | [src/status-line.ts](src/status-line.ts)             |
| Layout & paint       | [src/layout.ts](src/layout.ts)                       |
| Fallback + detection | [src/fallback.ts](src/fallback.ts)                   |
| Width / sanitize     | [src/width.ts](src/width.ts)                         |
| Platform seam        | [src/io.ts](src/io.ts)                               |
| Test fake `Io`       | [tests/_fake-io.ts](tests/_fake-io.ts)               |
| Manual demo          | [scripts/demo.ts](scripts/demo.ts)                   |
| Package config       | [deno.json](deno.json)                               |
| Human documentation  | [README.md](README.md)                               |
| Agent documentation  | [AGENTS.md](AGENTS.md)                               |
| v1 plan tracker      | [docs/v1-plan/PROGRESS.md](docs/v1-plan/PROGRESS.md) |
