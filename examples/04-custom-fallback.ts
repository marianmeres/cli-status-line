#!/usr/bin/env -S node --conditions=@marianmeres/source
/**
 * Owning the non-animated format.
 *
 * The built-in `"notable"` policy writes `⋯ <clock> <label> <detail>`, which is
 * deliberately shapeless — a library cannot guess what a given tool's log file
 * should look like. When it matters, pass a function instead: it receives a
 * snapshot of the state at that `set()` and returns the exact line to write, or
 * `null` to write nothing.
 *
 * Note what the function is *not* given: a way to draw. It returns a string;
 * the runtime writes it through the same `io.write` the animated path uses, so
 * ordering with the rest of your output is preserved. Consecutive identical
 * lines are suppressed for you, whatever policy produced them.
 *
 * `"silent"` is the third option, for when the non-tty case should produce
 * nothing at all.
 *
 *     pnpm -s example examples/04-custom-fallback.ts | cat
 */

import {
	type FallbackPolicy,
	type StatusSnapshot,
	statusLine,
} from "@marianmeres/cli-status-line";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * An indented, counter-carrying form — the shape a driver that owns the rest of
 * the transcript wants, so its status lines sit visually under its own output.
 *
 * Returning `null` for anything not flagged notable is what keeps a 10-per-
 * second update rate from becoming a 10-per-second log file. The policy decides
 * that, not the runtime: a policy that ignores `snap.notable` gets every single
 * `set()`, which is occasionally what you want (a machine-readable event
 * stream, say).
 */
const indented: FallbackPolicy = (snap: StatusSnapshot): string | null => {
	if (!snap.notable) return null;
	const counts = Object.entries(snap.counters)
		.map(([k, v]) => `${k}=${v}`)
		.join(" ");
	const bits = [`   ${snap.clock}`, snap.label, snap.detail, counts].filter(Boolean);
	return bits.join(" · ");
};

/** Everything, as NDJSON — for a log a machine reads. */
const asJson: FallbackPolicy = (snap: StatusSnapshot): string | null =>
	JSON.stringify({
		ms: snap.elapsedMs,
		label: snap.label,
		detail: snap.detail,
		counters: snap.counters,
		notable: snap.notable,
	});

async function run(title: string, fallback: FallbackPolicy) {
	console.log(`\n--- ${title} ---`);
	const line = statusLine({
		enabled: false, // force the fallback path so the example is reproducible
		fallback,
		counters: [{ key: "steps", glyph: "⚒" }],
	});

	for (const [label, detail, notable] of [
		["fetching", "index.json", false],
		["fetching", "index.json (304)", true],
		["applying", "12 changes", true],
		["applying", "12 changes", true], // identical line → suppressed
		["done", "", true],
	] as const) {
		line.inc("steps");
		line.set(label, detail, { notable });
		await sleep(120);
	}
	line.stop();
}

await run("custom function — indented, with counters", indented);
await run("custom function — NDJSON, every update", asJson);
await run('"silent" — nothing is written at all', "silent");
console.log("(the silent run above wrote zero lines, by design)");
