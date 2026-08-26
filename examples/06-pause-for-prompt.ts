#!/usr/bin/env -S deno run
/**
 * Asking the user something mid-run.
 *
 * `prompt()` and `confirm()` block the event loop, which means the redraw timer
 * cannot fire while they are waiting — so it cannot clean up after itself
 * either. Whatever frame was on screen when the prompt opened stays there,
 * and the user types over it.
 *
 * `pause()` is synchronous for exactly this reason: it erases the frame right
 * now, on the calling thread, before you block. `resume()` puts the animation
 * back; the next tick redraws. Both are idempotent, so a `try/finally` around
 * the blocking call is the safe shape.
 *
 *     deno run examples/06-pause-for-prompt.ts
 *
 * (Needs a tty for the prompt itself; under a pipe it takes the default.)
 */

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

// The blocking question. Pause first, resume in `finally` so an exception on
// the way out cannot leave the animation suspended forever.
let proceed = true;
line.pause();
try {
	proceed = Deno.stdin.isTerminal()
		? confirm("004 drops `legacy_events` (1.2M rows). Continue?")
		: true;
} finally {
	line.resume();
}

if (!proceed) {
	line.stop({ text: "aborted at 004 — nothing was dropped" });
	Deno.exit(1);
}

line.set("migrating", "004_drop_legacy_table");
await sleep(800);
line.inc("migrations");
line.stop({ text: `4 migrations in ${(line.elapsedMs / 1000).toFixed(1)}s` });
