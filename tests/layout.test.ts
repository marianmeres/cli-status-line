import { assert, assertEquals } from "@std/assert";
import { setColorEnabled } from "@std/fmt/colors";
import { layout, type LayoutInput, paint } from "../src/layout.ts";
import { displayWidth } from "../src/width.ts";

// Colour off for byte-exact golden comparisons. The layout module never
// reads this global; only `paint()` does, and `@std/fmt/colors` respects it.
setColorEnabled(false);

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

Deno.test("layout: columns = 0 returns all-empty parts", () => {
	assertEquals(layout(FULL, 0), EMPTY_PARTS);
});

Deno.test("layout: columns = 1 returns all-empty parts (last column left blank)", () => {
	assertEquals(layout(FULL, 1), EMPTY_PARTS);
	assertEquals(paint(layout(FULL, 1)), "");
});

Deno.test("layout: columns = 2 shows spinner alone", () => {
	const parts = layout(FULL, 2);
	assertEquals(parts, { ...EMPTY_PARTS, spinner: "⠋" });
	assertEquals(paint(parts), "⠋");
	assert(widthOk(paint(parts), 2));
});

Deno.test("layout: columns = 3 falls back to spinner alone (no room for tail)", () => {
	// tier1 head=11 > 2 · tier2 head=6 > 2 · tier3 head=1, room=0 → spinner only
	const parts = layout(FULL, 3);
	assertEquals(parts, { ...EMPTY_PARTS, spinner: "⠋" });
	assert(widthOk(paint(parts), 3));
});

Deno.test("layout: columns = 6 drops clock+counters, truncates label", () => {
	// budget=5 · tier1 head=11 · tier2 head=6 · tier3 head=1, room=3 (last tier)
	const parts = layout(FULL, 6);
	assertEquals(parts.spinner, "⠋");
	assertEquals(parts.clock, "");
	assertEquals(parts.counters, "");
	assertEquals(parts.detail, "");
	assertEquals(parts.label, "co…");
	assertEquals(paint(parts), "⠋ co…");
	assert(widthOk(paint(parts), 6));
});

Deno.test("layout: columns = 10 drops clock+counters (MIN_TAIL forces last tier)", () => {
	// budget=9 · tier1 head=11 (skip) · tier2 head=6, room=2 (< MIN_TAIL, skip)
	// · tier3 head=1, room=7 (last tier accepts < MIN_TAIL)
	const parts = layout(FULL, 10);
	assertEquals(parts.spinner, "⠋");
	assertEquals(parts.clock, "");
	assertEquals(parts.counters, "");
	assertEquals(parts.label, "compil…");
	assertEquals(parts.detail, "");
	assertEquals(paint(parts), "⠋ compil…");
	assert(widthOk(paint(parts), 10));
});

Deno.test("layout: columns = 16 drops counters, truncates label", () => {
	// budget=15 · tier1 head=11, room=3 (< MIN_TAIL, skip)
	// · tier2 head=6, room=8 (== MIN_TAIL, accepts)
	const parts = layout(FULL, 16);
	assertEquals(parts.spinner, "⠋");
	assertEquals(parts.clock, "1:23");
	assertEquals(parts.counters, "");
	assertEquals(parts.label, "compile…");
	assertEquals(parts.detail, "");
	assertEquals(paint(parts), "⠋ 1:23 compile…");
	assert(widthOk(paint(parts), 16));
});

Deno.test("layout: columns = 24 keeps head, truncates label, drops detail", () => {
	// budget=23 · tier1 head=11, room=11 · label=19>11, detail-room=-9 → drop detail, truncate label to 11
	const parts = layout(FULL, 24);
	assertEquals(parts.spinner, "⠋");
	assertEquals(parts.clock, "1:23");
	assertEquals(parts.counters, "3⚒");
	assertEquals(parts.label, "compile re…");
	assertEquals(parts.detail, "");
	assertEquals(paint(parts), "⠋ 1:23 · 3⚒ compile re…");
	assert(widthOk(paint(parts), 24));
});

Deno.test("layout: columns = 40 keeps head+label, truncates detail", () => {
	// budget=39 · tier1 head=11, room=27 · label=19, detail-room=7 → truncate detail
	const parts = layout(FULL, 40);
	assertEquals(parts.spinner, "⠋");
	assertEquals(parts.clock, "1:23");
	assertEquals(parts.counters, "3⚒");
	assertEquals(parts.label, "compile really long");
	// truncateToWidth("src/very/long/path.ts", 7) fits 6 chars + ellipsis
	assertEquals(parts.detail, "src/ve…");
	assertEquals(paint(parts), "⠋ 1:23 · 3⚒ compile really long src/ve…");
	assert(widthOk(paint(parts), 40));
});

Deno.test("layout: columns = 80 fits everything", () => {
	const parts = layout(FULL, 80);
	assertEquals(parts, {
		spinner: "⠋",
		clock: "1:23",
		counters: "3⚒",
		label: "compile really long",
		detail: "src/very/long/path.ts",
	});
	assertEquals(paint(parts), "⠋ 1:23 · 3⚒ compile really long src/very/long/path.ts");
	assert(widthOk(paint(parts), 80));
});

Deno.test("layout: columns = 200 fits everything (identical to width 80)", () => {
	assertEquals(layout(FULL, 200), layout(FULL, 80));
});

Deno.test("layout: width budget property — every width in a broad sweep", () => {
	// The key invariant. If this ever fails, the terminal wraps and \r hits
	// the wrong row.
	for (
		const cols of [
			0,
			1,
			2,
			3,
			4,
			5,
			6,
			8,
			10,
			15,
			16,
			20,
			24,
			30,
			40,
			60,
			80,
			120,
			200,
		]
	) {
		const painted = paint(layout(FULL, cols));
		const w = displayWidth(painted);
		assert(
			w <= Math.max(0, cols - 1),
			`cols=${cols}: displayWidth(${JSON.stringify(painted)})=${w} > ${cols - 1}`,
		);
	}
});

Deno.test("layout: property — CJK+emoji input respects budget at every width", () => {
	const input: LayoutInput = {
		spinner: "⠋",
		clock: "12:34",
		counters: ["7⚒", "2⚠"],
		label: "编译 天地玄黃 😀",
		detail: "src/子/very/😀/path.ts",
	};
	for (let cols = 0; cols <= 60; cols++) {
		const painted = paint(layout(input, cols));
		const w = displayWidth(painted);
		assert(
			w <= Math.max(0, cols - 1),
			`cols=${cols}: displayWidth(${JSON.stringify(painted)})=${w} > ${cols - 1}`,
		);
	}
});

Deno.test("layout: no clock, no counters, no detail — just spinner and label", () => {
	const parts = layout({ spinner: "⠋", label: "hello" }, 80);
	assertEquals(parts, {
		spinner: "⠋",
		clock: "",
		counters: "",
		label: "hello",
		detail: "",
	});
	assertEquals(paint(parts), "⠋ hello");
});

Deno.test("layout: no label, no detail — head-only when it fits", () => {
	const parts = layout({ spinner: "⠋", clock: "0:05", counters: ["1⚒"] }, 80);
	assertEquals(parts.spinner, "⠋");
	assertEquals(parts.clock, "0:05");
	assertEquals(parts.counters, "1⚒");
	assertEquals(parts.label, "");
	assertEquals(parts.detail, "");
	assertEquals(paint(parts), "⠋ 0:05 · 1⚒");
});

Deno.test("layout: multiple counters render joined by a single space", () => {
	const parts = layout({
		spinner: "⠋",
		clock: "0:05",
		counters: ["3⚒", "5⚠"],
		label: "x",
	}, 80);
	assertEquals(parts.counters, "3⚒ 5⚠");
	assertEquals(paint(parts), "⠋ 0:05 · 3⚒ 5⚠ x");
});

Deno.test("layout: label present, detail absent — label may fill the tail", () => {
	const parts = layout({
		spinner: "⠋",
		clock: "1:23",
		counters: ["3⚒"],
		label: "compile really long",
	}, 40);
	// budget=39 · head=11 · room=27 · label=19 fits · no detail
	assertEquals(parts.label, "compile really long");
	assertEquals(parts.detail, "");
});

Deno.test("layout: detail present, label absent — detail is placed in the tail", () => {
	const parts = layout({
		spinner: "⠋",
		clock: "1:23",
		detail: "hello",
	}, 40);
	assertEquals(parts.label, "");
	assertEquals(parts.detail, "hello");
	assertEquals(paint(parts), "⠋ 1:23 hello");
});

Deno.test("paint: colour disabled — output is plain joined parts", () => {
	// Already asserted throughout; this is the explicit contract check.
	const parts = layout(FULL, 80);
	const painted = paint(parts);
	assertEquals(painted, "⠋ 1:23 · 3⚒ compile really long src/very/long/path.ts");
});

Deno.test("paint: colour enabled — emits ANSI escape codes", () => {
	setColorEnabled(true);
	try {
		const painted = paint(layout({ spinner: "⠋", label: "hi" }, 80));
		// Cyan + reset for spinner, yellow + reset for label.
		assert(
			painted.includes("\x1b["),
			`expected escape codes, got ${JSON.stringify(painted)}`,
		);
		assert(painted.includes("⠋"));
		assert(painted.includes("hi"));
	} finally {
		setColorEnabled(false);
	}
});

Deno.test("paint: all-empty parts returns empty string", () => {
	assertEquals(paint(EMPTY_PARTS), "");
});

Deno.test("layout: spinner wider than budget returns all-empty", () => {
	// 😀 is 2 columns wide; budget = 1 (columns=2) fits, budget = 0 does not.
	const wide = { spinner: "😀", label: "x" };
	assertEquals(layout(wide, 0), EMPTY_PARTS);
	assertEquals(layout(wide, 1), EMPTY_PARTS);
	assertEquals(layout(wide, 2), EMPTY_PARTS); // budget=1, spinner=2, does not fit
	const parts = layout(wide, 3); // budget=2, spinner fits
	assertEquals(parts.spinner, "😀");
});
