# API

Everything below is exported from `@marianmeres/cli-status-line` (`src/mod.ts`).
Nothing else is public — `layout()`, `paint()`, `sanitize()`, `nodeIo` and friends
are internal seams and may change without a major bump.

```typescript
import {
	ASCII_FRAMES,
	BRAILLE_FRAMES,
	type CounterDecl,
	type FallbackPolicy,
	type Io,
	type StatusLine,
	statusLine,
	type StatusLineOptions,
	type StatusLineSetOptions,
	type StatusLineStopOptions,
	type StatusSnapshot,
} from "@marianmeres/cli-status-line";
```

---

## Functions

### `statusLine(options?)`

Create a live status line. On the animated path it draws once immediately (so the
line exists before the first tick) and starts a redraw interval. On the
non-animated path no interval is created at all.

**Parameters:**

- `options` ([`StatusLineOptions`](#statuslineoptions), optional) — every field
  has a default; `statusLine()` with no arguments is valid.

**Returns:** [`StatusLine`](#statusline) — the live line. Every method is
idempotent and never throws.

**Example:**

```typescript
const line = statusLine({ counters: [{ key: "tools", glyph: "⚒" }] });
line.set("starting", "warming up caches");

for await (const ev of workEvents()) {
	if (ev.kind === "tool") line.inc("tools");
	line.set(ev.name, ev.detail, { notable: ev.kind === "tool" });
}

line.stop({ text: "done" });
```

---

## Types

### `StatusLine`

The live line returned by `statusLine()`.

```typescript
interface StatusLine {
	set(label: string, detail?: string, opts?: StatusLineSetOptions): void;
	inc(key: string, by?: number): void;
	log(...args: unknown[]): void;
	pause(): void;
	resume(): void;
	stop(opts?: StatusLineStopOptions): void;
	readonly elapsedMs: number;
}
```

#### `set(label, detail?, opts?)`

Update the label (and optionally the detail) shown after the head. Both strings
are sanitized on the way in — ANSI escapes and control characters are stripped
and whitespace runs (including newlines) collapse to a single space, so a caller
cannot break the single-line contract.

On the animated path **no draw happens here**; the next tick picks the new state
up. On the non-animated path there is no tick to piggyback on, so this is where
the [`FallbackPolicy`](#fallbackpolicy) runs.

- `label` (`string`) — the primary text, rendered yellow.
- `detail` (`string`, optional) — secondary text, rendered dim, first to be
  truncated when the terminal is narrow. Default `""`.
- `opts` ([`StatusLineSetOptions`](#statuslinesetoptions), optional).

```typescript
line.set("building", "src/mod.ts");
line.set("compiled", "42 files", { notable: true }); // logged in CI too
```

#### `inc(key, by?)`

Bump a counter declared in `options.counters` by `by`. An undeclared `key` is a
**silent no-op** — the never-throw rule outranks typo detection. No draw happens
here either.

- `key` (`string`) — must match a declared `CounterDecl.key`.
- `by` (`number`, optional) — default `1`. Negative values are allowed.

```typescript
line.inc("tools"); // +1
line.inc("bytes", 4096); // +4096
```

#### `log(...args)`

Write a line of host output _above_ the status line. Erases the current frame
first (if one is drawn) so the two never collide; the next tick redraws the line
below the new output. Arguments are `String()`-joined with a single space — this
is a plain writer, not a `console.log` replacement with formatting.

Works on both paths: with no animation there is nothing to erase and the line is
simply written.

```typescript
line.log("warning:", err.message);
```

#### `pause()` / `resume()`

`pause()` erases the frame and suspends redraws until `resume()`. Both are
idempotent, and `pause()` is deliberately **synchronous**: the prompt must land on
a clean line, and while a `readline` question is waiting the event loop keeps
running — without `pause()`, every tick would redraw over the prompt.

```typescript
import { createInterface } from "node:readline/promises";

const rl = createInterface({ input: process.stdin, output: process.stdout });
let ok = false;
line.pause();
try {
	ok = /^y/i.test(await rl.question("Overwrite dist/? [y/N] "));
} finally {
	rl.close();
	line.resume();
}
```

#### `stop(opts?)`

Stop the interval, restore terminal state (including the cursor when
`hideCursor` was used), and optionally leave a final line. **First call wins** —
every later method call is a no-op and `elapsedMs` freezes at the value captured
here.

- `opts` ([`StatusLineStopOptions`](#statuslinestopoptions), optional).

```typescript
line.stop({ text: `done in ${Math.round(line.elapsedMs / 1000)}s` });
```

#### `elapsedMs`

`number` (readonly) — milliseconds since `statusLine()` was constructed, frozen
the moment `stop()` runs.

---

### `StatusLineOptions`

```typescript
interface StatusLineOptions {
	intervalMs?: number;
	frames?: readonly string[];
	clock?: boolean;
	counters?: readonly CounterDecl[];
	enabled?: boolean;
	fallback?: FallbackPolicy;
	hideCursor?: boolean;
	io?: Partial<Io>;
}
```

| Option       | Type                     | Default          | Description                                                                                                         |
| ------------ | ------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| `intervalMs` | `number`                 | `100`            | Redraw interval in milliseconds. Also the worst-case latency of a `set()`.                                          |
| `frames`     | `readonly string[]`      | `BRAILLE_FRAMES` | Spinner frames, cycled one per tick. See [`ASCII_FRAMES`](#ascii_frames) for a text-only alternative.               |
| `clock`      | `boolean`                | `true`           | Show the elapsed `"m:ss"` clock.                                                                                    |
| `counters`   | `readonly CounterDecl[]` | `[]`             | Counters to render, in declaration order. See [`CounterDecl`](#counterdecl).                                        |
| `enabled`    | `boolean`                | _auto-detected_  | Force the animated path on or off. Auto: `isTerminal() && TERM !== "dumb" && !CI`. Explicit values always win.      |
| `fallback`   | `FallbackPolicy`         | `"notable"`      | What to emit when the animated path is off. See [`FallbackPolicy`](#fallbackpolicy).                                |
| `hideCursor` | `boolean`                | `false`          | Hide the terminal cursor while animated. See [Cursor contract](#cursor-contract). Ignored on the non-animated path. |
| `io`         | `Partial<Io>`            | _Node defaults_  | Override part of the platform seam; the rest defers to the built-in `node:process` adapter. See [`Io`](#io).        |

---

### `CounterDecl`

```typescript
interface CounterDecl {
	key: string;
	glyph: string;
}
```

A named counter and its display glyph, rendered as `<count><glyph>` (e.g. `3⚒`).
Counters are declared up front so the width math is stable frame to frame.

Use a **text-presentation** glyph: `"⚒"` occupies one column, while `"⚒️"` (with
the U+FE0F variation selector) is measured as 1 but drawn as 2 by most
terminals — mixing the two overflows the line.

---

### `StatusLineSetOptions`

```typescript
interface StatusLineSetOptions {
	notable?: boolean;
}
```

- `notable` (`boolean`, optional) — mark this update as worth a log line when
  the animated path is off. Default `false`. Ignored while animating.

---

### `StatusLineStopOptions`

```typescript
interface StatusLineStopOptions {
	clear?: boolean;
	text?: string;
}
```

- `clear` (`boolean`, optional) — erase the last drawn frame. Default `true`.
  When `false` and a frame was drawn, `stop()` moves the cursor below it with a
  newline instead, leaving the frame visible as a final trace.
- `text` (`string`, optional) — final message written on its own line after the
  frame is erased. When `text` is set, the erase happens even if
  `clear === false`, so the message lands cleanly.

---

### `FallbackPolicy`

```typescript
type FallbackPolicy =
	| "silent"
	| "notable"
	| ((snapshot: StatusSnapshot) => string | null);
```

How to render a `set()` when the animated path is off.

- `"silent"` — write nothing, ever.
- `"notable"` — the default. Emit one line per `set(…, { notable: true })`,
  formatted as `⋯ <clock> <label> <detail>` (non-empty pieces joined by a single
  space, no indentation) and truncated to 160 terminal columns.
- **Custom function** — receives a full [`StatusSnapshot`](#statussnapshot) and
  returns the line to write _without_ a trailing newline, or `null` to skip.

Consecutive identical lines are suppressed by the runtime regardless of which
policy produced them, and `\r` / spinner frames never reach a log file.

```typescript
const line = statusLine({
	fallback: (s) => (s.notable ? `[${s.clock}] ${s.label} — ${s.detail}` : null),
});
```

---

### `StatusSnapshot`

```typescript
interface StatusSnapshot {
	elapsedMs: number;
	clock: string;
	label: string;
	detail: string;
	counters: Readonly<Record<string, number>>;
	notable: boolean;
}
```

What a custom `FallbackPolicy` receives on each `set()`. Every field is already
sanitized and formatted, so a policy can drop them straight into a line.

- `elapsedMs` — milliseconds since construction.
- `clock` — formatted `"m:ss"` when the clock is enabled, `""` otherwise.
- `label` / `detail` — the sanitized strings from this `set()`.
- `counters` — frozen view of the declared counters at snapshot time, keyed by
  `CounterDecl.key`.
- `notable` — whether the caller passed `{ notable: true }`.

---

### `Io`

```typescript
interface Io {
	write(s: string): void;
	columns(): number;
	isTerminal(): boolean;
	env(key: string): string | undefined;
	unrefTimer(timer: unknown): void;
	now(): number;
	onExit(fn: () => void): () => void;
}
```

The platform seam — the one place the library touches the runtime. Pass a
`Partial<Io>` as `options.io` to override individual members; the rest defer to
the built-in `node:process` adapter. Primarily a testing seam, but also the
supported way to render at a chosen width.

**Every member must be total — no member may throw.** That contract is what lets
`statusLine()` guarantee it never throws into the host.

- `write(s)` — write the whole string. The built-in adapter uses
  `process.stdout.write`, the same stream as `console.log`, so the line and your
  own output never reorder.
- `columns()` — terminal width; the built-in adapter reads `process.stdout.columns`
  (then `process.stderr.columns`) and returns `80` when unknown.
  Re-read on every tick, which is how a resize is handled without a `SIGWINCH`
  listener.
- `isTerminal()` — whether stdout is a tty.
- `env(key)` — `undefined` when unset _or_ when the runtime denies access.
- `unrefTimer(timer)` — let the process exit with the timer still pending. `timer`
  is whatever `setInterval` returned; the built-in adapter calls its `unref()`.
- `now()` — monotonic-enough milliseconds; only ever compared to itself.
- `onExit(fn)` — run `fn` at normal process exit (including `process.exit()`);
  returns an unsubscribe function. The built-in adapter uses `process.on("exit")`.

```typescript
// Render the layout at a fixed width, off-tty.
const chunks: string[] = [];
const line = statusLine({
	enabled: true,
	io: { columns: () => 40, write: (s) => void chunks.push(s) },
});
```

---

## Constants

### `BRAILLE_FRAMES`

`readonly string[]` — the default spinner: a ten-frame braille dot rotation
(`⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏`). Renders smoothly on any terminal whose font carries the
U+28xx block, which is all mainstream terminals since ~2015.

### `ASCII_FRAMES`

`readonly string[]` — the classic four-phase ASCII spinner (`-` `\` `|` `/`).
Pass to `frames` when the default would show tofu.

```typescript
const line = statusLine({ frames: ASCII_FRAMES });
```

---

## Behaviour reference

### Rendered shape

```
⠹ 0:04 · 3⚒ running scripts/build.ts
^ ^      ^  ^       ^
| |      |  |       detail              (dim)
| |      |  label                       (yellow)
| |      counters                       (dim, joined by " ")
| clock                                 (dim, m:ss)
spinner                                 (cyan, one frame per tick)
```

The order is fixed in v1: `spinner clock · counters label detail`.

### Width budget and degradation

A hard budget of `columns - 1` is enforced on every tick — the last column stays
blank because many terminals auto-wrap when it is written. When the content does
not fit, the fit runs as two nested passes, not one flat list.

**Outer pass — thin the head.** Three tiers are tried in order:
`clock + counters` → `clock` alone → neither. A tier is abandoned as soon as it
leaves the tail fewer than 8 columns, so **counters are dropped before `detail`
is dropped entirely** — the text is worth more than the counts.

**Inner pass — fit the tail into what is left.** Within the chosen tier:
truncate `detail` with an ellipsis; if it still does not fit, drop `detail` and
truncate `label`. Finally, if not even the spinner plus a one-column tail fits,
the spinner is rendered alone, and at `columns <= 1` nothing is drawn — only the
erase sequence is written.

The same state (`3⚒`, `running`, `scripts/build.ts`) at shrinking widths:

| `columns` | Rendered                               |
| --------- | -------------------------------------- |
| 60        | `⠙ 0:00 · 3⚒ running scripts/build.ts` |
| 30        | `⠙ 0:00 · 3⚒ running scripts/…`        |
| 20        | `⠙ 0:00 running scr…`                  |
| 14        | `⠙ running sc…`                        |
| 10        | `⠙ running`                            |
| 4         | `⠙ …`                                  |
| 1         | _(nothing)_                            |

Truncation iterates graphemes, so a surrogate pair or combining sequence is never
split, and colour is applied _after_ truncation so ANSI bytes never inflate the
measured width.

Width comes from `process.stdout.columns`, re-read every tick — **`COLUMNS` is not
read**. To render at a chosen width, inject `columns()` through the [`Io`](#io)
seam.

Colour is off when `NO_COLOR` is set to a non-empty value (read once, at
construction, through `io.env`).

### Animated vs non-animated

```
animated = enabled ?? (isTerminal() && TERM !== "dumb" && !CI)
```

`CI` counts as set for any value other than `""`, `"0"`, or `"false"`. An
explicit `enabled: true` forces animation even off-tty; `enabled: false` forces
the fallback path even on a tty.

On the non-animated path there is no interval, no `\r`, and no spinner — only
whatever the [`FallbackPolicy`](#fallbackpolicy) emits.

### Cursor contract

With `hideCursor: true` the library emits `\x1b[?25l` at construction and
restores with `\x1b[?25h` in `stop()`. It also registers `onExit(restore)` so a
normal exit — including `process.exit()` — puts the cursor back.

**Signals are the host's job.** The library never calls
`process.on("SIGINT", …)`: a `SIGINT` listener disables the default
terminate-on-Ctrl-C behaviour and would silently keep the host alive. A
signal-killed process therefore never emits `exit`, `onExit` does not fire, and
the cursor stays hidden. If you want cursor restore on Ctrl-C, own the handler:

```typescript
const line = statusLine({ hideCursor: true });
process.on("SIGINT", () => {
	line.stop({ text: "interrupted" });
	process.exit(130);
});
```

### Error and lifecycle guarantees

- **Never throws.** Every method swallows its own errors; a bad frame cannot kill
  the run.
- **Never keeps the host alive.** The redraw interval is unref'd the moment it is
  created, and `stop()` clears it and unsubscribes the exit hook.
- **Idempotent.** `pause()`, `resume()` and `stop()` can be called repeatedly;
  after the first `stop()` every method is a no-op.
