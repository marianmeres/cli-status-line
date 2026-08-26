/**
 * Non-animated fallback: `\r` means nothing to a file, and a spinner written
 * to one is ten frames a second of garbage. When the target is not a tty (or
 * the caller forces `enabled: false`, or `TERM=dumb`, or `CI` is set),
 * `statusLine()` skips the animated path and instead lets a policy emit one
 * plain line per notable state change through `io.write`.
 *
 * Nothing here reaches for the `console` global (decision D5): the package's
 * output _is_ its product and needs ordered, synchronous writes on the same
 * stream as the animated line, so everything goes through `io.write`.
 */

import type { Io } from "./io.ts";
import { truncateToWidth } from "./width.ts";

/**
 * Cap the built-in `"notable"` line at 160 terminal columns — same as the
 * reference implementation and comfortable for a log file.
 */
export const FALLBACK_LINE_MAX = 160;

/**
 * Snapshot of the status-line state passed to a fallback function on each
 * `set()`. All fields are already sanitized / caller-formatted, so a policy
 * can drop them straight into a line.
 */
export interface StatusSnapshot {
	/** Milliseconds since `statusLine()` was constructed. */
	elapsedMs: number;
	/** Formatted `"m:ss"` when the clock is enabled, `""` otherwise. */
	clock: string;
	/** Sanitized `label` from the current `set()`. */
	label: string;
	/** Sanitized `detail` from the current `set()`. */
	detail: string;
	/** Frozen view of the declared counters at snapshot time. */
	counters: Readonly<Record<string, number>>;
	/** Whether the caller flagged this update with `{ notable: true }`. */
	notable: boolean;
}

/**
 * How to render (or not) a `set()` when the animated path is off.
 *
 * - `"silent"` — write nothing, ever.
 * - `"notable"` — default. Emit one line per `set(…, { notable: true })`;
 *   the built-in format is `⋯ <clock> <label> <detail>` (no indentation),
 *   truncated to {@link FALLBACK_LINE_MAX} columns.
 * - Custom function — receives a full {@link StatusSnapshot} and returns the
 *   line to write (without the trailing newline) or `null` to skip.
 *
 * Consecutive identical lines are suppressed by the runtime regardless of
 * which policy produced them.
 */
export type FallbackPolicy =
	| "silent"
	| "notable"
	| ((snapshot: StatusSnapshot) => string | null);

/**
 * Built-in `"notable"` renderer. Joins the non-empty pieces with a single
 * space (so a disabled clock does not leave a double space) and truncates
 * the whole line to {@link FALLBACK_LINE_MAX} columns via `truncateToWidth`
 * — the reference used a code-unit `slice(0, 160)` that misbehaved on CJK
 * and emoji.
 */
export function renderNotable(snap: StatusSnapshot): string {
	const parts = ["⋯", snap.clock, snap.label, snap.detail].filter(
		(s) => s !== "",
	);
	return truncateToWidth(parts.join(" "), FALLBACK_LINE_MAX);
}

/**
 * Turn a {@link FallbackPolicy} value into the runtime function used by
 * `statusLine()`. `"silent"` becomes a constant `null`; `"notable"` becomes
 * a wrapper that gates {@link renderNotable} on `snap.notable`; a function
 * is returned as-is.
 */
export function resolveFallback(
	policy: FallbackPolicy | undefined,
): (snap: StatusSnapshot) => string | null {
	if (typeof policy === "function") return policy;
	if (policy === "silent") return () => null;
	return (snap) => (snap.notable ? renderNotable(snap) : null);
}

// `""`, `"0"`, `"false"` are the classic "not set" spellings some CI images
// use to blank out an inherited `CI=true`. Anything else counts as set.
const CI_UNSET = new Set(["", "0", "false"]);

/**
 * Whether the `CI` environment variable indicates a CI environment. `CI`
 * absent → `false`; `CI` set to `""`, `"0"`, or `"false"` → `false`; any
 * other value → `true` (decision D9).
 */
export function isCi(io: Io): boolean {
	const v = io.env("CI");
	if (v === undefined) return false;
	return !CI_UNSET.has(v);
}

/**
 * Resolve the animated-vs-fallback branch:
 *
 *     enabled ?? (isTerminal() && TERM !== "dumb" && !isCi())
 *
 * An explicit `enabled: true` / `false` always wins — a caller that asks
 * for animation on a non-tty gets animation, and a caller that asks for
 * silence on a tty gets silence. The auto-detect fires only when `enabled`
 * is `undefined` (decision D9).
 */
export function isAnimated(io: Io, enabled: boolean | undefined): boolean {
	if (enabled !== undefined) return enabled;
	if (!io.isTerminal()) return false;
	if (io.env("TERM") === "dumb") return false;
	if (isCi(io)) return false;
	return true;
}
