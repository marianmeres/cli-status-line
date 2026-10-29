import assert from "node:assert/strict";
import { test } from "node:test";
import { type LayoutInput, type LayoutParts, layout, paint } from "../src/layout.ts";
import { displayWidth } from "../src/width.ts";

// Colour off for byte-exact golden comparisons; `paint()` takes it as an argument.
const plain = (parts: LayoutParts): string => paint(parts, false);

const FULL: LayoutInput = {
	spinner: "⠋",
	clock: "1:23",
	counters: ["3⚒"],
	label: "compile really long",
	detail: "src/very/long/path.ts",
};

const EMPTY_PARTS = {
	spinner: "",
	clock: "",
	counters: "",
	label: "",
	detail: "",
};

function widthOk(painted: string, cols: number): boolean {
	return displayWidth(painted) <= Math.max(0, cols - 1);
}

test("layout: columns = 0 returns all-empty parts", () => {
	assert.deepEqual(layout(FULL, 0), EMPTY_PARTS);
});

test("layout: columns = 1 returns all-empty parts (last column left blank)", () => {
	assert.deepEqual(layout(FULL, 1), EMPTY_PARTS);
	assert.deepEqual(plain(layout(FULL, 1)), "");
});

test("layout: columns = 2 shows spinner alone", () => {
	const parts = layout(FULL, 2);
	assert.deepEqual(parts, { ...EMPTY_PARTS, spinner: "⠋" });
	assert.deepEqual(plain(parts), "⠋");
	assert(widthOk(plain(parts), 2));
});

test("layout: columns = 3 falls back to spinner alone (no room for tail)", () => {
	// tier1 head=11 > 2 · tier2 head=6 > 2 · tier3 head=1, room=0 → spinner only
	const parts = layout(FULL, 3);
	assert.deepEqual(parts, { ...EMPTY_PARTS, spinner: "⠋" });
	assert(widthOk(plain(parts), 3));
});

test("layout: columns = 6 drops clock+counters, truncates label", () => {
	// budget=5 · tier1 head=11 · tier2 head=6 · tier3 head=1, room=3 (last tier)
	const parts = layout(FULL, 6);
	assert.deepEqual(parts.spinner, "⠋");
	assert.deepEqual(parts.clock, "");
	assert.deepEqual(parts.counters, "");
	assert.deepEqual(parts.detail, "");
	assert.deepEqual(parts.label, "co…");
	assert.deepEqual(plain(parts), "⠋ co…");
	assert(widthOk(plain(parts), 6));
});

test("layout: columns = 10 drops clock+counters (MIN_TAIL forces last tier)", () => {
	// budget=9 · tier1 head=11 (skip) · tier2 head=6, room=2 (< MIN_TAIL, skip)
	// · tier3 head=1, room=7 (last tier accepts < MIN_TAIL)
	const parts = layout(FULL, 10);
	assert.deepEqual(parts.spinner, "⠋");
	assert.deepEqual(parts.clock, "");
	assert.deepEqual(parts.counters, "");
	assert.deepEqual(parts.label, "compil…");
	assert.deepEqual(parts.detail, "");
	assert.deepEqual(plain(parts), "⠋ compil…");
	assert(widthOk(plain(parts), 10));
});

test("layout: columns = 16 drops counters, truncates label", () => {
	// budget=15 · tier1 head=11, room=3 (< MIN_TAIL, skip)
	// · tier2 head=6, room=8 (== MIN_TAIL, accepts)
	const parts = layout(FULL, 16);
	assert.deepEqual(parts.spinner, "⠋");
	assert.deepEqual(parts.clock, "1:23");
	assert.deepEqual(parts.counters, "");
	assert.deepEqual(parts.label, "compile…");
	assert.deepEqual(parts.detail, "");
	assert.deepEqual(plain(parts), "⠋ 1:23 compile…");
	assert(widthOk(plain(parts), 16));
});

test("layout: columns = 24 keeps head, truncates label, drops detail", () => {
	// budget=23 · tier1 head=11, room=11 · label=19>11, detail-room=-9 → drop detail, truncate label to 11
	const parts = layout(FULL, 24);
	assert.deepEqual(parts.spinner, "⠋");
	assert.deepEqual(parts.clock, "1:23");
	assert.deepEqual(parts.counters, "3⚒");
	assert.deepEqual(parts.label, "compile re…");
	assert.deepEqual(parts.detail, "");
	assert.deepEqual(plain(parts), "⠋ 1:23 · 3⚒ compile re…");
	assert(widthOk(plain(parts), 24));
});

test("layout: columns = 40 keeps head+label, truncates detail", () => {
	// budget=39 · tier1 head=11, room=27 · label=19, detail-room=7 → truncate detail
	const parts = layout(FULL, 40);
	assert.deepEqual(parts.spinner, "⠋");
	assert.deepEqual(parts.clock, "1:23");
	assert.deepEqual(parts.counters, "3⚒");
	assert.deepEqual(parts.label, "compile really long");
	// truncateToWidth("src/very/long/path.ts", 7) fits 6 chars + ellipsis
	assert.deepEqual(parts.detail, "src/ve…");
	assert.deepEqual(plain(parts), "⠋ 1:23 · 3⚒ compile really long src/ve…");
	assert(widthOk(plain(parts), 40));
});

test("layout: columns = 80 fits everything", () => {
	const parts = layout(FULL, 80);
	assert.deepEqual(parts, {
		spinner: "⠋",
		clock: "1:23",
		counters: "3⚒",
		label: "compile really long",
		detail: "src/very/long/path.ts",
	});
	assert.deepEqual(
		plain(parts),
		"⠋ 1:23 · 3⚒ compile really long src/very/long/path.ts",
	);
	assert(widthOk(plain(parts), 80));
});

test("layout: columns = 200 fits everything (identical to width 80)", () => {
	assert.deepEqual(layout(FULL, 200), layout(FULL, 80));
});

test("layout: width budget property — every width in a broad sweep", () => {
	// The key invariant. If this ever fails, the terminal wraps and \r hits
	// the wrong row.
	for (const cols of [
		0, 1, 2, 3, 4, 5, 6, 8, 10, 15, 16, 20, 24, 30, 40, 60, 80, 120, 200,
	]) {
		const painted = plain(layout(FULL, cols));
		const w = displayWidth(painted);
		assert(
			w <= Math.max(0, cols - 1),
			`cols=${cols}: displayWidth(${JSON.stringify(painted)})=${w} > ${cols - 1}`,
		);
	}
});

test("layout: property — CJK+emoji input respects budget at every width", () => {
	const input: LayoutInput = {
		spinner: "⠋",
		clock: "12:34",
		counters: ["7⚒", "2⚠"],
		label: "编译 天地玄黃 😀",
		detail: "src/子/very/😀/path.ts",
	};
	for (let cols = 0; cols <= 60; cols++) {
		const painted = plain(layout(input, cols));
		const w = displayWidth(painted);
		assert(
			w <= Math.max(0, cols - 1),
			`cols=${cols}: displayWidth(${JSON.stringify(painted)})=${w} > ${cols - 1}`,
		);
	}
});

test("layout: no clock, no counters, no detail — just spinner and label", () => {
	const parts = layout({ spinner: "⠋", label: "hello" }, 80);
	assert.deepEqual(parts, {
		spinner: "⠋",
		clock: "",
		counters: "",
		label: "hello",
		detail: "",
	});
	assert.deepEqual(plain(parts), "⠋ hello");
});

test("layout: no label, no detail — head-only when it fits", () => {
	const parts = layout({ spinner: "⠋", clock: "0:05", counters: ["1⚒"] }, 80);
	assert.deepEqual(parts.spinner, "⠋");
	assert.deepEqual(parts.clock, "0:05");
	assert.deepEqual(parts.counters, "1⚒");
	assert.deepEqual(parts.label, "");
	assert.deepEqual(parts.detail, "");
	assert.deepEqual(plain(parts), "⠋ 0:05 · 1⚒");
});

test("layout: multiple counters render joined by a single space", () => {
	const parts = layout(
		{
			spinner: "⠋",
			clock: "0:05",
			counters: ["3⚒", "5⚠"],
			label: "x",
		},
		80,
	);
	assert.deepEqual(parts.counters, "3⚒ 5⚠");
	assert.deepEqual(plain(parts), "⠋ 0:05 · 3⚒ 5⚠ x");
});

test("layout: label present, detail absent — label may fill the tail", () => {
	const parts = layout(
		{
			spinner: "⠋",
			clock: "1:23",
			counters: ["3⚒"],
			label: "compile really long",
		},
		40,
	);
	// budget=39 · head=11 · room=27 · label=19 fits · no detail
	assert.deepEqual(parts.label, "compile really long");
	assert.deepEqual(parts.detail, "");
});

test("layout: detail present, label absent — detail is placed in the tail", () => {
	const parts = layout(
		{
			spinner: "⠋",
			clock: "1:23",
			detail: "hello",
		},
		40,
	);
	assert.deepEqual(parts.label, "");
	assert.deepEqual(parts.detail, "hello");
	assert.deepEqual(plain(parts), "⠋ 1:23 hello");
});

test("paint: colour disabled — output is plain joined parts", () => {
	// Already asserted throughout; this is the explicit contract check.
	const parts = layout(FULL, 80);
	const painted = paint(parts, false);
	assert.deepEqual(painted, "⠋ 1:23 · 3⚒ compile really long src/very/long/path.ts");
});

test("paint: colour enabled — emits ANSI escape codes", () => {
	const painted = paint(layout({ spinner: "⠋", label: "hi" }, 80), true);
	// Cyan + default-foreground for spinner, yellow + default-foreground for label.
	assert.equal(painted, "\x1b[36m⠋\x1b[39m \x1b[33mhi\x1b[39m");
});

test("paint: colour enabled — clock and counters share one dim span", () => {
	const painted = paint(layout(FULL, 80), true);
	assert(
		painted.includes("\x1b[2m1:23 · 3⚒\x1b[22m"),
		`expected a single dim span, got ${JSON.stringify(painted)}`,
	);
});

test("paint: all-empty parts returns empty string", () => {
	assert.deepEqual(plain(EMPTY_PARTS), "");
});

test("layout: spinner wider than budget returns all-empty", () => {
	// 😀 is 2 columns wide; budget = 1 (columns=2) fits, budget = 0 does not.
	const wide = { spinner: "😀", label: "x" };
	assert.deepEqual(layout(wide, 0), EMPTY_PARTS);
	assert.deepEqual(layout(wide, 1), EMPTY_PARTS);
	assert.deepEqual(layout(wide, 2), EMPTY_PARTS); // budget=1, spinner=2, does not fit
	const parts = layout(wide, 3); // budget=2, spinner fits
	assert.deepEqual(parts.spinner, "😀");
});
