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

- **Runtime**: Deno (single adapter; a Node adapter is deferred — see the
  backlog in [docs/_archive/v1-plan/PROGRESS.md](docs/_archive/v1-plan/PROGRESS.md))
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
└── demo.ts         # Manual eyeball check (run animated, and again | cat)
examples/           # Runnable one-per-topic examples + their own README
docs/_archive/v1-plan/   # Closed v1 plan: tracker, decisions D1–D13, backlog
deno.json           # Deno config, version, tasks, imports
```

## Documentation Index

| Doc                                              | Audience | Contents                                                      |
| ------------------------------------------------ | -------- | ------------------------------------------------------------- |
| [README.md](README.md)                           | Human    | Overview, install, usage, examples, scope                     |
| [API.md](API.md)                                 | Human    | Full reference: options, methods, policies, `Io`, degradation |
| [AGENTS.md](AGENTS.md)                           | Agent    | This file — invariants, conventions, commands                 |
| [CLAUDE.md](CLAUDE.md)                           | Agent    | Pointer only — redirects to this file                         |
| [examples/README.md](examples/README.md)         | Human    | One runnable script per topic                                 |
| [docs/_archive/v1-plan/](docs/_archive/v1-plan/) | Both     | Closed plan, decision log (D1–D13), deferred backlog          |

**Full signatures live in [API.md](API.md), not here.** Read it before changing
any public type, and update it in the same commit — it is hand-written, so
nothing else will catch the drift.

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

## Signatures at a glance

```typescript
function statusLine(options?: StatusLineOptions): StatusLine;

interface StatusLine {
	set(label: string, detail?: string, opts?: { notable?: boolean }): void;
	inc(key: string, by?: number): void;
	log(...args: unknown[]): void;
	pause(): void;
	resume(): void;
	stop(opts?: { clear?: boolean; text?: string }): void;
	readonly elapsedMs: number;
}

// Defaults: intervalMs 100 · frames BRAILLE_FRAMES · clock true · counters []
//           enabled auto (isTerminal && TERM!=dumb && !CI) · fallback "notable"
//           hideCursor false · io merged over denoIo
```

Field-by-field types, `StatusSnapshot`, `FallbackPolicy` and the `Io` seam are in
[API.md](API.md); the authoritative source is the JSDoc in
[src/status-line.ts](src/status-line.ts), [src/fallback.ts](src/fallback.ts) and
[src/io.ts](src/io.ts).

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
   Host owns signals — see [Cursor contract](API.md#cursor-contract).

## Layout invariants

- Fixed order: `spinner clock · counters label detail`.
- Budget is `columns - 1` (last column left blank because many terminals
  auto-wrap when the final column is written).
- Degradation is **two nested passes**, not a flat ladder. Outer: tiers
  `[clock, counters]` → `[clock]` → `[]`, abandoning a tier as soon as it
  leaves the tail under `MIN_TAIL = 8` cols — so **counters drop before
  `detail` does**. Inner (`fitTail`): truncate `detail` → drop `detail`,
  truncate `label`. Then spinner only → all-empty (caller writes just
  `\r\x1b[K`). Worked example in [API.md](API.md#width-budget-and-degradation).
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
- [ ] Public surface changed? Update [API.md](API.md) and the export table
      above in the same commit — both are hand-written.

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

Run the demo both ways to eyeball both paths:

```bash
deno run scripts/demo.ts              # animated on a tty
deno run scripts/demo.ts | cat        # non-tty → notable lines only
```

**`COLUMNS` is not read.** Width comes from `Deno.consoleSize()`, re-read every
tick (which is how resize works without a `SIGWINCH` listener). To render at a
chosen width, inject `columns()` through the `io` seam — `examples/05-narrow-terminal.ts`
does exactly that and prints the whole degradation ladder in one go.

`examples/` holds one runnable script per topic (basic, counters + `log()`,
non-tty fallback, custom fallback policy, narrow widths, `pause()` around a
prompt, `hideCursor` + the signal contract); see `examples/README.md`. They
import the package by name via the `@marianmeres/cli-status-line` → `./src/mod.ts`
self-mapping in `deno.json`, so their import lines match what a consumer writes.
`deno task check` type-checks them, and none of them ship in the published
tarball (`publish.exclude`).

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
   byte-exact and a Node adapter is a single file (deferred; backlog T13).
4. **Never throw, never keep-alive** — the two invariants that shape every
   line of `status-line.ts`.
5. **Fixed layout order in v1** — a segment/priority system is deferred
   until a caller needs a different order (deferred; backlog T14).

## File Locations

| Concern              | File                                                                   |
| -------------------- | ---------------------------------------------------------------------- |
| Public surface       | [src/mod.ts](src/mod.ts)                                               |
| Runtime              | [src/status-line.ts](src/status-line.ts)                               |
| Layout & paint       | [src/layout.ts](src/layout.ts)                                         |
| Fallback + detection | [src/fallback.ts](src/fallback.ts)                                     |
| Width / sanitize     | [src/width.ts](src/width.ts)                                           |
| Platform seam        | [src/io.ts](src/io.ts)                                                 |
| Test fake `Io`       | [tests/_fake-io.ts](tests/_fake-io.ts)                                 |
| Manual demo          | [scripts/demo.ts](scripts/demo.ts)                                     |
| Package config       | [deno.json](deno.json)                                                 |
| Human overview       | [README.md](README.md)                                                 |
| Human API reference  | [API.md](API.md)                                                       |
| Agent documentation  | [AGENTS.md](AGENTS.md)                                                 |
| Agent doc pointer    | [CLAUDE.md](CLAUDE.md)                                                 |
| Examples index       | [examples/README.md](examples/README.md)                               |
| Closed v1 plan       | [docs/_archive/v1-plan/PROGRESS.md](docs/_archive/v1-plan/PROGRESS.md) |
