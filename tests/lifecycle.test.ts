import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// The real platform `Io` end to end, in a child process (see `_child.ts`). The child
// runs on Node; `CHILD_RUNTIME=deno` (`pnpm run test:deno`) runs the same fixture on
// Deno — the runtime JSR consumers use — as the gate before a JSR publish.

const CHILD = fileURLToPath(new URL("./_child.ts", import.meta.url));
const HIDE = "\x1b[?25l";
const SHOW = "\x1b[?25h";

function run(mode: string): {
	status: number | null;
	signal: string | null;
	out: string;
} {
	const deno = process.env.CHILD_RUNTIME === "deno";
	const cmd = deno ? "deno" : process.execPath;
	const args = deno ? ["run", "--allow-env", CHILD, mode] : [CHILD, mode];
	const r = spawnSync(cmd, args, {
		encoding: "utf8",
		timeout: 10_000,
		env: { ...process.env, NO_COLOR: "1" },
	});
	if (r.error) throw r.error;
	assert.equal(r.stderr, "", `child stderr: ${r.stderr}`);
	return { status: r.status, signal: r.signal, out: r.stdout };
}

test("a never-stopped line does not keep the process alive; exit restores the cursor", () => {
	const { status, signal, out } = run("never-stopped");
	// Killed by the spawn timeout would mean the interval kept the process alive.
	assert.equal(signal, null);
	assert.equal(status, 0);
	assert(out.startsWith(HIDE), JSON.stringify(out));
	assert(out.includes("\rA working\x1b[K"), JSON.stringify(out));
	assert(out.endsWith(SHOW), JSON.stringify(out));
});

test("process.exit() fires the exit hook, which restores the cursor", () => {
	const { status, out } = run("process-exit");
	assert.equal(status, 3);
	assert(out.startsWith(HIDE), JSON.stringify(out));
	assert(out.endsWith(SHOW), JSON.stringify(out));
});

test("library writes and host console output keep their order on a pipe", () => {
	const { status, out } = run("ordering");
	assert.equal(status, 0);
	assert.equal(out, "one\ntwo\n⋯ three\nfour\nfive\n");
});
