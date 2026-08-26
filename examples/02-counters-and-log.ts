#!/usr/bin/env -S deno run
/**
 * Counters and out-of-band output.
 *
 * Counters are declared up front rather than passed per update, which is what
 * keeps the width math stable: the head never changes shape frame to frame, so
 * the line does not jitter as numbers grow. `inc()` on a key you did not
 * declare is a silent no-op — the library never throws into its host, and that
 * rule outranks typo detection.
 *
 * `log()` is the other half: it erases the current frame, writes your line, and
 * lets the next tick redraw underneath it. Without it, a bare `console.log`
 * during an animation collides with the frame mid-write.
 *
 *     deno run examples/02-counters-and-log.ts
 */

import { ASCII_FRAMES, statusLine } from "@marianmeres/cli-status-line";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const line = statusLine({
	counters: [
		// Glyphs must be text-presentation and one column wide. "⚒️" (with the
		// U+FE0F variation selector) measures 1 but renders 2 in most
		// terminals, which overflows the line by a column — use "⚒".
		{ key: "files", glyph: "✎" },
		{ key: "warnings", glyph: "!" },
	],
	// Swap the braille default for ASCII when the target terminal's font may
	// not carry the U+28xx block (some CI consoles, some Windows fonts).
	frames: ASCII_FRAMES,
});

const files = ["mod.ts", "io.ts", "width.ts", "layout.ts", "status-line.ts"];

for (const f of files) {
	line.set("linting", f);
	await sleep(600);
	line.inc("files");

	if (f === "width.ts") {
		line.inc("warnings", 5);
		// Real output belongs above the line, not in it.
		line.log(`  ${f}: 5x no-control-regex (intentional, suppressed)`);
	}

	// Undeclared key — nothing happens, nothing throws.
	line.inc("typo-here");
}

line.stop({ text: `linted ${files.length} files` });
