/**
 * Display-width helpers used by the renderer to compose one line that never
 * wraps. All three functions are pure and safe to call with any user string;
 * they never throw.
 *
 * Terminals count columns, not UTF-16 code units. Slicing on `.length` will
 * either overflow the visible width (CJK, emoji) or cut a surrogate pair.
 * `truncateToWidth` iterates graphemes so a combining sequence stays intact.
 *
 * `sanitize` is the library-side normaliser applied to `label` / `detail`
 * before they reach `layout()`: it strips ANSI escape sequences and other
 * control characters, and collapses whitespace (including newlines) to a
 * single space. A newline would otherwise break the single-line contract.
 */

import { unicodeWidth } from "@std/cli/unicode-width";

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

// ANSI CSI: ESC [ , optional parameter bytes 0x30-0x3F, optional intermediate
// bytes 0x20-0x2F, final byte 0x40-0x7E.
const ANSI_CSI = /\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g;
// ANSI OSC: ESC ] ... terminated by BEL (0x07) or ST (ESC \).
const ANSI_OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
// Two-byte ESC sequences: ESC + one byte 0x40-0x5F (e.g. ESC N, ESC P, ESC c).
const ANSI_ESC2 = /\x1b[\x40-\x5f]/g;
// Any remaining lone ESC.
const LONE_ESC = /\x1b/g;
// Control characters left after `\s+` collapsing: C0 minus whitespace, DEL, C1.
// `\s` already covers \t \n \v \f \r; those are collapsed to a single space
// before this regex runs.
const CONTROL_LEFTOVER = /[\x00-\x08\x0e-\x1f\x7f-\x9f]/g;

/**
 * Terminal columns occupied by `s`. Wraps `unicodeWidth` from `@std/cli`.
 *
 * Note: an ANSI escape sequence is counted by its codepoints, not as zero.
 * That is why the renderer applies colour only after truncation.
 */
export function displayWidth(s: string): number {
	return unicodeWidth(s);
}

/**
 * Cut `s` so `displayWidth(result) <= max`, appending `ellipsis` when anything
 * was cut. Iterates graphemes via `Intl.Segmenter`, so a surrogate pair or a
 * combining sequence is never split.
 *
 * When `s` already fits (`displayWidth(s) <= max`), `s` is returned unchanged
 * (no ellipsis). When `max < displayWidth(ellipsis)` — including `max <= 0` —
 * returns `""`; the caller decides whether to drop the segment.
 */
export function truncateToWidth(s: string, max: number, ellipsis = "…"): string {
	if (max <= 0) return "";
	if (displayWidth(s) <= max) return s;
	const ellipsisWidth = displayWidth(ellipsis);
	if (max < ellipsisWidth) return "";
	const budget = max - ellipsisWidth;
	let out = "";
	let width = 0;
	for (const { segment } of graphemeSegmenter.segment(s)) {
		const segWidth = displayWidth(segment);
		if (width + segWidth > budget) break;
		out += segment;
		width += segWidth;
	}
	return out + ellipsis;
}

/**
 * Normalise arbitrary user text into something safe for a single terminal
 * line: strip ANSI escape sequences and C0/C1 control characters, collapse
 * runs of whitespace (incl. newlines) to a single space, trim the edges.
 *
 * The library applies this to `label` and `detail` on the way in — the
 * layout must not trust the caller to have done it.
 */
export function sanitize(s: string): string {
	if (!s) return "";
	let out = s
		.replace(ANSI_CSI, "")
		.replace(ANSI_OSC, "")
		.replace(ANSI_ESC2, "")
		.replace(LONE_ESC, "");
	out = out.replace(/\s+/g, " ");
	out = out.replace(CONTROL_LEFTOVER, "");
	return out.trim();
}
