import { assert, assertEquals } from "@std/assert";
import { displayWidth, sanitize, truncateToWidth } from "../src/width.ts";

Deno.test("displayWidth: empty string is 0", () => {
	assertEquals(displayWidth(""), 0);
});

Deno.test("displayWidth: ASCII is one column per char", () => {
	assertEquals(displayWidth("hello"), 5);
	assertEquals(displayWidth("a b c"), 5);
});

Deno.test("displayWidth: CJK glyphs are 2 columns each", () => {
	assertEquals(displayWidth("天地"), 4);
	assertEquals(displayWidth("天地玄黃"), 8);
});

Deno.test("displayWidth: emoji is 2 columns", () => {
	assertEquals(displayWidth("😀"), 2);
});

Deno.test("displayWidth: combining sequence is one column, two code units", () => {
	const s = "é"; // e + combining acute → "é"
	assertEquals(s.length, 2);
	assertEquals(displayWidth(s), 1);
});

Deno.test("displayWidth: ANSI escape codes are counted as columns", () => {
	// This is the whole reason colour must be applied after truncation.
	assertEquals(displayWidth("\x1b[36m⠋\x1b[39m"), 9);
});

Deno.test("truncateToWidth: returns s unchanged when it already fits", () => {
	assertEquals(truncateToWidth("hi", 5), "hi");
	assertEquals(truncateToWidth("hi", 2), "hi");
	assertEquals(truncateToWidth("", 5), "");
});

Deno.test("truncateToWidth: appends ellipsis and respects the budget", () => {
	assertEquals(truncateToWidth("hello", 4), "hel…"); // 3 + 1
	assertEquals(truncateToWidth("hello", 3), "he…"); // 2 + 1
	assertEquals(truncateToWidth("hello", 2), "h…"); // 1 + 1
});

Deno.test("truncateToWidth: max = 0 returns empty string", () => {
	assertEquals(truncateToWidth("hello", 0), "");
	assertEquals(truncateToWidth("", 0), "");
});

Deno.test("truncateToWidth: max smaller than ellipsis width returns empty", () => {
	// Ellipsis "…" is 1 column; a negative max also returns "".
	assertEquals(truncateToWidth("hello", -3), "");
});

Deno.test("truncateToWidth: max equals ellipsis width returns just ellipsis", () => {
	// budget = 0, no segments fit — the caller decides whether to drop it.
	assertEquals(truncateToWidth("hello", 1), "…");
});

Deno.test("truncateToWidth: never splits a wide emoji grapheme", () => {
	// 😀 is 2 cols, one grapheme; with max=3, budget=2, the emoji just fits.
	assertEquals(truncateToWidth("😀world", 3), "😀…");
	// max=2 → budget=1 → emoji does not fit → just the ellipsis.
	assertEquals(truncateToWidth("😀world", 2), "…");
});

Deno.test("truncateToWidth: never splits a combining sequence", () => {
	// "é" is one grapheme, 1 column; length 2.
	const s = "éello"; // "éello", width 5
	assertEquals(displayWidth(s), 5);
	const out = truncateToWidth(s, 3);
	assertEquals(displayWidth(out), 3);
	// Base and combining mark stayed together.
	assert(
		out.includes("é"),
		`expected combining sequence intact, got ${JSON.stringify(out)}`,
	);
});

Deno.test("truncateToWidth: keeps CJK full-width columns intact", () => {
	const s = "天地玄黃"; // width 8
	// max=5, budget=4 → fits 天地 (width 4) + ellipsis (1) = 5.
	assertEquals(truncateToWidth(s, 5), "天地…");
	assertEquals(displayWidth(truncateToWidth(s, 5)), 5);
	// max=4, budget=3 → fits 天 (2) but not 地 (would overflow to 4>3).
	assertEquals(truncateToWidth(s, 4), "天…");
});

Deno.test("truncateToWidth: property — width never exceeds n for any n in [0, len+2]", () => {
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

Deno.test("sanitize: empty string is empty", () => {
	assertEquals(sanitize(""), "");
});

Deno.test("sanitize: collapses whitespace (including newlines) to a single space", () => {
	assertEquals(sanitize("a\nb"), "a b");
	assertEquals(sanitize("a  b\t\tc"), "a b c");
	assertEquals(sanitize("a\r\nb\r\nc"), "a b c");
	// Trims edges.
	assertEquals(sanitize("  a  "), "a");
	assertEquals(sanitize("\n\t hello \n"), "hello");
});

Deno.test("sanitize: strips ANSI CSI (colour) sequences", () => {
	assertEquals(sanitize("\x1b[36mhello\x1b[39m"), "hello");
	assertEquals(sanitize("a\x1b[1;31mBOLD\x1b[0mb"), "aBOLDb");
});

Deno.test("sanitize: strips ANSI OSC sequences (window title, etc.)", () => {
	// ESC ] 0 ; title BEL
	assertEquals(sanitize("a\x1b]0;title\x07b"), "ab");
	// ST-terminated form: ESC ] ... ESC \
	assertEquals(sanitize("a\x1b]0;title\x1b\\b"), "ab");
});

Deno.test("sanitize: strips C0 control chars and DEL", () => {
	assertEquals(sanitize("a\x00b\x01c"), "abc");
	assertEquals(sanitize("a\x7fb"), "ab");
});

Deno.test("sanitize: strips C1 control chars", () => {
	assertEquals(sanitize("a\x80b\x9fc"), "abc");
});

Deno.test("sanitize: strips a lone ESC that isn't part of a recognised sequence", () => {
	assertEquals(sanitize("a\x1bb"), "ab");
});

Deno.test("sanitize: leaves ordinary printable text alone", () => {
	assertEquals(sanitize("hello world"), "hello world");
	assertEquals(sanitize("天地 😀"), "天地 😀");
});
