/**
 * # `@marianmeres/cli-status-line`
 *
 * Reassurance at a glance for long-running CLI work: one line at the bottom of
 * the terminal that rewrites itself in place with a spinner, an elapsed clock,
 * counters, and a short label / detail. The transcript above stays free to say
 * what actually happened; the status line answers a single question — *"is it
 * still alive?"* — without spamming the log.
 *
 * ## Shape (animated path)
 *
 *     ⠹ 0:04 · 3⚒ running scripts/build.ts
 *     ^ ^      ^  ^       ^
 *     | |      |  |       detail              (dim)
 *     | |      |  label                       (yellow)
 *     | |      counters                       (dim, joined by " ")
 *     | clock                                 (dim, m:ss)
 *     spinner                                 (cyan, one frame per tick)
 *
 * A hard `columns - 1` budget is enforced per tick (`layout()` degrades
 * gracefully: truncate detail → drop detail → drop counters → drop clock →
 * spinner only). Colour lands after truncation so ANSI bytes never inflate
 * the width.
 *
 * ## Non-animated path
 *
 * When stdout is not a tty, or `TERM=dumb`, or `CI` is set (see {@link StatusLineOptions.enabled}),
 * `statusLine()` skips the redraw loop entirely and emits at most one plain
 * line per notable `set()` through {@link FallbackPolicy}. `\r` and spinner
 * frames never reach a log file.
 *
 * ## Example
 *
 *     import { statusLine } from "@marianmeres/cli-status-line";
 *
 *     const line = statusLine({ counters: [{ key: "tools", glyph: "⚒" }] });
 *     line.set("starting");
 *     for await (const ev of workEvents()) {
 *         if (ev.kind === "tool") line.inc("tools");
 *         line.set(ev.name, ev.detail, { notable: ev.kind === "tool" });
 *     }
 *     line.stop({ text: "done" });
 *
 * ## Host contract
 *
 * The library never registers signal listeners — a `SIGINT` handler would
 * disable the default terminate-on-Ctrl-C behaviour and silently keep the
 * host alive. If `hideCursor: true` is used, the host is responsible for
 * calling `stop()` from its own `SIGINT` handler if it wants the cursor
 * restored on Ctrl-C; a normal exit (including `process.exit()`) is handled
 * automatically via `io.onExit`.
 *
 * @module
 */

export type { FallbackPolicy, StatusSnapshot } from "./fallback.ts";
export type { Io } from "./io.ts";
export type {
	CounterDecl,
	StatusLine,
	StatusLineOptions,
	StatusLineSetOptions,
	StatusLineStopOptions,
} from "./status-line.ts";
export { ASCII_FRAMES, BRAILLE_FRAMES, statusLine } from "./status-line.ts";
