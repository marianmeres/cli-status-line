#!/usr/bin/env -S deno run
/**
 * Manual eyeball check for `statusLine()`. Runs a fake workload for ~6 s with
 * a mid-run `log()`, a `pause()` / `resume()`, and a final `stop({ text })`.
 *
 * Run it two ways to see both code paths:
 *
 *     deno run scripts/demo.ts           # animated on a tty
 *     deno run scripts/demo.ts | cat     # non-tty → notable lines only
 *
 * Width comes from `Deno.consoleSize()`, so `COLUMNS=40` does nothing here —
 * resize the window to watch the degradation ladder, or run
 * `examples/05-narrow-terminal.ts`, which renders at chosen widths by injecting
 * `columns()` through the `io` seam.
 */

import { statusLine } from "../src/mod.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const line = statusLine({
	counters: [{ key: "tools", glyph: "⚒" }],
	hideCursor: true,
});

line.set("starting", "warming up caches");
await sleep(800);

for (let i = 0; i < 6; i++) {
	line.inc("tools");
	line.set(`step ${i + 1}`, `processing item ${i * 17}`, { notable: true });
	await sleep(500);
	if (i === 2) line.log("halfway there — this line goes above the status line");
	if (i === 3) {
		line.pause();
		await sleep(700);
		line.resume();
	}
}

line.set("finalising", "writing outputs");
await sleep(600);
line.stop({ text: `done in ${(line.elapsedMs / 1000).toFixed(1)}s` });
