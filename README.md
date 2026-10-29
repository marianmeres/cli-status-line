# @marianmeres/cli-status-line

[![NPM](https://img.shields.io/npm/v/@marianmeres/cli-status-line)](https://www.npmjs.com/package/@marianmeres/cli-status-line)
[![JSR](https://jsr.io/badges/@marianmeres/cli-status-line)](https://jsr.io/@marianmeres/cli-status-line)
[![License](https://img.shields.io/npm/l/@marianmeres/cli-status-line)](LICENSE)

Reassurance at a glance for long-running CLI work: one line at the bottom of the
terminal that rewrites itself in place with a spinner, an elapsed clock,
counters, and a short label/detail. The transcript above stays free to say what
actually happened; the status line answers a single question — _"is it still
alive?"_ — without spamming the log.

## Rendered shape

```
⠹ 0:04 · 3⚒ running scripts/build.ts
^ ^      ^  ^       ^
| |      |  |       detail              (dim)
| |      |  label                       (yellow)
| |      counters                       (dim, joined by " ")
| clock                                 (dim, m:ss)
spinner                                 (cyan, one frame per tick)
```

A hard `columns - 1` budget is enforced per tick. When the terminal is too
narrow the layout degrades rather than wrapping: the head is thinned first
(`counters`, then `clock`), the tail is then truncated (`detail` before
`label`), and at the extreme the spinner is left standing alone. Colour lands
after truncation so ANSI bytes never inflate the width. See
[Width budget and degradation](API.md#width-budget-and-degradation) for the
exact order and a worked example.

## Installation

```bash
npm install @marianmeres/cli-status-line
```

Node 24.12 or newer, zero runtime dependencies. The same source is on JSR for
Deno consumers (`deno add jsr:@marianmeres/cli-status-line`); it uses `node:*`
only, which Deno runs through its Node compatibility.

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

Every method is idempotent and never throws. Post-`stop()` calls are no-ops, and
the redraw timer is unref'd — the library can never keep your process alive or
change how it dies.

When stdout is not a tty, or `TERM=dumb`, or `CI` is set, the redraw loop is
skipped entirely: no `\r`, no spinner frames, just at most one plain line per
`set(…, { notable: true })`. That is what the `{ notable: true }` above is for.

## Examples

[`examples/`](./examples/) has one runnable script per topic — clone the repo,
`pnpm install`, and run any of them, no arguments or setup:

```bash
pnpm -s example examples/01-basic.ts
pnpm -s example examples/02-counters-and-log.ts | cat   # same code, non-animated path
```

| Script                                                                      | Shows                                                  |
| --------------------------------------------------------------------------- | ------------------------------------------------------ |
| [`01-basic.ts`](./examples/01-basic.ts)                                     | The minimal spinner + clock + label                    |
| [`02-counters-and-log.ts`](./examples/02-counters-and-log.ts)               | Declared counters, `inc()`, and `log()` above the line |
| [`03-non-tty-fallback.ts`](./examples/03-non-tty-fallback.ts)               | What lands in a log file under a pipe or in CI         |
| [`04-custom-fallback.ts`](./examples/04-custom-fallback.ts)                 | Owning that format with a `FallbackPolicy` function    |
| [`05-narrow-terminal.ts`](./examples/05-narrow-terminal.ts)                 | The degradation ladder, rendered at ten widths at once |
| [`06-pause-for-prompt.ts`](./examples/06-pause-for-prompt.ts)               | `pause()` / `resume()` around a `readline` question    |
| [`07-hide-cursor-and-signals.ts`](./examples/07-hide-cursor-and-signals.ts) | `hideCursor` and the host-owned `SIGINT` handler       |

Note that `COLUMNS=40` does **not** narrow the line: width comes from
`process.stdout.columns`, re-read on every tick. Resize the window, or see
[`05-narrow-terminal.ts`](./examples/05-narrow-terminal.ts), which injects
`columns()` through the `io` seam.

## API

See [API.md](API.md) for the complete reference — options, the `StatusLine`
methods, fallback policies, the `Io` seam, and the width/degradation rules.

Two contracts are worth knowing before you reach for them:

- **`hideCursor` and signals.** The library restores the cursor in `stop()` and
  on a normal exit, but it never registers a signal listener — that would
  disable the default terminate-on-Ctrl-C. If you want the cursor back after Ctrl-C,
  own the handler and call `stop()` from it. See
  [Cursor contract](API.md#cursor-contract).
- **Counter glyphs must be text-presentation.** `"⚒"` is one column; `"⚒️"` (with
  U+FE0F) measures as one but draws as two, which overflows the line.

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
