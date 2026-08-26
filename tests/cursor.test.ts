import { assert, assertEquals } from "@std/assert";
import { setColorEnabled } from "@std/fmt/colors";
import { FakeTime } from "@std/testing/time";
import { makeFakeIo } from "./_fake-io.ts";
import { statusLine } from "../src/status-line.ts";

setColorEnabled(false);

const HIDE = "\x1b[?25l";
const SHOW = "\x1b[?25h";

function withFakeTime(fn: (time: FakeTime) => void): void {
	const time = new FakeTime(0);
	try {
		fn(time);
	} finally {
		time.restore();
	}
}

Deno.test("hideCursor: true emits the hide sequence at start and registers onExit", () => {
	withFakeTime(() => {
		const io = makeFakeIo({ columns: 80, now: () => Date.now() });
		const sl = statusLine({ io, clock: false, frames: ["*"], hideCursor: true });
		try {
			// First byte written is the hide-cursor sequence, before the initial draw.
			assertEquals(io.writes[0], HIDE);
			// Initial frame draw follows.
			assert(io.writes[1].startsWith("\r"));
			// Exactly one onExit handler is registered.
			assertEquals(io.exitHandlers.size, 1);
		} finally {
			sl.stop();
		}
	});
});

Deno.test("hideCursor: true stop() emits the show sequence and unsubscribes onExit", () => {
	withFakeTime(() => {
		const io = makeFakeIo({ columns: 80, now: () => Date.now() });
		const sl = statusLine({ io, clock: false, frames: ["*"], hideCursor: true });
		sl.stop();
		assert(
			io.writes.includes(SHOW),
			`expected show sequence in writes, got ${JSON.stringify(io.writes)}`,
		);
		// The handler was unsubscribed on stop.
		assertEquals(io.exitHandlers.size, 0);
		// A post-stop exit trigger writes nothing further.
		const afterStop = io.writes.length;
		io.triggerExit();
		assertEquals(io.writes.length, afterStop);
	});
});

Deno.test("hideCursor: true onExit callback restores the cursor if fired before stop()", () => {
	withFakeTime(() => {
		const io = makeFakeIo({ columns: 80, now: () => Date.now() });
		const sl = statusLine({ io, clock: false, frames: ["*"], hideCursor: true });
		try {
			// Simulate a normal `unload` before the caller reaches stop().
			io.triggerExit();
			// The last thing written by the handler is the show sequence.
			assertEquals(io.writes[io.writes.length - 1], SHOW);
		} finally {
			sl.stop();
		}
	});
});

Deno.test("hideCursor default (false) never emits either sequence", () => {
	withFakeTime((time) => {
		const io = makeFakeIo({ columns: 80, now: () => Date.now() });
		const sl = statusLine({ io, clock: false, frames: ["A", "B"] });
		time.tick(100);
		sl.log("hi");
		sl.pause();
		sl.resume();
		sl.stop({ text: "bye" });
		const joined = io.output();
		assert(!joined.includes(HIDE), `hide sequence leaked: ${JSON.stringify(joined)}`);
		assert(!joined.includes(SHOW), `show sequence leaked: ${JSON.stringify(joined)}`);
		// No onExit subscription either.
		assertEquals(io.exitHandlers.size, 0);
	});
});

Deno.test("hideCursor: true is ignored on the non-animated path", () => {
	withFakeTime(() => {
		const io = makeFakeIo({ now: () => Date.now() });
		const sl = statusLine({ io, enabled: false, hideCursor: true });
		try {
			// Non-animated path writes nothing at construction and registers no onExit.
			assertEquals(io.writes.length, 0);
			assertEquals(io.exitHandlers.size, 0);
			sl.stop();
			// stop() still emits nothing (no frame drawn, no text).
			assertEquals(io.writes.length, 0);
		} finally {
			sl.stop();
		}
	});
});

Deno.test("hideCursor: true does not throw when io.write throws for the hide sequence", () => {
	withFakeTime(() => {
		const io = makeFakeIo({ columns: 80, now: () => Date.now() });
		io.setWriteThrows(true);
		// Construction must not throw even though the very first write (the hide
		// sequence) is refused.
		const sl = statusLine({ io, clock: false, frames: ["*"], hideCursor: true });
		io.setWriteThrows(false);
		sl.stop();
		assert(true, "construction did not throw");
	});
});
