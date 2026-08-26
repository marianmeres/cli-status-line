#!/usr/bin/env -S deno run
/**
 * The smallest useful status line: a spinner, a clock, and a label that changes
 * as the work moves along.
 *
 * The point of the whole package is in the last two lines of the loop — the
 * transcript above the line stays free for things that actually happened, and
 * the one line at the bottom answers "is it still alive?" without adding a
 * hundred lines of noise to it.
 *
 *     deno run examples/01-basic.ts
 */

import { statusLine } from "@marianmeres/cli-status-line";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const steps = [
	["resolving", "3 direct dependencies"],
	["downloading", "@std/cli@1.0.32"],
	["downloading", "@std/fmt@1.0.10"],
	["type-checking", "src/mod.ts"],
	["bundling", "dist/app.js"],
];

// No options at all: braille spinner, m:ss clock, animated iff stdout is a tty.
const line = statusLine();

for (const [label, detail] of steps) {
	line.set(label, detail);
	await sleep(700);
}

// `text` lands on its own line after the frame is erased, so it survives in the
// scrollback while the animation does not.
line.stop({ text: `built in ${(line.elapsedMs / 1000).toFixed(1)}s` });
