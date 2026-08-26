/**
 * The runtime: turns the pure `layout()` / `paint()` core into a live status line.
 *
 * Reassurance at a glance, not a transcript — one line that rewrites itself in place
 * while a long-running task runs, freeing the transcript to say what actually matters.
 *
 * Two invariants shape every semantic in this file:
 *
 *   1. **Never throw into the host.** Every public method wraps its body in a
 *      swallowing `try/catch`; `io.write` is already non-throwing; a bad frame
 *      never kills the run.
 *   2. **Never keep the host alive or change how it dies.** The interval is
 *      unref'd via `io.unrefTimer` the moment it is created, and `stop()`
 *      clears it and unsubscribes the `onExit` hook. No signal listener is
 *      ever registered.
 *
 * Drawing is **tick-only**: `set()` and `inc()` mutate state and return; the
 * next `intervalMs` tick reads that state, re-reads `io.columns()` (which is
 * how a resize is handled without a `SIGWINCH` listener), composes the line
 * through `layout()` + `paint()`, and writes `\r` + line + `\x1b[K`. Worst-case
 * latency of an update is one interval — imperceptible for a status line, and
 * it removes an entire class of coalescing/dirty-flag bugs.
 */

import {
	type FallbackPolicy,
	isAnimated,
	resolveFallback,
	type StatusSnapshot,
} from "./fallback.ts";
import { type Io, resolveIo } from "./io.ts";
import { layout, paint } from "./layout.ts";
import { sanitize } from "./width.ts";

/** Default spinner frames — braille dot rotation, one frame per tick. */
export const DEFAULT_FRAMES: readonly string[] = [
	"⠋",
	"⠙",
	"⠹",
	"⠸",
	"⠼",
	"⠴",
	"⠦",
	"⠧",
	"⠇",
	"⠏",
];

/** Fallback spinner frames for terminals without braille support. */
export const ASCII_FRAMES: readonly string[] = ["-", "\\", "|", "/"];

/**
 * A named counter with its display glyph. Counters are declared up front so
 * `layout()`'s width math is stable frame to frame; `inc()` on an undeclared
 * key is a silent no-op (the never-throw rule outranks typo detection).
 *
 * The glyph should be text-presentation: `"⚒"` renders 1 column,
 * `"⚒️"` (with U+FE0F) is measured 1 by `unicodeWidth` but rendered 2 by most
 * terminals — mixing the two overflows the line.
 */
export interface CounterDecl {
	/** Identifier passed to `inc()`. */
	key: string;
	/** Single-column glyph appended to the count in the rendered head. */
	glyph: string;
}

/** Optional settings for `statusLine()`. Every field has a sane default. */
export interface StatusLineOptions {
	/** Redraw interval in milliseconds. Default 100. */
	intervalMs?: number;
	/** Spinner frames, cycled one per tick. Default `DEFAULT_FRAMES`. */
	frames?: readonly string[];
	/** Whether to show the elapsed `"m:ss"` clock. Default `true`. */
	clock?: boolean;
	/** Counters to show in declaration order. Default `[]` (none). */
	counters?: readonly CounterDecl[];
	/**
	 * Force the animated path on or off. When omitted, `statusLine()`
	 * auto-detects: animated iff `io.isTerminal() && TERM !== "dumb" && !CI`
	 * (where `CI` is any value other than `""`, `"0"`, `"false"`). Explicit
	 * `true` / `false` always wins over the probe (decision D9).
	 */
	enabled?: boolean;
	/**
	 * How to emit updates when the animated path is off. Default `"notable"`
	 * — one line per `set(…, { notable: true })`. Use `"silent"` to write
	 * nothing, or a function for a custom format. See {@link FallbackPolicy}.
	 */
	fallback?: FallbackPolicy;
	/** Inject a partial `Io` for tests; the rest defers to `denoIo`. */
	io?: Partial<Io>;
}

/** Extra options for `set()`. `notable` is consumed by the T05 fallback policy. */
export interface StatusLineSetOptions {
	/** In non-animated mode, mark this update as worth emitting a log line for. */
	notable?: boolean;
}

/** Options for `stop()`. */
export interface StatusLineStopOptions {
	/**
	 * Erase the last drawn frame from the terminal. Default `true`. When
	 * `false` and a frame was drawn, `stop()` moves the cursor below it with
	 * a newline instead — the frame stays visible as a final trace.
	 */
	clear?: boolean;
	/**
	 * Final message written on its own line after the frame is erased. Useful
	 * for "done in 3:12" summaries. When `clear === false`, the erase still
	 * happens so `text` lands cleanly.
	 */
	text?: string;
}

/** The live status line. Every method is idempotent and never throws. */
export interface StatusLine {
	/**
	 * Update the label (and optionally the detail) shown after the head.
	 * Sanitized on the way in — newlines and control characters cannot break
	 * the single-line contract. No draw happens here; the next tick picks it up.
	 */
	set(label: string, detail?: string, opts?: StatusLineSetOptions): void;
	/**
	 * Bump a declared counter by `by` (default 1). An undeclared `key` is a
	 * silent no-op — the never-throw rule wins over typo detection.
	 */
	inc(key: string, by?: number): void;
	/**
	 * Write a line of host output above the status line. Erases the current
	 * frame first (if any); the next tick redraws.
	 */
	log(...args: unknown[]): void;
	/**
	 * Erase the frame and suspend redraws until `resume()`. Synchronous by
	 * design: `confirm()` / `prompt()` block the event loop, so the timer
	 * cannot do this cleanup. Idempotent.
	 */
	pause(): void;
	/** Resume redraws after a `pause()`. Idempotent; the next tick redraws. */
	resume(): void;
	/**
	 * Stop the interval, restore state, and (optionally) leave a final line.
	 * First call wins — every subsequent method call is a no-op and
	 * `elapsedMs` freezes at the value captured here.
	 */
	stop(opts?: StatusLineStopOptions): void;
	/** Milliseconds since construction; frozen the moment `stop()` runs. */
	readonly elapsedMs: number;
}

function formatClock(elapsedMs: number): string {
	const s = Math.max(0, Math.round(elapsedMs / 1000));
	return `${Math.floor(s / 60)}:${`${s % 60}`.padStart(2, "0")}`;
}

/**
 * Create a live status line. Starts the interval immediately when animated;
 * always draws once at construction so the line exists before the first tick.
 */
export function statusLine(options: StatusLineOptions = {}): StatusLine {
	const io = resolveIo(options.io);
	const intervalMs = options.intervalMs ?? 100;
	const frames = options.frames ?? DEFAULT_FRAMES;
	const showClock = options.clock !== false;
	const counterDecls = options.counters ?? [];
	const counterState = new Map<string, number>();
	for (const c of counterDecls) counterState.set(c.key, 0);

	const animated = isAnimated(io, options.enabled);
	const runFallback = resolveFallback(options.fallback);
	let lastFallbackLine: string | null = null;

	const startedAt = io.now();
	let stoppedAt: number | null = null;
	let frame = 0;
	let label = "";
	let detail = "";
	let live = true;
	let paused = false;
	let drawn = false;
	let timer: number | undefined;

	function elapsed(): number {
		return (stoppedAt ?? io.now()) - startedAt;
	}

	function snapshotCounters(): Readonly<Record<string, number>> {
		const out: Record<string, number> = {};
		for (const [k, v] of counterState) out[k] = v;
		return out;
	}

	function renderFrame(): string {
		const clockStr = showClock ? formatClock(elapsed()) : undefined;
		const countersStr = counterDecls.map(
			(c) => `${counterState.get(c.key) ?? 0}${c.glyph}`,
		);
		const rawCols = io.columns();
		const cols = Number.isFinite(rawCols) ? Math.max(0, Math.floor(rawCols)) : 0;
		const parts = layout(
			{
				spinner: frames[frame] ?? "",
				clock: clockStr,
				counters: countersStr,
				label,
				detail,
			},
			cols,
		);
		return paint(parts);
	}

	function draw(): void {
		if (!live || paused || !animated) return;
		try {
			const painted = renderFrame();
			io.write("\r" + painted + "\x1b[K");
			drawn = true;
		} catch {
			// never-throw; drawn stays false so we don't erase what isn't there.
		}
	}

	function tick(): void {
		if (!live || paused) return;
		try {
			frame = (frame + 1) % Math.max(1, frames.length);
			draw();
		} catch {
			// never-throw
		}
	}

	if (animated) {
		draw();
		// Some environments type `setInterval` as returning a `Timeout` object
		// (Node compat shim); Deno's own runtime hands back a number and
		// `clearInterval` / `unrefTimer` accept it. Cast once at the boundary.
		timer = setInterval(tick, intervalMs) as unknown as number;
		io.unrefTimer(timer);
	}

	const api: StatusLine = {
		set(
			rawLabel: string,
			rawDetail: string = "",
			opts?: StatusLineSetOptions,
		): void {
			if (!live) return;
			try {
				label = sanitize(rawLabel ?? "");
				detail = sanitize(rawDetail ?? "");
				// Tick-only drawing (D4) for the animated path; the fallback
				// path emits on set() because there is no tick to piggyback on.
				if (!animated) {
					const elapsedNow = elapsed();
					const snap: StatusSnapshot = {
						elapsedMs: elapsedNow,
						clock: showClock ? formatClock(elapsedNow) : "",
						label,
						detail,
						counters: snapshotCounters(),
						notable: !!opts?.notable,
					};
					const line = runFallback(snap);
					if (line && line !== lastFallbackLine) {
						io.write(line + "\n");
						lastFallbackLine = line;
					}
				}
			} catch {
				// never-throw
			}
		},
		inc(key: string, by: number = 1): void {
			if (!live) return;
			try {
				if (!counterState.has(key)) return; // D8: undeclared is a no-op.
				counterState.set(key, (counterState.get(key) ?? 0) + by);
			} catch {
				// never-throw
			}
		},
		log(...args: unknown[]): void {
			if (!live) return;
			try {
				const msg = args.map((v) => String(v)).join(" ");
				if (animated && drawn) {
					io.write("\r\x1b[K");
					drawn = false;
				}
				io.write(msg + "\n");
			} catch {
				// never-throw
			}
		},
		pause(): void {
			if (!live || paused) return;
			try {
				paused = true;
				if (animated && drawn) {
					io.write("\r\x1b[K");
					drawn = false;
				}
			} catch {
				// never-throw
			}
		},
		resume(): void {
			if (!live || !paused) return;
			try {
				paused = false;
				// Next tick redraws.
			} catch {
				// never-throw
			}
		},
		stop(opts: StatusLineStopOptions = {}): void {
			if (!live) return;
			try {
				const clear = opts.clear ?? true;
				const text = opts.text;
				stoppedAt = io.now();
				live = false;
				if (timer !== undefined) {
					clearInterval(timer);
					timer = undefined;
				}
				if (drawn) {
					if (text !== undefined || clear) {
						io.write("\r\x1b[K");
					} else {
						io.write("\n");
					}
					drawn = false;
				}
				if (text !== undefined) {
					io.write(text + "\n");
				}
			} catch {
				// never-throw
			}
		},
		get elapsedMs(): number {
			return elapsed();
		},
	};

	return api;
}
