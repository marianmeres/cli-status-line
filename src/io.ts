/**
 * The one place in `src/` that touches the platform. Everything else — the renderer,
 * the lifecycle, the fallback policies — talks to the terminal through this seam so
 * that tests can inject a memory fake and drive the library byte-for-byte, and so
 * that adding a Node adapter later is a one-file change rather than a rewrite.
 *
 * The seam has three non-obvious rules baked in:
 *
 *   1. `write` never throws. Closed stdout, `EAGAIN` on a non-blocking pipe, a partial
 *      `writeSync` — all get swallowed or drained. A renderer must not kill a run.
 *   2. `env` never throws. `Deno.env.get` raises `NotCapable` under `--no-prompt`
 *      without `--allow-env`; the seam returns `undefined` in that case so
 *      `statusLine()` does not crash on construction under narrow permissions.
 *   3. Timers stay out. The seam owns `unrefTimer` but not `setInterval` — tests
 *      drive the real timers with `FakeTime` from `@std/testing/time`.
 */

/**
 * Platform seam. All members must be total: no method throws, ever. `denoIo` is
 * the only implementation in this package; `resolveIo` fills a partial override
 * (used by tests) from `denoIo`.
 */
export interface Io {
	/** Write the whole string. Must not throw; short writes are drained internally. */
	write(s: string): void;
	/** Terminal width in columns; a sane default (80) when unknown. */
	columns(): number;
	/** Whether stdout is a tty. */
	isTerminal(): boolean;
	/** `undefined` when unset OR when the runtime denies access — never throws. */
	env(key: string): string | undefined;
	/** Let the process exit even though this timer is pending. */
	unrefTimer(id: number): void;
	/** Monotonic-enough ms; only ever compared to itself. */
	now(): number;
	/** Run `fn` at normal process exit (incl. `Deno.exit()`); returns an unsubscribe. */
	onExit(fn: () => void): () => void;
}

const encoder = new TextEncoder();

/**
 * Deno-backed `Io`. Kept internal so `mod.ts` never re-exports `Deno.*` reach into
 * the public surface; consumers who need to inject a fake do so via `Io`.
 */
export const denoIo: Io = {
	write(s: string): void {
		try {
			const bytes = encoder.encode(s);
			let offset = 0;
			while (offset < bytes.length) {
				const n = Deno.stdout.writeSync(bytes.subarray(offset));
				if (n <= 0) break;
				offset += n;
			}
		} catch {
			// stdout closed / EAGAIN on non-blocking pipe / anything else — swallow.
		}
	},
	columns(): number {
		try {
			return Deno.consoleSize().columns;
		} catch {
			return 80;
		}
	},
	isTerminal(): boolean {
		try {
			return Deno.stdout.isTerminal();
		} catch {
			return false;
		}
	},
	env(key: string): string | undefined {
		try {
			return Deno.env.get(key);
		} catch {
			// `NotCapable` under `--no-prompt` without `--allow-env`.
			return undefined;
		}
	},
	unrefTimer(id: number): void {
		try {
			Deno.unrefTimer(id);
		} catch {
			// swallow — timer already cleared, or runtime lacks `unrefTimer`.
		}
	},
	now(): number {
		return Date.now();
	},
	onExit(fn: () => void): () => void {
		const handler = () => {
			try {
				fn();
			} catch {
				// swallow — exit handlers must not throw.
			}
		};
		globalThis.addEventListener("unload", handler);
		return () => globalThis.removeEventListener("unload", handler);
	},
};

/**
 * Merge a partial `Io` over `denoIo`. Used by tests to override just the members
 * they care about while the rest defer to the real platform behaviour.
 */
export function resolveIo(partial?: Partial<Io>): Io {
	return { ...denoIo, ...partial };
}
