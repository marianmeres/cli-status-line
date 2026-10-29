#!/usr/bin/env -S node --conditions=@marianmeres/source
/**
 * `hideCursor`, and why signals are your job.
 *
 * A blinking block parked at the end of a spinning line is visual noise, so
 * `hideCursor: true` emits `\x1b[?25l` at construction and `\x1b[?25h` from
 * `stop()`. It also registers a process `exit` hook, which covers a normal exit
 * and `process.exit()`.
 *
 * What it deliberately does *not* cover is Ctrl-C. The library never calls
 * `process.on("SIGINT", …)` — registering a `SIGINT` listener *disables* the
 * default terminate-on-Ctrl-C behaviour, so a library that quietly added one
 * would make every host it is linked into unkillable from the keyboard. That is
 * not a trade a dependency gets to make for you.
 *
 * The consequence is the contract below: a signal-killed process never emits
 * `exit`, so if you hide the cursor you own restoring it on Ctrl-C. It is four
 * lines, and they belong in the host, where the rest of your shutdown already
 * lives.
 *
 *     pnpm -s example examples/07-hide-cursor-and-signals.ts
 *
 * Press Ctrl-C partway through and check that your cursor comes back; then run
 * it to completion and check the same.
 */

import process from "node:process";
import { statusLine } from "@marianmeres/cli-status-line";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const line = statusLine({
	hideCursor: true,
	counters: [{ key: "chunks", glyph: "▪" }],
});

// The host's signal handler — the whole of the contract. `stop()` is
// idempotent, so this is safe even if the run finished a millisecond earlier.
process.on("SIGINT", () => {
	line.stop({ text: "interrupted" });
	// Because we registered a listener, the default terminate is gone and
	// exiting is now ours to do too.
	process.exit(130);
});

console.log("uploading… (Ctrl-C to test the interrupt path)");

for (let i = 1; i <= 12; i++) {
	line.set("uploading", `chunk ${i}/12 · 4.0 MiB`);
	await sleep(400);
	line.inc("chunks");
}

// Normal exit: `stop()` restores the cursor, and the `exit` hook it
// unregisters here would have caught it anyway if we had forgotten.
line.stop({ text: "uploaded 48 MiB" });
