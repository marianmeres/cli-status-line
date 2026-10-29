#!/usr/bin/env -S node --conditions=@marianmeres/source
/**
 * Asking the user something mid-run.
 *
 * A `readline` question does not block the event loop, so the redraw timer keeps
 * firing while the user types — and every tick would `\r`-overwrite the prompt
 * line with a fresh frame.
 *
 * `pause()` is the fix: it erases the frame right now, synchronously, before the
 * prompt is printed, and suspends redraws until `resume()`; the next tick after
 * that redraws. Both are idempotent, so a `try/finally` around the question is
 * the safe shape.
 *
 *     pnpm -s example examples/06-pause-for-prompt.ts
 *
 * (Needs a tty for the prompt itself; under a pipe it takes the default.)
 */

import process from "node:process";
import { createInterface } from "node:readline/promises";
import { statusLine } from "@marianmeres/cli-status-line";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const line = statusLine({ counters: [{ key: "migrations", glyph: "▸" }] });

for (const m of ["001_init", "002_users", "003_sessions"]) {
	line.set("migrating", m);
	await sleep(600);
	line.inc("migrations");
}

line.set("migrating", "004_drop_legacy_table");
await sleep(600);

// The question. Pause first, resume in `finally` so an exception on the way out
// cannot leave the animation suspended forever.
let proceed = true;
line.pause();
try {
	if (process.stdin.isTTY) {
		const rl = createInterface({ input: process.stdin, output: process.stdout });
		try {
			const answer = await rl.question(
				"004 drops `legacy_events` (1.2M rows). Continue? [y/N] ",
			);
			proceed = /^y(es)?$/i.test(answer.trim());
		} finally {
			rl.close();
		}
	}
} finally {
	line.resume();
}

if (!proceed) {
	line.stop({ text: "aborted at 004 — nothing was dropped" });
	process.exit(1);
}

line.set("migrating", "004_drop_legacy_table");
await sleep(800);
line.inc("migrations");
line.stop({ text: `4 migrations in ${(line.elapsedMs / 1000).toFixed(1)}s` });
