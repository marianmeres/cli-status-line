/**
 * Child-process fixture for `lifecycle.test.ts`. Runs the real platform `Io` (no fake)
 * in a process of its own, so the suite can observe what only a real process shows:
 * whether it exits on its own, what reaches stdout at exit, and how the library's writes
 * order against the host's own `console` output. Not a suite: `pnpm test` only runs
 * `*.test.ts`.
 */

import process from "node:process";
import { statusLine } from "../src/mod.ts";

const mode = process.argv[2];

if (mode === "never-stopped") {
	// Never stopped. The ref'd timeout keeps the process up long enough for a few
	// ticks; after it fires, only the (unref'd) interval is left, which must not keep
	// the process alive. The `exit` hook must still put the cursor back.
	const line = statusLine({
		enabled: true,
		hideCursor: true,
		intervalMs: 10,
		clock: false,
		frames: ["A"],
	});
	line.set("working");
	setTimeout(() => {}, 100);
} else if (mode === "process-exit") {
	const line = statusLine({
		enabled: true,
		hideCursor: true,
		clock: false,
		frames: ["A"],
	});
	line.set("working");
	process.exit(3);
} else if (mode === "ordering") {
	// stdout is a pipe here, so this is the fallback path.
	const line = statusLine({ clock: false });
	line.log("one");
	console.log("two");
	line.set("three", "", { notable: true });
	console.log("four");
	line.stop({ text: "five" });
} else {
	process.stderr.write(`unknown mode: ${mode}\n`);
	process.exit(2);
}
