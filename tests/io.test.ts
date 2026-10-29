import assert from "node:assert/strict";
import process from "node:process";
import { test } from "node:test";
import { type Io, nodeIo, resolveIo } from "../src/io.ts";
import { makeFakeIo } from "./_fake-io.ts";

test("resolveIo() with no partial returns a total Io backed by nodeIo", () => {
	const io = resolveIo();
	// Every member is present and callable.
	assert.equal(io.write, nodeIo.write);
	assert.equal(io.columns, nodeIo.columns);
	assert.equal(io.isTerminal, nodeIo.isTerminal);
	assert.equal(io.env, nodeIo.env);
	assert.equal(io.unrefTimer, nodeIo.unrefTimer);
	assert.equal(io.now, nodeIo.now);
	assert.equal(io.onExit, nodeIo.onExit);
});

test("resolveIo(partial) fills missing members from nodeIo", () => {
	const columns = () => 42;
	const io = resolveIo({ columns });
	assert.equal(io.columns, columns);
	assert.deepEqual(io.columns(), 42);
	// Untouched members still point at nodeIo.
	assert.equal(io.env, nodeIo.env);
	assert.equal(io.now, nodeIo.now);
});

test("resolveIo(partial) overrides every member independently", () => {
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
	assert.deepEqual(io.columns(), 10);
	assert.deepEqual(io.isTerminal(), false);
	assert.deepEqual(io.env("anything"), "x");
	assert.deepEqual(io.now(), 123);
});

test("nodeIo.env never throws and returns undefined for unset keys", () => {
	// A key we're confident isn't set. The point is that the call itself doesn't throw,
	// even under a runtime that gates environment access.
	const v = nodeIo.env(`__cli_status_line_definitely_unset_${Math.random()}`);
	assert.deepEqual(v, undefined);
});

test("nodeIo.now returns a finite number close to Date.now()", () => {
	const before = Date.now();
	const n = nodeIo.now();
	const after = Date.now();
	assert(Number.isFinite(n));
	assert(n >= before && n <= after);
});

test("nodeIo.columns returns a finite positive number", () => {
	const c = nodeIo.columns();
	assert(Number.isFinite(c));
	assert(c > 0);
});

test("nodeIo.isTerminal returns a boolean", () => {
	assert.deepEqual(typeof nodeIo.isTerminal(), "boolean");
});

test("nodeIo.onExit returns an unsubscribe that does not throw", () => {
	const unsub = nodeIo.onExit(() => {});
	assert.deepEqual(typeof unsub, "function");
	unsub();
	// Idempotent — a second call is a no-op.
	unsub();
});

test("nodeIo.onExit subscribes to process 'exit' and the unsubscribe removes it", () => {
	const before = process.listenerCount("exit");
	const unsub = nodeIo.onExit(() => {});
	assert.equal(process.listenerCount("exit"), before + 1);
	unsub();
	assert.equal(process.listenerCount("exit"), before);
});

test("nodeIo.unrefTimer unrefs a real timer and tolerates anything else", () => {
	const timer = setInterval(() => {}, 60_000);
	try {
		assert.equal(timer.hasRef(), true);
		nodeIo.unrefTimer(timer);
		assert.equal(timer.hasRef(), false);
	} finally {
		clearInterval(timer);
	}
	for (const notATimer of [undefined, null, 42, "x", {}, { unref: "nope" }]) {
		nodeIo.unrefTimer(notATimer);
	}
});

test("nodeIo.write accepts an empty string without throwing", () => {
	nodeIo.write("");
});

test("fake io records writes in order and joins them via output()", () => {
	const io = makeFakeIo();
	io.write("a");
	io.write("bc");
	io.write("d");
	assert.deepEqual(io.writes, ["a", "bc", "d"]);
	assert.deepEqual(io.output(), "abcd");
});

test("fake io honours columns, isTerminal, env, now overrides", () => {
	let clock = 0;
	const io = makeFakeIo({
		columns: 120,
		isTerminal: false,
		env: { CI: "1", TERM: "dumb" },
		now: () => clock,
	});
	assert.deepEqual(io.columns(), 120);
	assert.deepEqual(io.isTerminal(), false);
	assert.deepEqual(io.env("CI"), "1");
	assert.deepEqual(io.env("TERM"), "dumb");
	assert.deepEqual(io.env("MISSING"), undefined);
	assert.deepEqual(io.now(), 0);
	clock = 500;
	assert.deepEqual(io.now(), 500);
});

test("fake io setters mutate reported state", () => {
	const io = makeFakeIo();
	assert.deepEqual(io.columns(), 80);
	io.setColumns(200);
	assert.deepEqual(io.columns(), 200);

	assert.deepEqual(io.isTerminal(), true);
	io.setIsTerminal(false);
	assert.deepEqual(io.isTerminal(), false);

	assert.deepEqual(io.env("FOO"), undefined);
	io.setEnv("FOO", "bar");
	assert.deepEqual(io.env("FOO"), "bar");
	io.setEnv("FOO", undefined);
	assert.deepEqual(io.env("FOO"), undefined);
});

test("fake io tracks unrefTimer calls", () => {
	const io = makeFakeIo();
	io.unrefTimer(1);
	io.unrefTimer(2);
	assert.deepEqual(io.unrefCalls, [1, 2]);
});

test("fake io onExit subscribe / unsubscribe / triggerExit", () => {
	const io = makeFakeIo();
	let calls = 0;
	const unsub = io.onExit(() => {
		calls++;
	});
	assert.deepEqual(io.exitHandlers.size, 1);
	io.triggerExit();
	assert.deepEqual(calls, 1);
	// Handler stays subscribed until unsub is called.
	io.triggerExit();
	assert.deepEqual(calls, 2);
	unsub();
	assert.deepEqual(io.exitHandlers.size, 0);
	io.triggerExit();
	assert.deepEqual(calls, 2);
});

test("fake io write throws when armed and stops throwing when disarmed", () => {
	const io = makeFakeIo();
	io.setWriteThrows(true);
	let threw = false;
	try {
		io.write("x");
	} catch {
		threw = true;
	}
	assert.deepEqual(threw, true);
	assert.deepEqual(io.writes, []);
	io.setWriteThrows(false);
	io.write("y");
	assert.deepEqual(io.writes, ["y"]);
});
