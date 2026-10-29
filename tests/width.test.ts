import assert from "node:assert/strict";
import { test } from "node:test";
import { displayWidth, sanitize, truncateToWidth } from "../src/width.ts";

test("displayWidth: empty string is 0", () => {
	assert.deepEqual(displayWidth(""), 0);
});

test("displayWidth: ASCII is one column per char", () => {
	assert.deepEqual(displayWidth("hello"), 5);
	assert.deepEqual(displayWidth("a b c"), 5);
});

test("displayWidth: CJK glyphs are 2 columns each", () => {
	assert.deepEqual(displayWidth("天地"), 4);
	assert.deepEqual(displayWidth("天地玄黃"), 8);
});

test("displayWidth: emoji is 2 columns", () => {
	assert.deepEqual(displayWidth("😀"), 2);
});

test("displayWidth: combining sequence is one column, two code units", () => {
	const s = "é"; // e + combining acute → "é"
	assert.deepEqual(s.length, 2);
	assert.deepEqual(displayWidth(s), 1);
});

test("displayWidth: ANSI escape codes are counted as columns", () => {
	// This is the whole reason colour must be applied after truncation.
	assert.deepEqual(displayWidth("\x1b[36m⠋\x1b[39m"), 9);
});

test("truncateToWidth: returns s unchanged when it already fits", () => {
	assert.deepEqual(truncateToWidth("hi", 5), "hi");
	assert.deepEqual(truncateToWidth("hi", 2), "hi");
	assert.deepEqual(truncateToWidth("", 5), "");
});

test("truncateToWidth: appends ellipsis and respects the budget", () => {
	assert.deepEqual(truncateToWidth("hello", 4), "hel…"); // 3 + 1
	assert.deepEqual(truncateToWidth("hello", 3), "he…"); // 2 + 1
	assert.deepEqual(truncateToWidth("hello", 2), "h…"); // 1 + 1
});

test("truncateToWidth: max = 0 returns empty string", () => {
	assert.deepEqual(truncateToWidth("hello", 0), "");
	assert.deepEqual(truncateToWidth("", 0), "");
});

test("truncateToWidth: max smaller than ellipsis width returns empty", () => {
	// Ellipsis "…" is 1 column; a negative max also returns "".
	assert.deepEqual(truncateToWidth("hello", -3), "");
});

test("truncateToWidth: max equals ellipsis width returns just ellipsis", () => {
	// budget = 0, no segments fit — the caller decides whether to drop it.
	assert.deepEqual(truncateToWidth("hello", 1), "…");
});

test("truncateToWidth: never splits a wide emoji grapheme", () => {
	// 😀 is 2 cols, one grapheme; with max=3, budget=2, the emoji just fits.
	assert.deepEqual(truncateToWidth("😀world", 3), "😀…");
	// max=2 → budget=1 → emoji does not fit → just the ellipsis.
	assert.deepEqual(truncateToWidth("😀world", 2), "…");
});

test("truncateToWidth: never splits a combining sequence", () => {
	// "é" is one grapheme, 1 column; length 2.
	const s = "éello"; // "éello", width 5
	assert.deepEqual(displayWidth(s), 5);
	const out = truncateToWidth(s, 3);
	assert.deepEqual(displayWidth(out), 3);
	// Base and combining mark stayed together.
	assert(
		out.includes("é"),
		`expected combining sequence intact, got ${JSON.stringify(out)}`,
	);
});

test("truncateToWidth: keeps CJK full-width columns intact", () => {
	const s = "天地玄黃"; // width 8
	// max=5, budget=4 → fits 天地 (width 4) + ellipsis (1) = 5.
	assert.deepEqual(truncateToWidth(s, 5), "天地…");
	assert.deepEqual(displayWidth(truncateToWidth(s, 5)), 5);
	// max=4, budget=3 → fits 天 (2) but not 地 (would overflow to 4>3).
	assert.deepEqual(truncateToWidth(s, 4), "天…");
});

test("truncateToWidth: property — width never exceeds n for any n in [0, len+2]", () => {
	const s = "abc天地😀édef";
	const w = displayWidth(s);
	for (let n = -1; n <= w + 2; n++) {
		const out = truncateToWidth(s, n);
		const outWidth = displayWidth(out);
		assert(
			outWidth <= Math.max(0, n),
			`n=${n}: displayWidth(${JSON.stringify(out)})=${outWidth} > ${n}`,
		);
	}
});

test("sanitize: empty string is empty", () => {
	assert.deepEqual(sanitize(""), "");
});

test("sanitize: collapses whitespace (including newlines) to a single space", () => {
	assert.deepEqual(sanitize("a\nb"), "a b");
	assert.deepEqual(sanitize("a  b\t\tc"), "a b c");
	assert.deepEqual(sanitize("a\r\nb\r\nc"), "a b c");
	// Trims edges.
	assert.deepEqual(sanitize("  a  "), "a");
	assert.deepEqual(sanitize("\n\t hello \n"), "hello");
});

test("sanitize: strips ANSI CSI (colour) sequences", () => {
	assert.deepEqual(sanitize("\x1b[36mhello\x1b[39m"), "hello");
	assert.deepEqual(sanitize("a\x1b[1;31mBOLD\x1b[0mb"), "aBOLDb");
});

test("sanitize: strips ANSI OSC sequences (window title, etc.)", () => {
	// ESC ] 0 ; title BEL
	assert.deepEqual(sanitize("a\x1b]0;title\x07b"), "ab");
	// ST-terminated form: ESC ] ... ESC \
	assert.deepEqual(sanitize("a\x1b]0;title\x1b\\b"), "ab");
});

test("sanitize: strips C0 control chars and DEL", () => {
	assert.deepEqual(sanitize("a\x00b\x01c"), "abc");
	assert.deepEqual(sanitize("a\x7fb"), "ab");
});

test("sanitize: strips C1 control chars", () => {
	assert.deepEqual(sanitize("a\x80b\x9fc"), "abc");
});

test("sanitize: strips a lone ESC that isn't part of a recognised sequence", () => {
	assert.deepEqual(sanitize("a\x1bb"), "ab");
});

test("sanitize: leaves ordinary printable text alone", () => {
	assert.deepEqual(sanitize("hello world"), "hello world");
	assert.deepEqual(sanitize("天地 😀"), "天地 😀");
});
