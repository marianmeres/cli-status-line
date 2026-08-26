# @marianmeres/cli-status-line

[![JSR](https://jsr.io/badges/@marianmeres/cli-status-line)](https://jsr.io/@marianmeres/cli-status-line)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Reassurance at a glance for long-running CLI work: one line at the bottom of the
terminal that rewrites itself in place with a spinner, an elapsed clock,
counters, and a short label/detail. The transcript above stays free to say what
actually happened; the status line answers a single question — _"is it still
alive?"_ — without spamming the log.

## Rendered shape

```
⠹ 0:04 · 3⚒ · running · scripts/build.ts
^ ^         ^         ^        ^
| |         |         |        detail  (dim)
| |         |         label            (yellow)
| |         counters                   (dim, joined by " ")
| clock                                (dim, m:ss)
spinner                                (cyan, one frame per tick)
```

A hard `columns - 1` budget is enforced per tick. When the terminal is too
narrow, the layout degrades: truncate `detail` → drop `detail` → drop
`counters` → drop `clock` → spinner alone. Colour lands after truncation so
ANSI bytes never inflate the width.

## Installation

```bash
deno add jsr:@marianmeres/cli-status-line
```

## Usage

```typescript
import { statusLine } from "@marianmeres/cli-status-line";

const line = statusLine({ counters: [{ key: "tools", glyph: "⚒" }] });
line.set("starting", "warming up caches");

for await (const ev of workEvents()) {
	if (ev.kind === "tool") line.inc("tools");
	line.set(ev.name, ev.detail, { notable: ev.kind === "tool" });
}

line.stop({ text: "done" });
```

Every method is idempotent and never throws. Post-`stop()` calls are no-ops.

## API

### `statusLine(options?): StatusLine`

Create a live status line. Starts the interval immediately when animated;
always draws once at construction so the line exists before the first tick.

#### Options (`StatusLineOptions`)

| Option       | Type                     | Default          | Description                                                                                               |
| ------------ | ------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------- |
| `intervalMs` | `number`                 | `100`            | Redraw interval in milliseconds.                                                                          |
| `frames`     | `readonly string[]`      | `BRAILLE_FRAMES` | Spinner frames, cycled one per tick. See `ASCII_FRAMES` for a text-only alternative.                      |
| `clock`      | `boolean`                | `true`           | Whether to show the elapsed `"m:ss"` clock.                                                               |
| `counters`   | `readonly CounterDecl[]` | `[]`             | Counters to show in declaration order. `{ key, glyph }`. `inc()` on an undeclared key no-ops.             |
| `enabled`    | `boolean \| undefined`   | _auto-detected_  | Force the animated path on/off. Auto: `isTerminal() && TERM !== "dumb" && !CI`.                           |
| `fallback`   | `FallbackPolicy`         | `"notable"`      | How to emit updates when the animated path is off. See [Non-animated behaviour](#non-animated-behaviour). |
| `hideCursor` | `boolean`                | `false`          | Hide the terminal cursor while the line is animated. See [Cursor contract](#cursor-contract).             |
| `io`         | `Partial<Io>`            | _Deno defaults_  | Inject a partial `Io` for tests; the rest defers to the built-in Deno adapter.                            |

#### Returned interface (`StatusLine`)

| Method                       | Description                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `set(label, detail?, opts?)` | Update the label (and optional detail). Sanitized on the way in. No draw here; the next tick picks it up.       |
| `inc(key, by?)`              | Bump a declared counter by `by` (default `1`). An undeclared `key` is a silent no-op.                           |
| `log(...args)`               | Write a line of host output above the status line. Erases the current frame first; the next tick redraws.       |
| `pause()`                    | Erase the frame and suspend redraws until `resume()`. Synchronous for pairing with `confirm()` / `prompt()`.    |
| `resume()`                   | Resume redraws after a `pause()`. Idempotent; the next tick redraws.                                            |
| `stop(opts?)`                | Stop the interval, restore state, and (optionally) leave a final line via `{ clear?, text? }`. First call wins. |
| `elapsedMs` (readonly)       | Milliseconds since construction; frozen the moment `stop()` runs.                                               |

`set()` accepts `{ notable: true }` — in the non-animated path this is what
gates whether the default `"notable"` policy emits a line.

`stop()` accepts `{ clear?: boolean, text?: string }`. When `clear === false`
and a frame was drawn, the frame stays visible as a final trace; when `text`
is set it lands on its own line after the erase.

## Non-animated behaviour

When stdout is not a tty, or `TERM=dumb`, or `CI` is set (any value other than
`""`, `"0"`, `"false"`), `statusLine()` skips the redraw loop entirely and
emits at most one plain line per state change through a `FallbackPolicy`:

- `"silent"` — write nothing, ever.
- `"notable"` — default. Emit one line per `set(…, { notable: true })`; the
  built-in format is `⋯ <clock> <label> <detail>` (no indentation), truncated
  to 160 columns.
- Custom function `(snap: StatusSnapshot) => string | null` — receives a full
  snapshot and returns the line to write (without trailing newline), or `null`
  to skip. Useful when a caller needs a specific log shape.

Consecutive identical lines are suppressed by the runtime regardless of
which policy produced them. `\r` and spinner frames never reach a log file.

`enabled: true` forces animation even off-tty; `enabled: false` forces the
fallback path even on a tty.

## Cursor contract

When `hideCursor: true`, the library emits `\x1b[?25l` at construction and
restores with `\x1b[?25h` in `stop()`. It also registers `onExit(restore)` so
a normal `unload` (including `Deno.exit()`) puts the cursor back.

**Signals are the host's job.** The library never calls
`Deno.addSignalListener` — a `SIGINT` handler disables Deno's default
terminate-on-Ctrl-C behaviour and would silently keep the host alive. That
means a signal-killed process bypasses `unload`, so `onExit` does not fire
and the cursor stays hidden. If the host wants cursor restore on Ctrl-C, it
must own the signal handler (typically by calling `stop()` from its own
handler before exiting).

## Deno only — why

The library reaches for `Deno.stdout.writeSync`, `Deno.consoleSize`,
`Deno.stdout.isTerminal`, `Deno.env.get`, and `Deno.unrefTimer` through a
single seam (`Io` in `src/io.ts`). A Node adapter is a one-file change with
no public API surface impact; it is deliberately deferred until a Node
consumer exists.

## Scope

The library **is not**:

- **A segment / priority system.** The layout order is fixed
  (`spinner clock · counters label detail`). Priorities and custom segment
  registration are deferred until a caller needs a different order.
- **A multi-line renderer.** One line, one budget, one redraw. Multi-line
  layouts belong to a different tool.
- **A progress-bar library.** Percentages, ETAs, and bar rendering are out of
  scope. Counters cover the "N of M" reassurance need without the width and
  math obligations of a proper bar.

## Origin

Extracted from an internal driver that needed a single-line, tick-only status
line with a plain-text fallback for redirected output. The seam-based design
(`Io`, `FallbackPolicy`, tick-only drawing) is the shape that fell out of
running it in anger.

## License

[MIT](LICENSE)
