# @marianmeres/cli-status-line — Agent Guide

## Quick Reference

- **What**: single-line, tick-only CLI status renderer with a plain-text fallback for
  redirected output. Answers "is it still alive?" for long-running work without
  spamming the transcript. Zero runtime dependencies. Extracted from an internal driver.
- **Stack**: TypeScript (erasable-only), Node LTS (`.node-version`), pnpm, `node:test`,
  Biome.
- **Install**: `pnpm install` | **Test**: `pnpm test` | **Check all**: `pnpm run ci` |
  **Build**: `pnpm run build`
- **Distribution**: one source, two registries. npm gets `dist/` (ESM + `.d.ts`); JSR
  (`jsr.json`) gets `src/` as is, for Deno consumers, who run the `node:*` code through
  Deno's Node compatibility.

## Project Structure

```
src/
├── mod.ts            # Public surface (only re-exports; nothing new here); npm + JSR entry
├── status-line.ts    # Runtime — statusLine(), spinner frames, StatusLine iface
├── layout.ts         # Pure layout() + paint() — the degradation ladder
├── fallback.ts       # Fallback policies, isAnimated(), isCi()
├── colors.ts         # cyan/dim/yellow SGR wrappers + isColor() (NO_COLOR via io.env)
├── width.ts          # displayWidth / truncateToWidth / sanitize
├── unicode-width.ts  # unicodeWidth, vendored from @std/cli 1.0.32 (Unicode 15 tables)
└── io.ts             # Platform seam (`Io` iface, `nodeIo`, `resolveIo`)
tests/
├── _fake-io.ts       # Memory-backed Io + helpers
├── _child.ts         # Child-process fixture for lifecycle.test.ts (real nodeIo)
├── lifecycle.test.ts # Real process: exits without stop(), cursor restore, write ordering
└── *.test.ts         # One suite per src module (width, layout, io, status-line, fallback, colors, cursor)
scripts/demo.ts       # Manual eyeball check (run animated, and again | cat)
examples/             # Runnable one-per-topic examples + their own README
docs/_archive/v1-plan/  # Closed v1 plan: tracker, decisions D1–D13, backlog (frozen; not formatted)
jsr.json              # JSR name / exports / include; no version (set at publish)
dist/                 # `tsc -p tsconfig.build.json` output; gitignored; all npm gets (+ API.md, AGENTS.md)
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
| `Io`                    | Type     | Platform seam interface. `nodeIo` is internal; consumers inject partials.         |

Nothing from `width.ts` / `layout.ts` / `colors.ts` / `fallback.ts` (bar the type
re-exports) is on the public surface — those are internal seams.

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
//           hideCursor false · io merged over nodeIo · colour unless NO_COLOR
```

Field-by-field types, `StatusSnapshot`, `FallbackPolicy` and the `Io` seam are in
[API.md](API.md); the authoritative source is the JSDoc in
[src/status-line.ts](src/status-line.ts), [src/fallback.ts](src/fallback.ts) and
[src/io.ts](src/io.ts).

## Critical Conventions

1. **Runtime policy.** Node at the keyboard and in production, npm as the registry. No
   `Deno.*`, `Bun.*`, `jsr:` or `npm:` specifiers; `node:*` only, imported explicitly
   (`import process from "node:process"`), and only in `src/io.ts`. Deno is a
   _consumer_ runtime here (JSR), not a dev runtime: `pnpm run test:deno` runs the
   lifecycle suite with the child on Deno before a JSR publish. Nothing is built or
   tested for Bun.
2. **Never throw into the host.** Every `StatusLine` method wraps its body in a
   swallowing `try/catch`; every `nodeIo` member does too. A bad frame must not kill
   the run. Preserve this in every change.
3. **Never keep the host alive or change how it dies.** The interval is unref'd via
   `io.unrefTimer` the moment it is created; `stop()` clears it and unsubscribes the
   `onExit` hook. **No signal listener is ever registered** — a `SIGINT` listener
   disables the default terminate-on-Ctrl-C. For the same reason `nodeIo` registers
   **no `'error'` listener on `process.stdout`**: an `EPIPE` behaves exactly as it
   would for the host's own `console.log`.
4. **The global `setInterval`, not `node:timers`.** `node:test` mock timers intercept
   only the global; an import from `node:timers` silently escapes them.
5. **Tick-only drawing.** `set()` / `inc()` mutate state and return; the next
   `intervalMs` tick reads state, re-reads `io.columns()`, composes via `layout()` +
   `paint()`, and writes `\r` + line + `\x1b[K`. Worst-case update latency is one
   interval (100 ms). The fallback path is the only place `set()` writes directly
   (no tick to piggyback on).
6. **Undeclared counter keys are a silent no-op.** The never-throw rule outranks typo
   detection (D8).
7. **Sanitize `label` / `detail` on the way in.** A newline would break the
   single-line contract; the library cannot trust the caller (D10).
8. **Colour after truncation.** ANSI escape bytes are counted as columns by every
   terminal-width measure. `layout()` measures raw text; `paint(parts, color)` wraps
   the surviving parts. `color` is `isColor(io)` — `NO_COLOR` unset or empty — decided
   once at construction; there is no module-level colour switch.
9. **Direct `io.write` for everything, including fallback lines.** Zero `console.*` in
   `src/` (a test in `fallback.test.ts` enforces it) — the package's output _is_ its
   product (D5).
10. **Post-`stop()` calls are no-ops.** First `stop()` wins; `elapsedMs` freezes at
    that moment.
11. **`hideCursor` restores via `stop()` and `io.onExit`; no signal handling.** Host
    owns signals — see [Cursor contract](API.md#cursor-contract).
12. **Erasable TypeScript.** No `enum`, `namespace`, constructor parameter properties;
    `import type` / inline `type` for types; explicit `.ts` import extensions. Node
    strips types and never checks them: `pnpm run typecheck` is the only type gate.

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
- Widths come from the vendored `unicode-width.ts`, byte-identical to
  `@std/cli@1.0.32` (verified over every code point when vendored). Don't swap in an
  npm width package without re-baselining `width.test.ts` / `layout.test.ts`.

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

`tests/_fake-io.ts` exposes `makeFakeIo(init?)` — a memory-backed `Io` plus:

- `writes: string[]` — every write, in order; `output()` joins them.
- `exitHandlers: Set` — what `onExit` registered and not yet unsubscribed;
  `triggerExit()` fires them.
- `unrefCalls: unknown[]` — timers passed to `unrefTimer`.
- `setColumns`, `setIsTerminal`, `setEnv`, `setWriteThrows` — mutate the fake after
  construction.
- **`NO_COLOR=1` is in its env by default**, so goldens are byte-exact; a test that
  wants colour calls `setEnv("NO_COLOR", undefined)` before constructing the line.

Time is driven by `node:test` mock timers through each suite's `withFakeTime`
helper (`mock.timers.enable({ apis: ["setInterval", "Date"], now: 0 })`, then
`time.tick(100)`). Assertions are on `io.writes` / `io.output()` with exact strings
including `\r` and `\x1b[K` — no snapshot files. `layout.test.ts` calls
`paint(parts, false)` for goldens and `paint(parts, true)` for the colour contract.

`lifecycle.test.ts` is the only suite that touches the real platform: it spawns
`tests/_child.ts` (Node by default, Deno with `CHILD_RUNTIME=deno`) and checks that a
never-stopped line lets the process exit, that `exit` restores the cursor, and that
library writes keep their order against the host's `console.log`.

## Before Making Changes

- [ ] Read the invariants above.
- [ ] Preserve never-throw and never-keep-alive in every branch.
- [ ] `layout()` stays pure — no `io.*` calls in `src/layout.ts` or
  `src/width.ts`.
- [ ] Every new public export gets JSDoc (JSR scores it and refuses slow
  types).
- [ ] Add or extend tests in the matching suite.
- [ ] Run `pnpm run ci`; also `pnpm run test:deno` when touching `src/io.ts`.
- [ ] Public surface changed? Update [API.md](API.md) and the export table
  above in the same commit — both are hand-written.

## Commands

| Task                    | Command                                                     |
| ----------------------- | ----------------------------------------------------------- |
| Install                 | `pnpm install`                                              |
| Run tests               | `pnpm test`                                                 |
| Watch tests             | `pnpm run test:watch`                                       |
| Lifecycle suite on Deno | `pnpm run test:deno`                                        |
| Type check              | `pnpm run typecheck`                                        |
| Lint + format check     | `pnpm run lint`                                             |
| Format                  | `pnpm run format`                                           |
| Everything CI runs      | `pnpm run ci`                                               |
| Build `dist/`           | `pnpm run build`                                            |
| Run an example          | `pnpm -s example examples/01-basic.ts`                      |
| Manual demo             | `node scripts/demo.ts` and `node scripts/demo.ts \| cat`    |
| Release + publish       | `pnpm run rp` (patch) / `pnpm run rpm` (minor) — human only |

Release is a human action: `pnpm run release` bumps `package.json` (the manifest of
record), commits, tags and pushes; `publish:all` then runs `pnpm publish` (which runs
`ci` + `build` via `prepublishOnly`) and `publish:jsr` (`test:deno`, then
`deno publish --set-version "$npm_package_version"`). `jsr.json` carries no version.

**`COLUMNS` is not read.** Width comes from `process.stdout.columns`, re-read every
tick (which is how resize works without a `SIGWINCH` listener). To render at a
chosen width, inject `columns()` through the `io` seam — `examples/05-narrow-terminal.ts`
does exactly that and prints the whole degradation ladder in one go.

`examples/` holds one runnable script per topic (basic, counters + `log()`,
non-tty fallback, custom fallback policy, narrow widths, `pause()` around a
prompt, `hideCursor` + the signal contract); see `examples/README.md`. They
import the package by name; inside the repo that resolves to `./src/mod.ts`
through the `@marianmeres/source` export condition, which `pnpm example` turns on
(`node --conditions=@marianmeres/source`) and `tsconfig.json` mirrors in
`customConditions`. `pnpm run typecheck` covers them; none ship in either registry.

## Dependencies

None at runtime. Dev only: `typescript`, `@types/node`, `@biomejs/biome`.

`unicode-width.ts` is vendored from `@std/cli` rather than depended on: on npm it
would be `@jsr/std__cli`, which forces every consumer to configure the JSR registry.
`colors.ts` replaces `@std/fmt/colors`, which reads `NO_COLOR` only via
`Deno.noColor` and so ignores it on Node.

## Design Principles

1. **Reassurance, not a transcript** — one line, tick-only, plain-text
   fallback for redirects.
2. **Pure core, thin runtime** — `layout()` and `width.ts` are
   side-effect-free; `status-line.ts` is the only stateful file.
3. **Platform via one seam** — `Io` isolates `node:process` so tests are
   byte-exact and nothing else in `src/` touches the runtime.
4. **Never throw, never keep-alive** — the two invariants that shape every
   line of `status-line.ts`.
5. **Fixed layout order** — a segment/priority system is deferred until a caller
   needs a different order (deferred; backlog T14).

## File Locations

| Concern              | File                                                                   |
| -------------------- | ---------------------------------------------------------------------- |
| Public surface       | [src/mod.ts](src/mod.ts)                                               |
| Runtime              | [src/status-line.ts](src/status-line.ts)                               |
| Layout & paint       | [src/layout.ts](src/layout.ts)                                         |
| Fallback + detection | [src/fallback.ts](src/fallback.ts)                                     |
| Colours + NO_COLOR   | [src/colors.ts](src/colors.ts)                                         |
| Width / sanitize     | [src/width.ts](src/width.ts)                                           |
| Width tables         | [src/unicode-width.ts](src/unicode-width.ts)                           |
| Platform seam        | [src/io.ts](src/io.ts)                                                 |
| Test fake `Io`       | [tests/_fake-io.ts](tests/_fake-io.ts)                                 |
| Real-process fixture | [tests/_child.ts](tests/_child.ts)                                     |
| Manual demo          | [scripts/demo.ts](scripts/demo.ts)                                     |
| Package config       | [package.json](package.json), [jsr.json](jsr.json)                     |
| Human overview       | [README.md](README.md)                                                 |
| Human API reference  | [API.md](API.md)                                                       |
| Agent documentation  | [AGENTS.md](AGENTS.md)                                                 |
| Agent doc pointer    | [CLAUDE.md](CLAUDE.md)                                                 |
| Examples index       | [examples/README.md](examples/README.md)                               |
| Closed v1 plan       | [docs/_archive/v1-plan/PROGRESS.md](docs/_archive/v1-plan/PROGRESS.md) |
