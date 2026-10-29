#!/usr/bin/env -S node --conditions=@marianmeres/source
/**
 * The degradation ladder, made visible.
 *
 * Every tick is composed against a hard `columns - 1` budget (one column short
 * so a terminal that auto-wraps at the last cell does not push the line onto a
 * second row and turn the animation into a waterfall). When the content does
 * not fit, pieces come off in a fixed order:
 *
 *     truncate detail → drop detail → drop counters → drop clock → spinner only
 *
 * Colour is applied *after* truncation, so ANSI bytes never eat into the width.
 *
 * Width comes from `process.stdout.columns`, re-read on every tick — which is how a
 * resize is handled without a `SIGWINCH` listener, and also why setting
 * `COLUMNS=40` does nothing: that variable is a shell convention, not something
 * the terminal reports. To render at a chosen width, inject `columns()` through
 * the `io` seam, which is what this example does.
 *
 *     pnpm -s example examples/05-narrow-terminal.ts
 */

import { statusLine } from "@marianmeres/cli-status-line";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Render one frame at a fixed width by capturing what the runtime writes.
 *
 * `io` takes a *partial* seam — override only `write` and `columns`, and the
 * rest (`isTerminal`, `env`, `now`, `unrefTimer`, `onExit`) still defers to the
 * real platform. That is the same injection point the package's own tests use.
 */
async function frameAt(columns: number): Promise<string> {
	let last = "";

	const line = statusLine({
		enabled: true, // force animation even though we are capturing, not drawing
		intervalMs: 20,
		counters: [
			{ key: "files", glyph: "✎" },
			{ key: "warn", glyph: "!" },
		],
		io: {
			columns: () => columns,
			write: (s: string) => {
				// Frames arrive as "\r" + painted + "\x1b[K"; keep the middle.
				// biome-ignore lint/suspicious/noControlCharactersInRegex: matching the ESC is the point
				const eraseToEol = /\x1b\[K$/;
				if (s.startsWith("\r")) last = s.slice(1).replace(eraseToEol, "");
			},
		},
	});

	line.inc("files", 42);
	line.inc("warn", 3);
	line.set("type-checking", "src/routes/[projectId]/settings/+page.server.ts");

	await sleep(50); // let one tick land — drawing is tick-only by design
	line.stop({ clear: false });
	return last;
}

console.log("width │ frame");
console.log(`──────┼${"─".repeat(70)}`);

for (const w of [80, 60, 40, 30, 22, 16, 10, 6, 3, 1]) {
	const frame = await frameAt(w);
	console.log(`${String(w).padStart(5)} │ ${frame}`);
}

console.log(
	"\nNote each row stays within its own width budget, and that the pieces\n" +
		"disappear right-to-left rather than the line ever wrapping.",
);
