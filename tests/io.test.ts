import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { denoIo, type Io, resolveIo } from "../src/io.ts";
import { makeFakeIo } from "./_fake-io.ts";

Deno.test("resolveIo() with no partial returns a total Io backed by denoIo", () => {
	const io = resolveIo();
	// Every member is present and callable.
	assertStrictEquals(io.write, denoIo.write);
	assertStrictEquals(io.columns, denoIo.columns);
	assertStrictEquals(io.isTerminal, denoIo.isTerminal);
	assertStrictEquals(io.env, denoIo.env);
	assertStrictEquals(io.unrefTimer, denoIo.unrefTimer);
	assertStrictEquals(io.now, denoIo.now);
	assertStrictEquals(io.onExit, denoIo.onExit);
});

Deno.test("resolveIo(partial) fills missing members from denoIo", () => {
	const columns = () => 42;
	const io = resolveIo({ columns });
	assertStrictEquals(io.columns, columns);
	assertEquals(io.columns(), 42);
	// Untouched members still point at denoIo.
	assertStrictEquals(io.env, denoIo.env);
	assertStrictEquals(io.now, denoIo.now);
});

Deno.test("resolveIo(partial) overrides every member independently", () => {
	const partial: Partial<Io> = {
		write: () => {},
		columns: () => 10,
		isTerminal: () => false,
		env: () => "x",
		unrefTimer: () => {},
		now: () => 123,
		onExit: () => () => {},
	};
	const io = resolveIo(partial);
	assertEquals(io.columns(), 10);
	assertEquals(io.isTerminal(), false);
	assertEquals(io.env("anything"), "x");
	assertEquals(io.now(), 123);
});

Deno.test("denoIo.env never throws and returns undefined for unset keys", () => {
	// A key we're confident isn't set. The point is that the call itself doesn't throw,
	// even under narrow permissions where `Deno.env.get` would raise `NotCapable`.
	const v = denoIo.env("__cli_status_line_definitely_unset_" + Math.random());
	assertEquals(v, undefined);
});

Deno.test("denoIo.now returns a finite number close to Date.now()", () => {
	const before = Date.now();
	const n = denoIo.now();
	const after = Date.now();
	assert(Number.isFinite(n));
	assert(n >= before && n <= after);
});

Deno.test("denoIo.columns returns a finite positive number", () => {
	const c = denoIo.columns();
	assert(Number.isFinite(c));
	assert(c > 0);
});

Deno.test("denoIo.isTerminal returns a boolean", () => {
	assertEquals(typeof denoIo.isTerminal(), "boolean");
});

Deno.test("denoIo.onExit returns an unsubscribe that does not throw", () => {
	const unsub = denoIo.onExit(() => {});
	assertEquals(typeof unsub, "function");
	unsub();
	// Idempotent — a second call is a no-op.
	unsub();
});

Deno.test("fake io records writes in order and joins them via output()", () => {
	const io = makeFakeIo();
	io.write("a");
	io.write("bc");
	io.write("d");
	assertEquals(io.writes, ["a", "bc", "d"]);
	assertEquals(io.output(), "abcd");
});

Deno.test("fake io honours columns, isTerminal, env, now overrides", () => {
	let clock = 0;
	const io = makeFakeIo({
		columns: 120,
		isTerminal: false,
		env: { CI: "1", TERM: "dumb" },
		now: () => clock,
	});
	assertEquals(io.columns(), 120);
	assertEquals(io.isTerminal(), false);
	assertEquals(io.env("CI"), "1");
	assertEquals(io.env("TERM"), "dumb");
	assertEquals(io.env("MISSING"), undefined);
	assertEquals(io.now(), 0);
	clock = 500;
	assertEquals(io.now(), 500);
});

Deno.test("fake io setters mutate reported state", () => {
	const io = makeFakeIo();
	assertEquals(io.columns(), 80);
	io.setColumns(200);
	assertEquals(io.columns(), 200);

	assertEquals(io.isTerminal(), true);
	io.setIsTerminal(false);
	assertEquals(io.isTerminal(), false);

	assertEquals(io.env("FOO"), undefined);
	io.setEnv("FOO", "bar");
	assertEquals(io.env("FOO"), "bar");
	io.setEnv("FOO", undefined);
	assertEquals(io.env("FOO"), undefined);
});

Deno.test("fake io tracks unrefTimer calls", () => {
	const io = makeFakeIo();
	io.unrefTimer(1);
	io.unrefTimer(2);
	assertEquals(io.unrefCalls, [1, 2]);
});

Deno.test("fake io onExit subscribe / unsubscribe / triggerExit", () => {
	const io = makeFakeIo();
	let calls = 0;
	const unsub = io.onExit(() => {
		calls++;
	});
	assertEquals(io.exitHandlers.size, 1);
	io.triggerExit();
	assertEquals(calls, 1);
	// Handler stays subscribed until unsub is called.
	io.triggerExit();
	assertEquals(calls, 2);
	unsub();
	assertEquals(io.exitHandlers.size, 0);
	io.triggerExit();
	assertEquals(calls, 2);
});

Deno.test("fake io write throws when armed and stops throwing when disarmed", () => {
	const io = makeFakeIo();
	io.setWriteThrows(true);
	let threw = false;
	try {
		io.write("x");
	} catch {
		threw = true;
	}
	assertEquals(threw, true);
	assertEquals(io.writes, []);
	io.setWriteThrows(false);
	io.write("y");
	assertEquals(io.writes, ["y"]);
});
