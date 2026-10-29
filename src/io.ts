/**
 * The one place in `src/` that touches the platform. Everything else — the renderer,
 * the lifecycle, the fallback policies — talks to the terminal through this seam so
 * that tests can inject a memory fake and drive the library byte-for-byte.
 *
 * The seam has three non-obvious rules baked in:
 *
 *   1. `write` never throws. It goes through `process.stdout.write` — the same stream
 *      the host's own `console` output goes through — so the status line and host
 *      output can never reorder, whatever stdout is connected to. A closed pipe (`EPIPE`) surfaces as an
 *      `'error'` event on `process.stdout`, exactly as it would for the host's own
 *      output; the seam deliberately registers no `'error'` listener, because one would
 *      change how the host dies.
 *   2. `env` never throws. A runtime that gates environment access may raise on read;
 *      the seam returns `undefined` in that case so `statusLine()` does not crash on
 *      construction under narrow permissions.
 *   3. Timers stay out. The seam owns `unrefTimer` but not `setInterval` — tests drive
 *      the global timers with `node:test` mock timers. The runtime must keep calling
 *      the *global* `setInterval`: mock timers do not intercept `node:timers` imports.
 */

import process from "node:process";

/**
 * Platform seam. All members must be total: no method throws, ever. `nodeIo` is
 * the only implementation in this package; `resolveIo` fills a partial override
 * (used by tests) from `nodeIo`.
 */
export interface Io {
	/** Write the whole string. Must not throw. */
	write(s: string): void;
	/** Terminal width in columns; a sane default (80) when unknown. */
	columns(): number;
	/** Whether stdout is a tty. */
	isTerminal(): boolean;
	/** `undefined` when unset OR when the runtime denies access — never throws. */
	env(key: string): string | undefined;
	/** Let the process exit even though `timer` (what `setInterval` returned) is pending. */
	unrefTimer(timer: unknown): void;
	/** Monotonic-enough ms; only ever compared to itself. */
	now(): number;
	/** Run `fn` at normal process exit (incl. `process.exit()`); returns an unsubscribe. */
	onExit(fn: () => void): () => void;
}

function positive(n: unknown): number | undefined {
	return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Node-backed `Io` (`node:*` only, so it runs wherever `node:process` does). Kept
 * internal so `mod.ts` never re-exports platform reach into the public surface;
 * consumers who need to inject a fake do so via `Io`.
 */
export const nodeIo: Io = {
	write(s: string): void {
		try {
			process.stdout.write(s);
		} catch {
			// stdout destroyed / anything else thrown synchronously — swallow.
		}
	},
	columns(): number {
		try {
			// stdout first; stderr covers `enabled: true` with stdout piped into a file.
			return (
				positive(process.stdout.columns) ?? positive(process.stderr.columns) ?? 80
			);
		} catch {
			return 80;
		}
	},
	isTerminal(): boolean {
		try {
			return process.stdout.isTTY === true;
		} catch {
			return false;
		}
	},
	env(key: string): string | undefined {
		try {
			return process.env[key];
		} catch {
			// a permission-gated runtime refused the read
			return undefined;
		}
	},
	unrefTimer(timer: unknown): void {
		try {
			(timer as { unref?: () => void } | null | undefined)?.unref?.();
		} catch {
			// swallow — timer already cleared, or not a Timeout.
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
		process.on("exit", handler);
		return () => {
			process.off("exit", handler);
		};
	},
};

/**
 * Merge a partial `Io` over `nodeIo`. Used by tests to override just the members
 * they care about while the rest defer to the real platform behaviour.
 */
export function resolveIo(partial?: Partial<Io>): Io {
	return { ...nodeIo, ...partial };
}
