import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { makeFakeIo } from "./_fake-io.ts";
import { statusLine } from "../src/status-line.ts";

function withFakeTime(fn: (time: typeof mock.timers) => void): void {
	mock.timers.enable({ apis: ["setInterval", "Date"], now: 0 });
	try {
		fn(mock.timers);
	} finally {
		mock.timers.reset();
	}
}

test("initial draw happens synchronously at construction and unrefs the timer", () => {
	withFakeTime(() => {
		const io = makeFakeIo({ now: () => Date.now() });
		const sl = statusLine({ io, clock: false });
		try {
			// One draw before any tick has fired.
			assert.deepEqual(io.writes.length, 1);
			// The first bytes are `\r` + painted + `\x1b[K`.
			assert(io.writes[0]?.startsWith("\r"));
			assert(io.writes[0]?.endsWith("\x1b[K"));
			// The interval id was passed to unrefTimer.
			assert.deepEqual(io.unrefCalls.length, 1);
		} finally {
			sl.stop();
		}
	});
});

test("tick advances the frame and re-reads columns() every frame", () => {
	withFakeTime((time) => {
		const io = makeFakeIo({ columns: 80, now: () => Date.now() });
		const sl = statusLine({
			io,
			clock: false,
			frames: ["A", "B", "C"],
			intervalMs: 100,
		});
		try {
			// Initial draw at frame 0.
			assert.deepEqual(io.writes[0], "\rA\x1b[K");
			time.tick(100);
			// Next tick draws frame 1.
			assert.deepEqual(io.writes[1], "\rB\x1b[K");
			// Change columns before the next tick.
			io.setColumns(2); // budget=1, spinner "C" (1 col) still fits.
			time.tick(100);
			assert.deepEqual(io.writes[2], "\rC\x1b[K");
			// A width so small only the spinner survives — confirms per-tick re-read.
			io.setColumns(2);
			time.tick(100);
			assert.deepEqual(io.writes[3], "\rA\x1b[K");
			// And 0 columns → nothing painted.
			io.setColumns(0);
			time.tick(100);
			assert.deepEqual(io.writes[4], "\r\x1b[K");
		} finally {
			sl.stop();
		}
	});
});

test("ten set() calls between ticks produce exactly one write, reflecting the last", () => {
	withFakeTime((time) => {
		const io = makeFakeIo({ columns: 80, now: () => Date.now() });
		const sl = statusLine({
			io,
			clock: false,
			frames: ["*"],
			intervalMs: 100,
		});
		try {
			// Baseline: the initial draw.
			const initial = io.writes.length;
			for (let i = 0; i < 10; i++) sl.set("label" + i, "detail" + i);
			// set() never draws.
			assert.deepEqual(io.writes.length, initial);
			time.tick(100);
			// Exactly one write from the tick.
			assert.deepEqual(io.writes.length, initial + 1);
			const last = io.writes.at(-1) ?? "";
			assert(
				last.includes("label9") && last.includes("detail9"),
				`expected last set() to be reflected, got ${JSON.stringify(last)}`,
			);
		} finally {
			sl.stop();
		}
	});
});

test("log() erases the drawn line, writes msg + \\n, and the next tick redraws", () => {
	withFakeTime((time) => {
		const io = makeFakeIo({ columns: 80, now: () => Date.now() });
		const sl = statusLine({
			io,
			clock: false,
			frames: ["A", "B"],
			intervalMs: 100,
		});
		try {
			// Initial draw. drawn=true now.
			assert.deepEqual(io.writes.length, 1);
			sl.log("hello", "world");
			// Erase + message.
			assert.deepEqual(io.writes[1], "\r\x1b[K");
			assert.deepEqual(io.writes[2], "hello world\n");
			// Next tick redraws.
			time.tick(100);
			assert.deepEqual(io.writes[3], "\rB\x1b[K");
		} finally {
			sl.stop();
		}
	});
});

test("log() before any draw skips the erase", () => {
	withFakeTime(() => {
		const io = makeFakeIo({ now: () => Date.now() });
		const sl = statusLine({ io, enabled: false });
		try {
			assert.deepEqual(io.writes.length, 0); // no initial draw when disabled
			sl.log("hi");
			// No erase — nothing was drawn.
			assert.deepEqual(io.writes, ["hi\n"]);
		} finally {
			sl.stop();
		}
	});
});

test("pause() erases synchronously; ticks write nothing until resume()", () => {
	withFakeTime((time) => {
		const io = makeFakeIo({ columns: 80, now: () => Date.now() });
		const sl = statusLine({
			io,
			clock: false,
			frames: ["A", "B", "C"],
			intervalMs: 100,
		});
		try {
			assert.deepEqual(io.writes.length, 1); // initial
			sl.pause();
			assert.deepEqual(io.writes[1], "\r\x1b[K"); // erase on pause
			const afterPause = io.writes.length;
			time.tick(100);
			time.tick(100);
			assert.deepEqual(io.writes.length, afterPause); // no writes while paused
			// Idempotent — a second pause is a no-op.
			sl.pause();
			assert.deepEqual(io.writes.length, afterPause);
			sl.resume();
			// resume() does not draw; the next tick does.
			assert.deepEqual(io.writes.length, afterPause);
			time.tick(100);
			assert.deepEqual(io.writes.length, afterPause + 1);
		} finally {
			sl.stop();
		}
	});
});

test("stop() erases once and is idempotent", () => {
	withFakeTime(() => {
		const io = makeFakeIo({ columns: 80, now: () => Date.now() });
		const sl = statusLine({ io, clock: false, frames: ["A"] });
		assert.deepEqual(io.writes.length, 1);
		sl.stop();
		assert.deepEqual(io.writes[1], "\r\x1b[K");
		const afterStop = io.writes.length;
		sl.stop();
		sl.stop({ text: "again" });
		// Post-stop calls are no-ops.
		assert.deepEqual(io.writes.length, afterStop);
	});
});

test("stop({ text }) erases the frame and writes text + \\n", () => {
	withFakeTime(() => {
		const io = makeFakeIo({ columns: 80, now: () => Date.now() });
		const sl = statusLine({ io, clock: false, frames: ["A"] });
		assert.deepEqual(io.writes.length, 1);
		sl.stop({ text: "done in 3:12" });
		assert.deepEqual(io.writes[1], "\r\x1b[K");
		assert.deepEqual(io.writes[2], "done in 3:12\n");
	});
});

test("stop({ clear: false }) leaves the frame on screen and moves below it", () => {
	withFakeTime(() => {
		const io = makeFakeIo({ columns: 80, now: () => Date.now() });
		const sl = statusLine({ io, clock: false, frames: ["A"] });
		assert.deepEqual(io.writes.length, 1);
		sl.stop({ clear: false });
		// Just a newline — the last frame stays visible above the cursor.
		assert.deepEqual(io.writes[1], "\n");
	});
});

test("stop({ clear: false, text }) erases the frame so text lands on its own line", () => {
	withFakeTime(() => {
		const io = makeFakeIo({ columns: 80, now: () => Date.now() });
		const sl = statusLine({ io, clock: false, frames: ["A"] });
		sl.stop({ clear: false, text: "bye" });
		// text present → erase, then text.
		assert.deepEqual(io.writes[1], "\r\x1b[K");
		assert.deepEqual(io.writes[2], "bye\n");
	});
});

test("set() / inc() / log() / pause() / resume() are no-ops after stop()", () => {
	withFakeTime((time) => {
		const io = makeFakeIo({ columns: 80, now: () => Date.now() });
		const sl = statusLine({
			io,
			clock: false,
			frames: ["A"],
			counters: [{ key: "n", glyph: "⚒" }],
		});
		sl.stop();
		const afterStop = io.writes.length;
		sl.set("x", "y");
		sl.inc("n", 5);
		sl.log("nope");
		sl.pause();
		sl.resume();
		time.tick(1000); // any queued ticks are also inert
		assert.deepEqual(io.writes.length, afterStop);
	});
});

test("inc() on an undeclared key is a silent no-op (D8)", () => {
	withFakeTime((time) => {
		const io = makeFakeIo({ columns: 80, now: () => Date.now() });
		const sl = statusLine({
			io,
			clock: false,
			frames: ["*"],
			counters: [{ key: "tools", glyph: "⚒" }],
		});
		try {
			sl.inc("typo", 99);
			sl.inc("tools", 3);
			time.tick(100);
			const last = io.writes.at(-1) ?? "";
			// Declared counter is present with the right count; undeclared did nothing.
			assert(last.includes("3⚒"), `got ${JSON.stringify(last)}`);
			assert(
				!last.includes("99"),
				`undeclared counter leaked: ${JSON.stringify(last)}`,
			);
		} finally {
			sl.stop();
		}
	});
});

test("public methods never throw when io.write throws", () => {
	withFakeTime((time) => {
		const io = makeFakeIo({ columns: 80, now: () => Date.now() });
		const sl = statusLine({
			io,
			clock: false,
			frames: ["A"],
			counters: [{ key: "n", glyph: "⚒" }],
		});
		// Fake starts throwing after the initial draw.
		io.setWriteThrows(true);
		// If any of these propagate, the test fails.
		sl.set("label", "detail");
		sl.inc("n");
		sl.log("msg");
		time.tick(100); // tick's write throws internally; must be swallowed
		time.tick(100);
		sl.pause();
		sl.resume();
		sl.stop({ text: "bye" });
		assert(true, "no method threw");
	});
});

test("elapsedMs advances with time and freezes at stop()", () => {
	withFakeTime((time) => {
		const io = makeFakeIo({ now: () => Date.now() });
		const sl = statusLine({ io, clock: false });
		try {
			assert.deepEqual(sl.elapsedMs, 0);
			time.tick(250);
			assert.deepEqual(sl.elapsedMs, 250);
			sl.stop();
			// Any further real-time advance must not move it.
			time.tick(1000);
			assert.deepEqual(sl.elapsedMs, 250);
		} finally {
			sl.stop();
		}
	});
});

test("clock renders elapsed as m:ss and updates each tick", () => {
	withFakeTime((time) => {
		const io = makeFakeIo({ columns: 80, now: () => Date.now() });
		const sl = statusLine({ io, frames: ["*"], intervalMs: 1000 });
		try {
			// Initial draw at t=0 → "0:00".
			assert(io.writes[0]?.includes("0:00"), JSON.stringify(io.writes[0]));
			time.tick(63_000); // 63 seconds ≈ 1:03
			const last = io.writes.at(-1) ?? "";
			assert(last.includes("1:03"), `expected 1:03 in ${JSON.stringify(last)}`);
		} finally {
			sl.stop();
		}
	});
});

test("enabled: false starts no timer and produces no writes on set()", () => {
	withFakeTime((time) => {
		const io = makeFakeIo({ now: () => Date.now() });
		const sl = statusLine({ io, enabled: false });
		try {
			assert.deepEqual(io.writes.length, 0);
			assert.deepEqual(io.unrefCalls.length, 0);
			sl.set("something");
			sl.inc("nope");
			time.tick(10_000);
			assert.deepEqual(io.writes.length, 0);
		} finally {
			sl.stop();
		}
	});
});

test("set() sanitizes label and detail (newlines, control chars, ANSI)", () => {
	withFakeTime((time) => {
		const io = makeFakeIo({ columns: 200, now: () => Date.now() });
		const sl = statusLine({ io, clock: false, frames: ["*"] });
		try {
			sl.set("a\nb c\x01d", "\x1b[31mred\x1b[0m");
			time.tick(100);
			const last = io.writes.at(-1) ?? "";
			// Newlines collapse to a single space, control chars strip out, ANSI strips out.
			assert(
				last.includes("a b cd"),
				`label sanitize failed: ${JSON.stringify(last)}`,
			);
			assert(
				last.includes("red"),
				`detail sanitize failed: ${JSON.stringify(last)}`,
			);
			assert(!last.includes("\x1b[31m"), `ANSI leaked: ${JSON.stringify(last)}`);
		} finally {
			sl.stop();
		}
	});
});

test("log() with no args writes just a newline", () => {
	withFakeTime(() => {
		const io = makeFakeIo({ enabled: false, now: () => Date.now() } as never);
		const sl = statusLine({ io, enabled: false });
		try {
			sl.log();
			assert.deepEqual(io.writes, ["\n"]);
		} finally {
			sl.stop();
		}
	});
});

test("statusLine() returns a shape matching the StatusLine interface", () => {
	withFakeTime(() => {
		const io = makeFakeIo({ now: () => Date.now() });
		const sl = statusLine({ io, enabled: false });
		try {
			assert.equal(typeof sl.set, "function");
			assert.equal(typeof sl.inc, "function");
			assert.equal(typeof sl.log, "function");
			assert.equal(typeof sl.pause, "function");
			assert.equal(typeof sl.resume, "function");
			assert.equal(typeof sl.stop, "function");
			assert.equal(typeof sl.elapsedMs, "number");
		} finally {
			sl.stop();
		}
	});
});
