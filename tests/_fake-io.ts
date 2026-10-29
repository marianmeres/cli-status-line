/**
 * In-memory `Io` fake for tests. Not a suite: `pnpm test` only runs `*.test.ts`.
 *
 * Records every `write` in order and exposes a joined `output()` for byte-exact
 * goldens. Every reachable knob (`columns`, `isTerminal`, `env`, `now`, throwing
 * `write`) is mutable so a single test can set up state before construction and
 * flip it mid-run without allocating a new fake.
 *
 * `NO_COLOR=1` is in the env by default so goldens are byte-exact; a test that wants
 * colour calls `setEnv("NO_COLOR", undefined)` before constructing the status line.
 */

import type { Io } from "../src/io.ts";

export interface FakeIoInit {
	columns?: number;
	isTerminal?: boolean;
	env?: Record<string, string>;
	now?: () => number;
}

export interface FakeIo extends Io {
	/** Every string passed to `write`, in the order it arrived. */
	readonly writes: string[];
	/** Timers passed to `unrefTimer`. */
	readonly unrefCalls: unknown[];
	/** Currently-subscribed `onExit` handlers. */
	readonly exitHandlers: Set<() => void>;

	/** All `writes` concatenated — the byte stream the terminal would see. */
	output(): string;
	/** Fire every subscribed `onExit` handler, as the runtime would at `exit`. */
	triggerExit(): void;
	/** Make the next (and every subsequent) `write` throw until unset. */
	setWriteThrows(throws: boolean): void;
	/** Overwrite reported columns (default 80). */
	setColumns(n: number): void;
	/** Overwrite reported tty status (default true). */
	setIsTerminal(b: boolean): void;
	/** Set/unset an env var seen by `env(key)`. */
	setEnv(key: string, value: string | undefined): void;
}

export function makeFakeIo(init: FakeIoInit = {}): FakeIo {
	let cols = init.columns ?? 80;
	let isTty = init.isTerminal ?? true;
	const env: Record<string, string | undefined> = { NO_COLOR: "1", ...init.env };
	const nowFn = init.now ?? (() => 0);
	const writes: string[] = [];
	const unrefCalls: unknown[] = [];
	const exitHandlers = new Set<() => void>();
	let writeThrows = false;

	const fake: FakeIo = {
		write(s: string): void {
			if (writeThrows) throw new Error("fake io: write refused");
			writes.push(s);
		},
		columns(): number {
			return cols;
		},
		isTerminal(): boolean {
			return isTty;
		},
		env(key: string): string | undefined {
			return env[key];
		},
		unrefTimer(timer: unknown): void {
			unrefCalls.push(timer);
		},
		now(): number {
			return nowFn();
		},
		onExit(fn: () => void): () => void {
			exitHandlers.add(fn);
			return () => {
				exitHandlers.delete(fn);
			};
		},

		writes,
		unrefCalls,
		exitHandlers,
		output(): string {
			return writes.join("");
		},
		triggerExit(): void {
			for (const fn of [...exitHandlers]) fn();
		},
		setWriteThrows(t: boolean): void {
			writeThrows = t;
		},
		setColumns(n: number): void {
			cols = n;
		},
		setIsTerminal(b: boolean): void {
			isTty = b;
		},
		setEnv(key: string, value: string | undefined): void {
			if (value === undefined) delete env[key];
			else env[key] = value;
		},
	};

	return fake;
}
