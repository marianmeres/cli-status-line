/**
 * Renderer composition: a pure `layout()` that fits one status line into a
 * hard budget of `columns - 1`, plus a `paint()` that colours the fitted
 * parts. Colour lands only after truncation — ANSI escape bytes are counted
 * as columns by every terminal-width measure, so measuring a coloured string
 * would overshoot the budget.
 *
 * The layout order is fixed:
 *
 *     <spinner> <clock> · <counters> <label> <detail>
 *
 * Separators exist only between neighbours that survived the fit: `" · "`
 * between clock and counters when both are present, `" "` everywhere else.
 * The last column is left blank because many terminals auto-wrap when the
 * final column is written; that is why the budget is `columns - 1`.
 *
 * Degradation ladder when the whole does not fit:
 *
 *   1. truncate `detail` (ellipsis), keeping at least `MIN_TAIL = 8` columns
 *      for `label + detail` when the head allows it;
 *   2. drop `detail`, truncate `label` (ellipsis);
 *   3. drop `counters` and retry from 1;
 *   4. drop `clock` and retry from 1;
 *   5. spinner alone;
 *   6. `columns <= 1` — return all-empty parts. The caller writes only
 *      `\r\x1b[K`.
 *
 * `layout()` is side-effect free and does not read the terminal — it takes
 * `columns` so the runtime can re-read it per frame.
 */

import { cyan, dim, yellow } from "./colors.ts";
import { displayWidth, truncateToWidth } from "./width.ts";

/** Preferred minimum columns for `label + detail`; below this a tier is dropped. */
const MIN_TAIL = 8;

/**
 * Input to `layout()`. All fields are already caller-formatted: `spinner` is
 * one frame, `clock` is `"m:ss"` or omitted, each `counters[i]` is a
 * `"<count><glyph>"` string, and `label` / `detail` are already sanitized.
 */
export interface LayoutInput {
	spinner: string;
	clock?: string;
	counters?: string[];
	label?: string;
	detail?: string;
}

/**
 * What survived the fit. Every field is `""` when the segment was dropped;
 * `paint()` walks these fields and joins present segments with the right
 * separator.
 */
export interface LayoutParts {
	spinner: string;
	clock: string;
	counters: string;
	label: string;
	detail: string;
}

const EMPTY: LayoutParts = {
	spinner: "",
	clock: "",
	counters: "",
	label: "",
	detail: "",
};

function headWidth(spinner: string, clock: string, counters: string): number {
	let w = displayWidth(spinner);
	if (clock) w += (spinner ? 1 : 0) + displayWidth(clock);
	if (counters) {
		const sepBefore = spinner || clock ? (clock ? 3 : 1) : 0;
		w += sepBefore + displayWidth(counters);
	}
	return w;
}

function fitTail(
	label: string,
	detail: string,
	room: number,
): { label: string; detail: string } {
	if (label && detail) {
		const lw = displayWidth(label);
		if (lw + 1 + displayWidth(detail) <= room) return { label, detail };
		const detailRoom = room - lw - 1;
		if (detailRoom > 0) {
			const td = truncateToWidth(detail, detailRoom);
			if (td) return { label, detail: td };
		}
		const tl = truncateToWidth(label, room);
		return { label: tl, detail: "" };
	}
	if (label) {
		if (displayWidth(label) <= room) return { label, detail: "" };
		return { label: truncateToWidth(label, room), detail: "" };
	}
	if (detail) {
		if (displayWidth(detail) <= room) return { label: "", detail };
		return { label: "", detail: truncateToWidth(detail, room) };
	}
	return { label: "", detail: "" };
}

/**
 * Fit `input` into `columns` and return the surviving parts. Never returns
 * parts whose painted width exceeds `columns - 1`. Pure: no I/O, no globals.
 */
export function layout(input: LayoutInput, columns: number): LayoutParts {
	const budget = Math.max(0, columns - 1);
	if (budget === 0) return { ...EMPTY };

	const spinner = input.spinner ?? "";
	const clockStr = input.clock ?? "";
	const countersStr = (input.counters ?? []).join(" ");
	const label = input.label ?? "";
	const detail = input.detail ?? "";

	if (displayWidth(spinner) > budget) return { ...EMPTY };

	const tiers: Array<[string, string]> = [
		[clockStr, countersStr],
		[clockStr, ""],
		["", ""],
	];

	for (const [i, [c, co]] of tiers.entries()) {
		const isLast = i === tiers.length - 1;
		const hw = headWidth(spinner, c, co);
		if (hw > budget) continue;

		if (!label && !detail) {
			return { spinner, clock: c, counters: co, label: "", detail: "" };
		}

		const room = budget - hw - 1;
		if (room < 1) continue;
		if (room < MIN_TAIL && !isLast) continue;

		const tail = fitTail(label, detail, room);
		if (!tail.label && !tail.detail) continue;
		return { spinner, clock: c, counters: co, ...tail };
	}

	return { spinner, clock: "", counters: "", label: "", detail: "" };
}

/**
 * Colour the fitted parts and join with the layout separators. Colour is
 * applied here — after `layout()` has already measured and truncated — so
 * the escape bytes never inflate the width budget.
 *
 * spinner → cyan, clock/counters → dim, label → yellow, detail → dim.
 * With `color === false` (the runtime passes `isColor(io)`, i.e. `NO_COLOR`
 * unset or empty) the parts are joined plain; the structure is unchanged.
 */
export function paint(parts: LayoutParts, color: boolean): string {
	const { spinner, clock, counters, label, detail } = parts;
	const c = color ? { cyan, dim, yellow } : { cyan: plain, dim: plain, yellow: plain };
	const pieces: string[] = [];
	if (spinner) pieces.push(c.cyan(spinner));
	if (clock && counters) pieces.push(c.dim(`${clock} · ${counters}`));
	else if (clock) pieces.push(c.dim(clock));
	else if (counters) pieces.push(c.dim(counters));
	if (label) pieces.push(c.yellow(label));
	if (detail) pieces.push(c.dim(detail));
	return pieces.join(" ");
}

function plain(s: string): string {
	return s;
}
