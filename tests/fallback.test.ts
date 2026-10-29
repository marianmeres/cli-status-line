import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { mock, test } from "node:test";
import { makeFakeIo } from "./_fake-io.ts";
import {
	FALLBACK_LINE_MAX,
	type FallbackPolicy,
	isAnimated,
	isCi,
	renderNotable,
	resolveFallback,
	type StatusSnapshot,
} from "../src/fallback.ts";
import { statusLine } from "../src/status-line.ts";
import { displayWidth } from "../src/width.ts";

function withFakeTime(fn: (time: typeof mock.timers) => void): void {
	mock.timers.enable({ apis: ["setInterval", "Date"], now: 0 });
	try {
		fn(mock.timers);
	} finally {
		mock.timers.reset();
	}
}

// ---------- isAnimated / isCi ----------

test("isAnimated: explicit true wins over a non-tty", () => {
	const io = makeFakeIo({ isTerminal: false });
	assert.equal(isAnimated(io, true), true);
});

test("isAnimated: explicit false wins over a tty", () => {
	const io = makeFakeIo({ isTerminal: true });
	assert.equal(isAnimated(io, false), false);
});

test("isAnimated: undefined + tty + no CI + TERM=xterm → true", () => {
	const io = makeFakeIo({ isTerminal: true, env: { TERM: "xterm-256color" } });
	assert.equal(isAnimated(io, undefined), true);
});

test("isAnimated: undefined + non-tty → false", () => {
	const io = makeFakeIo({ isTerminal: false });
	assert.equal(isAnimated(io, undefined), false);
});

test("isAnimated: undefined + TERM=dumb → false", () => {
	const io = makeFakeIo({ isTerminal: true, env: { TERM: "dumb" } });
	assert.equal(isAnimated(io, undefined), false);
});

test("isAnimated: undefined + CI=1 → false", () => {
	const io = makeFakeIo({ isTerminal: true, env: { CI: "1" } });
	assert.equal(isAnimated(io, undefined), false);
});

test('isCi: "", "0", "false" do not count as CI (D9)', () => {
	for (const v of ["", "0", "false"]) {
		const io = makeFakeIo({ env: { CI: v } });
		assert.equal(isCi(io), false, `CI=${JSON.stringify(v)}`);
	}
});

test("isCi: any other value counts as CI", () => {
	for (const v of ["1", "true", "yes", "gitlab"]) {
		const io = makeFakeIo({ env: { CI: v } });
		assert.equal(isCi(io), true, `CI=${JSON.stringify(v)}`);
	}
});

test("isCi: unset → false", () => {
	const io = makeFakeIo({ env: {} });
	assert.equal(isCi(io), false);
});

// ---------- resolveFallback / renderNotable ----------

test('resolveFallback("silent") returns null for every snapshot', () => {
	const fn = resolveFallback("silent");
	const snap: StatusSnapshot = {
		elapsedMs: 0,
		clock: "0:00",
		label: "x",
		detail: "y",
		counters: {},
		notable: true,
	};
	assert.equal(fn(snap), null);
});

test('resolveFallback("notable") gates on snap.notable', () => {
	const fn = resolveFallback("notable");
	const base = {
		elapsedMs: 0,
		clock: "0:00",
		label: "hello",
		detail: "world",
		counters: {} as Readonly<Record<string, number>>,
	};
	assert.equal(fn({ ...base, notable: false }), null);
	assert.deepEqual(fn({ ...base, notable: true }), "⋯ 0:00 hello world");
});

test("resolveFallback(undefined) defaults to the notable policy", () => {
	const fn = resolveFallback(undefined);
	const snap: StatusSnapshot = {
		elapsedMs: 0,
		clock: "",
		label: "l",
		detail: "",
		counters: {},
		notable: true,
	};
	assert.deepEqual(fn(snap), "⋯ l");
});

test("resolveFallback(fn) returns the function as-is", () => {
	const marker = { calls: 0 };
	const custom: FallbackPolicy = (s) => {
		marker.calls++;
		return `${s.notable ? "!" : "."} ${s.label}`;
	};
	const fn = resolveFallback(custom);
	assert.deepEqual(
		fn({
			elapsedMs: 0,
			clock: "",
			label: "hi",
			detail: "",
			counters: {},
			notable: true,
		}),
		"! hi",
	);
	assert.equal(marker.calls, 1);
});

test("renderNotable: joins non-empty pieces with a single space (no double when clock empty)", () => {
	assert.deepEqual(
		renderNotable({
			elapsedMs: 0,
			clock: "",
			label: "label",
			detail: "detail",
			counters: {},
			notable: true,
		}),
		"⋯ label detail",
	);
});

test("renderNotable: truncates to FALLBACK_LINE_MAX columns via truncateToWidth", () => {
	const detail = "x".repeat(500);
	const line = renderNotable({
		elapsedMs: 0,
		clock: "0:00",
		label: "label",
		detail,
		counters: {},
		notable: true,
	});
	assert(
		displayWidth(line) <= FALLBACK_LINE_MAX,
		`line width ${displayWidth(line)} exceeded ${FALLBACK_LINE_MAX}`,
	);
	assert(line.endsWith("…"), `expected ellipsis: ${JSON.stringify(line)}`);
});

// ---------- statusLine() fallback integration ----------

test("(a) non-tty + default policy: one line per notable set(), none for non-notable, duplicates suppressed", () => {
	withFakeTime(() => {
		const io = makeFakeIo({ isTerminal: false, now: () => Date.now() });
		const sl = statusLine({ io, clock: false });
		try {
			sl.set("first", "d1"); // non-notable → nothing
			sl.set("second", "d2"); // non-notable → nothing
			assert.deepEqual(io.writes, []);

			sl.set("hello", "world", { notable: true });
			assert.deepEqual(io.writes, ["⋯ hello world\n"]);

			// A duplicate notable line is suppressed.
			sl.set("hello", "world", { notable: true });
			assert.deepEqual(io.writes.length, 1);

			// A different notable line is emitted.
			sl.set("done", "bye", { notable: true });
			assert.deepEqual(io.writes, ["⋯ hello world\n", "⋯ done bye\n"]);
		} finally {
			sl.stop();
		}
	});
});

test("(a cont'd) 500-column detail is bounded to FALLBACK_LINE_MAX columns", () => {
	withFakeTime(() => {
		const io = makeFakeIo({ isTerminal: false, now: () => Date.now() });
		const sl = statusLine({ io, clock: false });
		try {
			sl.set("l", "x".repeat(500), { notable: true });
			assert.deepEqual(io.writes.length, 1);
			const line = io.writes[0] ?? "";
			assert(line.endsWith("\n"));
			assert(
				displayWidth(line.slice(0, -1)) <= FALLBACK_LINE_MAX,
				`line width ${displayWidth(line.slice(0, -1))} > ${FALLBACK_LINE_MAX}`,
			);
		} finally {
			sl.stop();
		}
	});
});

test('(b) "silent" policy writes zero bytes', () => {
	withFakeTime(() => {
		const io = makeFakeIo({ isTerminal: false, now: () => Date.now() });
		const sl = statusLine({ io, fallback: "silent" });
		try {
			sl.set("a", "b", { notable: true });
			sl.set("c", "d", { notable: true });
			sl.set("e", "f"); // non-notable
			assert.deepEqual(io.writes, []);
		} finally {
			sl.stop();
		}
	});
});

test("(c) custom function receives a full snapshot; null skips", () => {
	withFakeTime((time) => {
		const seen: StatusSnapshot[] = [];
		const io = makeFakeIo({
			isTerminal: false,
			now: () => Date.now(),
		});
		const sl = statusLine({
			io,
			counters: [{ key: "n", glyph: "⚒" }],
			fallback: (s) => {
				seen.push(s);
				return s.notable ? `X ${s.clock} ${s.label}#${s.counters.n ?? 0}` : null;
			},
		});
		try {
			sl.inc("n", 3);
			sl.set("first", "d", { notable: false });
			assert.deepEqual(io.writes, []); // null → nothing

			time.tick(2000);
			sl.set("second", "d", { notable: true });
			assert.deepEqual(io.writes, ["X 0:02 second#3\n"]);

			// The custom function saw every set(), notable or not, with the
			// full snapshot shape.
			assert.equal(seen.length, 2);
			assert.equal(seen[0]?.notable, false);
			assert.equal(seen[0]?.label, "first");
			assert.equal(seen[0]?.counters.n, 3);
			assert.equal(seen[0]?.elapsedMs, 0);
			assert.equal(seen[0]?.clock, "0:00");
			assert.equal(seen[1]?.notable, true);
			assert.equal(seen[1]?.label, "second");
			assert.equal(seen[1]?.elapsedMs, 2000);
			assert.equal(seen[1]?.clock, "0:02");
		} finally {
			sl.stop();
		}
	});
});

test("(d) TERM=dumb on a fake tty → fallback path", () => {
	withFakeTime(() => {
		const io = makeFakeIo({
			isTerminal: true,
			env: { TERM: "dumb" },
			now: () => Date.now(),
		});
		const sl = statusLine({ io, clock: false });
		try {
			// No initial draw — non-animated.
			assert.deepEqual(io.writes.length, 0);
			assert.deepEqual(io.unrefCalls.length, 0);
			sl.set("hi", "there", { notable: true });
			assert.deepEqual(io.writes, ["⋯ hi there\n"]);
		} finally {
			sl.stop();
		}
	});
});

test("(d cont'd) CI=1 on a fake tty → fallback path", () => {
	withFakeTime(() => {
		const io = makeFakeIo({
			isTerminal: true,
			env: { CI: "1" },
			now: () => Date.now(),
		});
		const sl = statusLine({ io, clock: false });
		try {
			assert.deepEqual(io.writes.length, 0);
			sl.set("hi", undefined, { notable: true });
			assert.deepEqual(io.writes, ["⋯ hi\n"]);
		} finally {
			sl.stop();
		}
	});
});

test("(e) enabled: true on a fake non-tty → animated bytes", () => {
	withFakeTime(() => {
		const io = makeFakeIo({ isTerminal: false, now: () => Date.now() });
		const sl = statusLine({ io, clock: false, enabled: true, frames: ["A"] });
		try {
			// Initial draw fires despite the non-tty.
			assert.deepEqual(io.writes[0], "\rA\x1b[K");
			assert.deepEqual(io.unrefCalls.length, 1);
		} finally {
			sl.stop();
		}
	});
});

test("inc() never emits in the fallback path", () => {
	withFakeTime(() => {
		const io = makeFakeIo({ isTerminal: false, now: () => Date.now() });
		const sl = statusLine({
			io,
			counters: [{ key: "n", glyph: "⚒" }],
		});
		try {
			sl.inc("n", 5);
			sl.inc("n");
			assert.deepEqual(io.writes, []);
		} finally {
			sl.stop();
		}
	});
});

test("stop() without text in fallback path writes nothing", () => {
	withFakeTime(() => {
		const io = makeFakeIo({ isTerminal: false, now: () => Date.now() });
		const sl = statusLine({ io });
		sl.stop();
		assert.deepEqual(io.writes, []);
	});
});

test("stop({ text }) in fallback path writes text + \\n", () => {
	withFakeTime(() => {
		const io = makeFakeIo({ isTerminal: false, now: () => Date.now() });
		const sl = statusLine({ io });
		sl.stop({ text: "done in 3:12" });
		assert.deepEqual(io.writes, ["done in 3:12\n"]);
	});
});

test("log() in fallback path writes plain msg + \\n (no erase)", () => {
	withFakeTime(() => {
		const io = makeFakeIo({ isTerminal: false, now: () => Date.now() });
		const sl = statusLine({ io });
		try {
			sl.log("plain", "text");
			assert.deepEqual(io.writes, ["plain text\n"]);
		} finally {
			sl.stop();
		}
	});
});

test("no console.* anywhere in src/ (D5)", () => {
	const dir = new URL("../src/", import.meta.url);
	for (const name of readdirSync(dir)) {
		if (!name.endsWith(".ts")) continue;
		const source = readFileSync(new URL(name, dir), "utf8");
		assert(!/\bconsole\./.test(source), `src/${name} mentions console.*`);
	}
});
