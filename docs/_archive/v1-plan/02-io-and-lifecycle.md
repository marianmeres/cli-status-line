<!--
GENERATED ANALYSIS — @marianmeres/cli-status-line (v1 implementation plan)
Produced 2026-08-26 by inline research → verification against the reference implementation → synthesis.
Reference claims verified against @marianmeres/agents at commit c252835 (sprint/src/activity.ts, proc.ts, agent.ts).
This repository is an unborn scaffold (no commits yet); scaffold facts verified on disk. Planning artifact; no code was changed.
-->

# IO seam, tty detection, fallback policies, and lifecycle

> Everything that touches the platform — stdout, terminal size, environment, timers, the exit
> hook — goes through one small injectable `Io` object with a Deno implementation in one file.
> That is what makes the renderer testable byte-for-byte, and it is the only reason a Node
> adapter would ever be an afternoon's work rather than a rewrite.

> **Single most important takeaway:** the library must **never throw into the host's hot path
> and never keep the host alive or change how it dies.** Every write swallows its own failure,
> the interval is unref'd, `stop()` is idempotent and everything after it is a no-op, and no
> signal listener is ever installed (a Deno `SIGINT` listener disables default termination).

> **Two things the proposal missed that this doc adds:** `Deno.env.get` throws `NotCapable`
> without `--allow-env` (verified), so the seam's `env()` must swallow that or `statusLine()`
> crashes on construction under narrow permissions; and the exit hook belongs _in_ the seam
> (`onExit`) — the proposal's §7.1 table lists it as a platform call but its §7 interface omits it.

## Summary of recommendations

| # | Recommendation                                                                                               | Value | Effort | Risk |
| - | ------------------------------------------------------------------------------------------------------------ | ----- | ------ | ---- |
| 1 | `src/io.ts`: `Io` interface + `denoIo` (drain loop, permission-safe `env`, `onExit`) + `resolveIo()`         | high  | S      | low  |
| 2 | Enabled detection (`isTerminal && TERM!=dumb && !CI`, `enabled` override) + fallback policies via `io.write` | high  | S      | low  |
| 3 | Lifecycle: unref'd tick, `stop()`/`pause()`/`resume()`/`log()`, post-stop no-ops, never-throw                | high  | M      | med  |
| 4 | Cursor hiding opt-in with `onExit` restore; no signal listeners, documented host contract                    | med   | S      | low  |

## Findings & recommendations (detailed)

### 1. The `Io` seam (`src/io.ts`)

- **Problem / observation** — The reference calls `Deno.*` in four places and is untestable by
  construction. It also ignores `writeSync`'s return value, which can be a short write.
- **Evidence** —
  [activity.ts:30-36](/Users/mm/projects/@marianmeres/agents/sprint/src/activity.ts#L30-L36)
  (`Deno.stdout.writeSync(enc.encode(s))`, return ignored),
  [activity.ts:38-44](/Users/mm/projects/@marianmeres/agents/sprint/src/activity.ts#L38-L44)
  (`Deno.consoleSize().columns`, 80 on throw),
  [activity.ts:102](/Users/mm/projects/@marianmeres/agents/sprint/src/activity.ts#L102)
  (`Deno.stdout.isTerminal()`),
  [activity.ts:133](/Users/mm/projects/@marianmeres/agents/sprint/src/activity.ts#L133)
  (`setInterval`, no unref). Verified on Deno 2.9.5: `Deno.consoleSize()` throws when stdout is
  not a tty; `Deno.env.get("CI")` throws `NotCapable` under `--no-prompt` without `--allow-env`.
- **Proposed change** —

  ```ts
  export interface Io {
  	/** Write the whole string. Must not throw. */
  	write(s: string): void;
  	/** Terminal width in columns; a sane default (80) when unknown. */
  	columns(): number;
  	isTerminal(): boolean;
  	/** `undefined` when unset OR when the runtime denies access — never throws. */
  	env(key: string): string | undefined;
  	/** Let the process exit even though this timer is pending. */
  	unrefTimer(id: number): void;
  	/** Monotonic-enough ms; only ever compared to itself. */
  	now(): number;
  	/** Run `fn` at normal process exit (incl. `Deno.exit()`); returns an unsubscribe. */
  	onExit(fn: () => void): () => void;
  }

  export const denoIo: Io; // the one file that says `Deno.`
  export function resolveIo(partial?: Partial<Io>): Io; // `{ ...denoIo, ...partial }`
  ```

  `denoIo.write` encodes once and loops `writeSync` until the byte count is drained, inside a
  `try/catch` that swallows everything (closed stdout, EAGAIN on a non-blocking pipe). `columns()`
  wraps `Deno.consoleSize()` with the 80 fallback. `env()` wraps `Deno.env.get` in `try/catch`.
  `onExit` uses `globalThis.addEventListener("unload", …)` / `removeEventListener`.
  `unrefTimer` is `Deno.unrefTimer`.

  The seam deliberately does **not** own `setInterval`/`clearInterval` — tests drive the real
  timers with `FakeTime` from `@std/testing/time` (verified export), which keeps the interface at
  seven members. If a Node adapter is ever added, `setInterval` returns a `Timeout` there, so
  `unrefTimer(id: number)` becomes `unrefTimer(id: unknown)` at that point — a private change.
- **Done when** — `grep -rn "Deno\." src/` matches lines only in `src/io.ts`; `tests/io.test.ts`
  passes (`resolveIo` fills every missing member from `denoIo`; the memory fake used by the other
  tests records writes in order and lets tests set `columns`, `isTerminal`, `env`, `now`).
- **Affected files** — `src/io.ts` (new), `tests/_fake-io.ts` (new test helper — underscore so
  `deno test` does not pick it up as a suite), `tests/io.test.ts` (new). Delete the scaffold
  placeholders `src/cli-status-line.ts` and `tests/cli-status-line.test.ts` (the placeholder is
  the reason `deno lint` is currently red: `no-slow-types` on `name()`).
- **Effort / Value / Risk** — S / high / low.
- **Implementation notes** — `now()` exists so a fake clock can make the elapsed display
  deterministic; with `FakeTime` in tests, `Date.now()` is faked too, so `denoIo.now = Date.now`
  and the fake can simply forward to it. Keep `Io` exported from `mod.ts` (consumers of the
  library will want to inject a fake in _their_ tests) but keep `denoIo` internal.

### 2. Enabled detection and non-tty fallback policies

- **Problem / observation** — `\r` means nothing to a file and a spinner written to one is ten
  frames a second of garbage. The reference handles this with a single hard-coded rule: not a tty
  → one `console.log` line per tool call, sliced to 160 characters.
- **Evidence** —
  [activity.ts:152-157](/Users/mm/projects/@marianmeres/agents/sprint/src/activity.ts#L152-L157):
  `console.log(\` ⋯ ${clock()} ${what.tool} ${what.detail}\`.slice(0, 160).trimEnd())`, gated on`next.isTool`. No dedup;`.slice`is not width-aware; and it goes through`console.log`, which
  in this ecosystem would pull in`@marianmeres/clog`([ecosystem.md:65](/Users/mm/projects/@marianmeres/agents/mm-local-docs/ecosystem.md#L65):
  "If the package at hand calls`console.log|debug|error|warn`at least once, then`@marianmeres/clog` is required").
- **Proposed change** —

  ```ts
  export type FallbackPolicy =
  	| "silent" // write nothing when not animated
  	| "notable" // default: one line per `set(…, { notable: true })`
  	| ((snapshot: StatusSnapshot) => string | null); // custom; null skips

  export interface StatusSnapshot {
  	elapsedMs: number;
  	clock: string; // formatted "m:ss", "" when clock disabled
  	label: string; // sanitized
  	detail: string; // sanitized
  	counters: Readonly<Record<string, number>>;
  	notable: boolean;
  }
  ```

  Animated iff `options.enabled ?? (io.isTerminal() && io.env("TERM") !== "dumb" && !isCi())`
  where `isCi()` is `CI` set to anything other than `""`, `"0"`, `"false"`. `enabled: true` on a
  non-tty animates anyway (the caller asked); `enabled: false` on a tty uses the fallback.

  When not animated: `set()` with `notable: true` runs the policy; the built-in `"notable"` form is
  `⋯ <clock> <label> <detail>` (no indentation — sprint's three leading spaces are sprint's
  business, see `03-…` #3), truncated to 160 **columns** with `truncateToWidth`, and written via
  `io.write(line + "\n")`. Consecutive identical lines are suppressed. `inc()` never emits.
  `log()` writes `args.join(" ") + "\n"` plainly. `stop({ text })` writes `text + "\n"`;
  `stop()` without text writes nothing.

  Zero `console.*` calls anywhere in `src/` (decision D5). The package's output _is_ its product
  and needs ordered, synchronous writes on the same stream as the line; routing it through clog
  would be wrong, and the ecosystem rule is satisfied by simply not calling `console.*`.
- **Done when** — `tests/fallback.test.ts` passes: (a) non-tty + default policy → exactly one
  line per notable `set()`, none for non-notable, duplicates suppressed, a 500-column detail
  bounded to 160 columns; (b) `"silent"` → zero bytes; (c) custom function receives a full
  snapshot and `null` skips; (d) `TERM=dumb` and `CI=1` on a fake tty → fallback path;
  (e) `enabled: true` on a fake non-tty → animated bytes. And `grep -rn "console\." src/` is empty.
- **Affected files** — `src/fallback.ts` (new), `src/status-line.ts`, `tests/fallback.test.ts` (new).
- **Effort / Value / Risk** — S / high / low.
- **Implementation notes** — The proposal §6.2 says "timestamped" lines; the reference and the
  port acceptance criterion use the _elapsed_ clock. Keep elapsed: wall-clock timestamps are the
  host logger's job, and a custom policy can add them. The `stop({ text })` fallback write is
  deliberate: a final "done in 3:12" summary is exactly what a log file wants.

### 3. Lifecycle: tick, `stop()`, `pause()`/`resume()`, `log()`, never-throw

- **Problem / observation** — Three contracts the reference legitimately dodges because it owns
  its whole process: the interval keeps the event loop alive if a caller forgets `stop()`; there
  is no way to interleave host output; and there is no way to suspend the line around a blocking
  prompt.
- **Evidence** —
  [activity.ts:132-134](/Users/mm/projects/@marianmeres/agents/sprint/src/activity.ts#L132-L134)
  (`setInterval`, never unref'd — `Deno.unrefTimer` exists, verified);
  [activity.ts:162-167](/Users/mm/projects/@marianmeres/agents/sprint/src/activity.ts#L162-L167)
  (`stop()`: idempotent via `live`, erases only `if (dirty)` — keep both);
  [activity.ts:138-161](/Users/mm/projects/@marianmeres/agents/sprint/src/activity.ts#L138-L161)
  (`onLine` swallows everything — keep);
  [proc.ts:54-60](/Users/mm/projects/@marianmeres/agents/sprint/src/proc.ts#L54-L60) (the host
  _also_ guards against a throwing renderer — the library must not rely on that).
- **Proposed change** — `src/status-line.ts`:

  ```ts
  export interface StatusLine {
  	set(label: string, detail?: string, opts?: { notable?: boolean }): void;
  	inc(key: string, by?: number): void;
  	log(...args: unknown[]): void;
  	pause(): void;
  	resume(): void;
  	stop(opts?: { clear?: boolean; text?: string }): void;
  	readonly elapsedMs: number;
  }
  export function statusLine(options?: StatusLineOptions): StatusLine;
  ```

  Semantics (each one is a test):

  - **tick** — `setInterval(tick, intervalMs)`, immediately `io.unrefTimer(id)`. Only created
    when animated. `tick` = advance frame, re-read columns, write `\r` + painted line + `\x1b[K`,
    set `drawn = true`. Skipped while paused or after stop.
  - **`set(label, detail = "", { notable = false })`** — sanitize both, store, and (non-animated)
    run the fallback policy. `inc(key, by = 1)` — bump a _declared_ counter; an undeclared key is a
    silent no-op (decision D8: the never-throw rule wins over typo detection). Neither draws.
  - **`log(...args)`** — animated: if `drawn`, write `\r\x1b[K` first; then write
    `args.map(String).join(" ") + "\n"`; `drawn = false`. The next tick redraws. Non-animated:
    just the message line. Never patch `console.log`.
  - **`pause()`** — animated: erase if drawn, `paused = true`. Must be synchronous because
    `confirm()`/`prompt()` block the event loop, so the timer cannot do it. `resume()` clears the
    flag; the next tick redraws. Both idempotent.
  - **`stop({ clear = true, text })`** — first call only: `clearInterval`, restore cursor if hidden,
    unsubscribe `onExit`, then: erase if drawn; if `text`, write `text + "\n"`; else if
    `clear === false` and drawn, write `"\n"` (leave the last frame on screen and move below it).
    After `stop()`, every method is a no-op and `elapsedMs` freezes.
  - **never-throw** — every public method body is wrapped so that nothing escapes; `io.write`
    is already non-throwing; `layout()` receives sanitized strings; `columns()` is clamped to
    `>= 0` and `Number.isFinite`.
  - **`elapsedMs`** — `io.now() - startedAt` (frozen at stop).
- **Done when** — `tests/status-line.test.ts` passes against the memory fake + `FakeTime`, with
  one byte-exact golden per bullet above: unref called with the interval id; ten `set()` calls
  between ticks → one write; `log()` sequence is `\r\x1b[K` + message + `\n` and the next tick
  redraws; `pause()` erases synchronously and ticks write nothing until `resume()`; `stop()` twice
  writes the erase once; `stop({ text })` byte stream; `set()` after `stop()` writes nothing; a
  throwing fake `write` does not propagate out of `set()`/`tick`/`stop()`.
- **Affected files** — `src/status-line.ts` (new), `tests/status-line.test.ts` (new).
- **Effort / Value / Risk** — M / high / med (most behaviour lives here; the goldens are the
  mitigation).
- **Implementation notes** — Keep the reference's prose comments that explain _why_ (the
  "reassurance at a glance, not a transcript" paragraph,
  [activity.ts:1-13](/Users/mm/projects/@marianmeres/agents/sprint/src/activity.ts#L1-L13)) in the
  module doc — that reasoning is meant to survive the port. Default `frames` is the braille set
  ([activity.ts:17](/Users/mm/projects/@marianmeres/agents/sprint/src/activity.ts#L17)); also
  export `ASCII_FRAMES = ["-", "\\", "|", "/"]` for callers on terminals without braille.

### 4. Cursor hiding is opt-in, restored on exit, and never via a signal listener

- **Problem / observation** — `\x1b[?25l` obliges you to restore the cursor on every exit path.
  Deno's `Deno.addSignalListener("SIGINT", …)` disables the default terminate behaviour, so a
  library that installs one silently stops its host from dying on Ctrl-C.
- **Evidence** — Sprint installs its own handlers and owns the exit sequence
  ([proc.ts:26-39](/Users/mm/projects/@marianmeres/agents/sprint/src/proc.ts#L26-L39)); the
  reference renderer never hides the cursor, so it has no restore problem today.
- **Proposed change** — `hideCursor?: boolean` default **false**. When true and animated: write
  `\x1b[?25l` at start, `\x1b[?25h` in `stop()`, and `io.onExit(() => io.write("\x1b[?25h"))` with
  the unsubscribe called in `stop()`. Document in the option's JSDoc: _the host is responsible for
  signal handling; a signal-killed process bypasses `unload`; this library never registers signal
  listeners._
- **Done when** — `tests/cursor.test.ts` passes: with `hideCursor: true` the first bytes contain
  `\x1b[?25l`, `stop()` bytes contain `\x1b[?25h`, the fake `onExit` callback restores the cursor
  when invoked before `stop()`, and is unsubscribed after `stop()`; with the default, neither
  sequence ever appears; `grep -rn "addSignalListener" src/` is empty.
- **Affected files** — `src/status-line.ts`, `tests/cursor.test.ts` (new).
- **Effort / Value / Risk** — S / med / low.

## Open questions / decisions needed

All resolved at PLAN time, recorded in [`PROGRESS.md`](./PROGRESS.md) → Decisions log, and
ratified by the owner on 2026-08-26. Relevant here: **D5** direct `io.write`, no
`console.*`, no clog; **D6** Deno-only v1 (already enacted in `deno.json`), seam kept;
**D7** `hideCursor` default false, no signal listeners; **D8** undeclared `inc()` key is a no-op;
**D9** enabled-detection rule; **D11** `FakeTime` instead of timer scheduling in the seam, plus
`onExit` in the seam.
