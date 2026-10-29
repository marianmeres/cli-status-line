/**
 * The three SGR colours `paint()` uses, plus the `NO_COLOR` probe that decides
 * whether it uses them at all.
 *
 * This replaces `@std/fmt/colors`, which reads `NO_COLOR` only through
 * `Deno.noColor` and therefore ignores it on Node. Reading it through
 * `io.env` keeps the decision on the platform seam, where tests control it,
 * and leaves no module-level colour switch for one caller to flip under
 * another.
 */

import type { Io } from "./io.ts";

/**
 * Whether the animated line is coloured: `false` when `NO_COLOR` is set to a
 * non-empty value (per no-color.org), `true` otherwise.
 */
export function isColor(io: Io): boolean {
	const v = io.env("NO_COLOR");
	return v === undefined || v === "";
}

/** Wrap `s` in cyan (closes with the default-foreground code, not a full reset). */
export function cyan(s: string): string {
	return `\x1b[36m${s}\x1b[39m`;
}

/** Wrap `s` in yellow (closes with the default-foreground code, not a full reset). */
export function yellow(s: string): string {
	return `\x1b[33m${s}\x1b[39m`;
}

/** Wrap `s` in dim (closes with the normal-intensity code, not a full reset). */
export function dim(s: string): string {
	return `\x1b[2m${s}\x1b[22m`;
}
