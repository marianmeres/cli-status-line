#!/usr/bin/env -S node --conditions=@marianmeres/source
/**
 * What happens when nobody is watching.
 *
 * `\r` means nothing to a file, and a spinner written to one is ten frames a
 * second of garbage. So when stdout is not a tty — or `TERM=dumb`, or `CI` is
 * set to anything other than `""` / `"0"` / `"false"` — `statusLine()` skips
 * the redraw loop entirely and emits at most one plain line per *notable*
 * update instead.
 *
 * Notability is the caller's call, and it is the whole knob: a status line
 * updates ten times a second, a log wants five lines total. Mark the state
 * changes a reader of the log file would care about, leave the rest alone.
 *
 * Run it both ways to see the two paths from the same code:
 *
 *     pnpm -s example examples/03-non-tty-fallback.ts         # animated on a tty
 *     pnpm -s example examples/03-non-tty-fallback.ts | cat   # one line per notable set()
 *
 * This script also forces the fallback path explicitly at the end so you can
 * see it without a pipe.
 */

import { statusLine } from "@marianmeres/cli-status-line";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run(label: string, enabled: boolean | undefined) {
	console.log(`\n--- ${label} ---`);

	const line = statusLine({
		enabled, // `undefined` = auto-detect; `false` = force the fallback path.
		counters: [{ key: "tests", glyph: "✓" }],
	});

	for (let i = 1; i <= 4; i++) {
		// Chatty progress: worth animating, not worth a line in a log file.
		line.set("running", `case ${i} of 4`);
		await sleep(250);
		line.set("running", `case ${i} of 4 — asserting`);
		await sleep(250);
		line.inc("tests");

		// The one update per iteration a log reader actually wants.
		line.set("passed", `case ${i}`, { notable: true });
		await sleep(100);
	}

	line.stop({ text: "4 passed, 0 failed" });
}

// Auto-detected: animated under a tty, notable-lines-only under a pipe.
await run("auto-detected (enabled: undefined)", undefined);

// Forced off: the fallback path even on a tty. Useful for `--quiet`-style flags
// and for reproducing CI output locally.
await run("forced fallback (enabled: false)", false);
