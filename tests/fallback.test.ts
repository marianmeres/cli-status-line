import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { setColorEnabled } from "@std/fmt/colors";
import { FakeTime } from "@std/testing/time";
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

// Byte-exact goldens require deterministic colour handling.
setColorEnabled(false);

function withFakeTime(fn: (time: FakeTime) => void): void {
	const time = new FakeTime(0);
	try {
		fn(time);
	} finally {
		time.restore();
	}
}

// ---------- isAnimated / isCi ----------

Deno.test("isAnimated: explicit true wins over a non-tty", () => {
	const io = makeFakeIo({ isTerminal: false });
	assertStrictEquals(isAnimated(io, true), true);
});

Deno.test("isAnimated: explicit false wins over a tty", () => {
	const io = makeFakeIo({ isTerminal: true });
	assertStrictEquals(isAnimated(io, false), false);
});

Deno.test("isAnimated: undefined + tty + no CI + TERM=xterm → true", () => {
	const io = makeFakeIo({ isTerminal: true, env: { TERM: "xterm-256color" } });
	assertStrictEquals(isAnimated(io, undefined), true);
});

Deno.test("isAnimated: undefined + non-tty → false", () => {
	const io = makeFakeIo({ isTerminal: false });
	assertStrictEquals(isAnimated(io, undefined), false);
});

Deno.test("isAnimated: undefined + TERM=dumb → false", () => {
	const io = makeFakeIo({ isTerminal: true, env: { TERM: "dumb" } });
	assertStrictEquals(isAnimated(io, undefined), false);
});

Deno.test("isAnimated: undefined + CI=1 → false", () => {
	const io = makeFakeIo({ isTerminal: true, env: { CI: "1" } });
	assertStrictEquals(isAnimated(io, undefined), false);
});

Deno.test('isCi: "", "0", "false" do not count as CI (D9)', () => {
	for (const v of ["", "0", "false"]) {
		const io = makeFakeIo({ env: { CI: v } });
		assertStrictEquals(isCi(io), false, `CI=${JSON.stringify(v)}`);
	}
});

Deno.test("isCi: any other value counts as CI", () => {
	for (const v of ["1", "true", "yes", "gitlab"]) {
		const io = makeFakeIo({ env: { CI: v } });
		assertStrictEquals(isCi(io), true, `CI=${JSON.stringify(v)}`);
	}
});

Deno.test("isCi: unset → false", () => {
	const io = makeFakeIo({ env: {} });
	assertStrictEquals(isCi(io), false);
});

// ---------- resolveFallback / renderNotable ----------

Deno.test('resolveFallback("silent") returns null for every snapshot', () => {
	const fn = resolveFallback("silent");
	const snap: StatusSnapshot = {
		elapsedMs: 0,
		clock: "0:00",
		label: "x",
		detail: "y",
		counters: {},
		notable: true,
	};
	assertStrictEquals(fn(snap), null);
});

Deno.test('resolveFallback("notable") gates on snap.notable', () => {
	const fn = resolveFallback("notable");
	const base = {
		elapsedMs: 0,
		clock: "0:00",
		label: "hello",
		detail: "world",
		counters: {} as Readonly<Record<string, number>>,
	};
	assertStrictEquals(fn({ ...base, notable: false }), null);
	assertEquals(fn({ ...base, notable: true }), "⋯ 0:00 hello world");
});

Deno.test("resolveFallback(undefined) defaults to the notable policy", () => {
	const fn = resolveFallback(undefined);
	const snap: StatusSnapshot = {
		elapsedMs: 0,
		clock: "",
		label: "l",
		detail: "",
		counters: {},
		notable: true,
	};
	assertEquals(fn(snap), "⋯ l");
});

Deno.test("resolveFallback(fn) returns the function as-is", () => {
	const marker = { calls: 0 };
	const custom: FallbackPolicy = (s) => {
		marker.calls++;
		return `${s.notable ? "!" : "."} ${s.label}`;
	};
	const fn = resolveFallback(custom);
	assertEquals(
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
	assertStrictEquals(marker.calls, 1);
});

Deno.test("renderNotable: joins non-empty pieces with a single space (no double when clock empty)", () => {
	assertEquals(
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

Deno.test("renderNotable: truncates to FALLBACK_LINE_MAX columns via truncateToWidth", () => {
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

Deno.test("(a) non-tty + default policy: one line per notable set(), none for non-notable, duplicates suppressed", () => {
	withFakeTime(() => {
		const io = makeFakeIo({ isTerminal: false, now: () => Date.now() });
		const sl = statusLine({ io, clock: false });
		try {
			sl.set("first", "d1"); // non-notable → nothing
			sl.set("second", "d2"); // non-notable → nothing
			assertEquals(io.writes, []);

			sl.set("hello", "world", { notable: true });
			assertEquals(io.writes, ["⋯ hello world\n"]);

			// A duplicate notable line is suppressed.
			sl.set("hello", "world", { notable: true });
			assertEquals(io.writes.length, 1);

			// A different notable line is emitted.
			sl.set("done", "bye", { notable: true });
			assertEquals(io.writes, ["⋯ hello world\n", "⋯ done bye\n"]);
		} finally {
			sl.stop();
		}
	});
});

Deno.test("(a cont'd) 500-column detail is bounded to FALLBACK_LINE_MAX columns", () => {
	withFakeTime(() => {
		const io = makeFakeIo({ isTerminal: false, now: () => Date.now() });
		const sl = statusLine({ io, clock: false });
		try {
			sl.set("l", "x".repeat(500), { notable: true });
			assertEquals(io.writes.length, 1);
			const line = io.writes[0];
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

Deno.test('(b) "silent" policy writes zero bytes', () => {
	withFakeTime(() => {
		const io = makeFakeIo({ isTerminal: false, now: () => Date.now() });
		const sl = statusLine({ io, fallback: "silent" });
		try {
			sl.set("a", "b", { notable: true });
			sl.set("c", "d", { notable: true });
			sl.set("e", "f"); // non-notable
			assertEquals(io.writes, []);
		} finally {
			sl.stop();
		}
	});
});

Deno.test("(c) custom function receives a full snapshot; null skips", () => {
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
			assertEquals(io.writes, []); // null → nothing

			time.tick(2000);
			sl.set("second", "d", { notable: true });
			assertEquals(io.writes, ["X 0:02 second#3\n"]);

			// The custom function saw every set(), notable or not, with the
			// full snapshot shape.
			assertStrictEquals(seen.length, 2);
			assertStrictEquals(seen[0].notable, false);
			assertStrictEquals(seen[0].label, "first");
			assertStrictEquals(seen[0].counters.n, 3);
			assertStrictEquals(seen[0].elapsedMs, 0);
			assertStrictEquals(seen[0].clock, "0:00");
			assertStrictEquals(seen[1].notable, true);
			assertStrictEquals(seen[1].label, "second");
			assertStrictEquals(seen[1].elapsedMs, 2000);
			assertStrictEquals(seen[1].clock, "0:02");
		} finally {
			sl.stop();
		}
	});
});

Deno.test("(d) TERM=dumb on a fake tty → fallback path", () => {
	withFakeTime(() => {
		const io = makeFakeIo({
			isTerminal: true,
			env: { TERM: "dumb" },
			now: () => Date.now(),
		});
		const sl = statusLine({ io, clock: false });
		try {
			// No initial draw — non-animated.
			assertEquals(io.writes.length, 0);
			assertEquals(io.unrefCalls.length, 0);
			sl.set("hi", "there", { notable: true });
			assertEquals(io.writes, ["⋯ hi there\n"]);
		} finally {
			sl.stop();
		}
	});
});

Deno.test("(d cont'd) CI=1 on a fake tty → fallback path", () => {
	withFakeTime(() => {
		const io = makeFakeIo({
			isTerminal: true,
			env: { CI: "1" },
			now: () => Date.now(),
		});
		const sl = statusLine({ io, clock: false });
		try {
			assertEquals(io.writes.length, 0);
			sl.set("hi", undefined, { notable: true });
			assertEquals(io.writes, ["⋯ hi\n"]);
		} finally {
			sl.stop();
		}
	});
});

Deno.test("(e) enabled: true on a fake non-tty → animated bytes", () => {
	withFakeTime(() => {
		const io = makeFakeIo({ isTerminal: false, now: () => Date.now() });
		const sl = statusLine({ io, clock: false, enabled: true, frames: ["A"] });
		try {
			// Initial draw fires despite the non-tty.
			assertEquals(io.writes[0], "\rA\x1b[K");
			assertEquals(io.unrefCalls.length, 1);
		} finally {
			sl.stop();
		}
	});
});

Deno.test("inc() never emits in the fallback path", () => {
	withFakeTime(() => {
		const io = makeFakeIo({ isTerminal: false, now: () => Date.now() });
		const sl = statusLine({
			io,
			counters: [{ key: "n", glyph: "⚒" }],
		});
		try {
			sl.inc("n", 5);
			sl.inc("n");
			assertEquals(io.writes, []);
		} finally {
			sl.stop();
		}
	});
});

Deno.test("stop() without text in fallback path writes nothing", () => {
	withFakeTime(() => {
		const io = makeFakeIo({ isTerminal: false, now: () => Date.now() });
		const sl = statusLine({ io });
		sl.stop();
		assertEquals(io.writes, []);
	});
});

Deno.test("stop({ text }) in fallback path writes text + \\n", () => {
	withFakeTime(() => {
		const io = makeFakeIo({ isTerminal: false, now: () => Date.now() });
		const sl = statusLine({ io });
		sl.stop({ text: "done in 3:12" });
		assertEquals(io.writes, ["done in 3:12\n"]);
	});
});

Deno.test("log() in fallback path writes plain msg + \\n (no erase)", () => {
	withFakeTime(() => {
		const io = makeFakeIo({ isTerminal: false, now: () => Date.now() });
		const sl = statusLine({ io });
		try {
			sl.log("plain", "text");
			assertEquals(io.writes, ["plain text\n"]);
		} finally {
			sl.stop();
		}
	});
});

// The "no console.* in src/" invariant (decision D5) is a build-time policy
// verified with `grep -rn "console\." src/`; it cannot be a runtime test
// without granting the whole suite `--allow-read`, which the other suites
// deliberately do without.
