<!--
GENERATED ANALYSIS — @marianmeres/cli-status-line (v1 implementation plan)
Produced 2026-08-26 by inline research → verification against the reference implementation → synthesis.
Reference claims verified against @marianmeres/agents at commit c252835 (sprint/src/activity.ts, proc.ts, agent.ts).
This repository is an unborn scaffold (no commits yet); scaffold facts verified on disk. Planning artifact; no code was changed.
-->

# Renderer — layout, display width, and redraw

> The renderer is the part of the package that has to be _right_: given the current state and
> the terminal width, produce one line that never wraps, truncates by display columns rather
> than string length, and is coloured only after it has been cut. Everything else in the
> package is plumbing around this function.

> **Single most important takeaway:** make the composition a **pure function**
> `layout(snapshot, columns) → parts`, with colour applied afterwards by a separate `paint()`.
> That is what makes the degradation ladder, the never-wrap guarantee, and the width math
> testable as plain string assertions — and it is the shape the reference implementation
> ([activity.ts:115-130](/Users/mm/projects/@marianmeres/agents/sprint/src/activity.ts#L115-L130))
> almost has already, minus the two width bugs.

> **Headline recommendation:** fixed layout, no segment system (decision D1); draw only on the
> interval tick, never synchronously on `set()` (decision D4) — that removes the proposal's
> coalescing/dirty-flag machinery entirely instead of implementing it.

## Summary of recommendations

| # | Recommendation                                                                                                 | Value | Effort | Risk |
| - | -------------------------------------------------------------------------------------------------------------- | ----- | ------ | ---- |
| 1 | `src/width.ts`: grapheme-aware `truncateToWidth()` + `sanitize()` on top of `@std/cli/unicode-width`           | high  | S      | low  |
| 2 | `layout()` pure composer: fixed layout, degradation ladder, hard `columns - 1` budget, colour after truncation | high  | M      | med  |
| 3 | Tick-only redraw with `columns()` re-read per frame; no draw on `set()`/`inc()`                                | high  | S      | low  |

## Findings & recommendations (detailed)

### 1. Display-width helpers (`src/width.ts`)

- **Problem / observation** — The reference truncates with `.slice()`, which counts UTF-16 code
  units, not columns. A CJK path or an emoji in a Bash command overflows the line, the terminal
  wraps, and `\r` then returns to the start of the wrong row. It can also sever a surrogate pair.
- **Evidence** —
  [activity.ts:123](/Users/mm/projects/@marianmeres/agents/sprint/src/activity.ts#L123):
  `detail = detail.slice(0, Math.max(0, room - tool.length - 2)) + "…"`, and
  [activity.ts:119](/Users/mm/projects/@marianmeres/agents/sprint/src/activity.ts#L119):
  `columns() - head.length - 1` (same bug on the head).
  Measured with `@std/cli@1.0.32` `unicodeWidth`: `"天地"` → width 4, length 2; `"😀"` → 2, 2;
  `"é"` (e + combining) → 1, 2; `"\x1b[36m⠋\x1b[39m"` → **9**, i.e. escape codes count as
  columns, which is why colour must go on after measuring.
- **Proposed change** — three small pure functions, all exported for tests but not from `mod.ts`:

  ```ts
  /** Columns a string occupies on a terminal. Wraps `unicodeWidth` from `@std/cli/unicode-width`. */
  export function displayWidth(s: string): number;

  /**
   * Cut `s` so that `displayWidth(result) <= max`, appending `ellipsis` when anything was cut.
   * Iterates graphemes (`Intl.Segmenter`), never splits a surrogate pair or a combining sequence.
   * `max < displayWidth(ellipsis)` returns "" — the caller decides whether to drop the segment.
   */
  export function truncateToWidth(s: string, max: number, ellipsis = "…"): string;

  /**
   * One line, one space between words: collapses all whitespace (incl. newlines) to a single
   * space, strips C0/C1 control characters and ESC sequences. A newline in `detail` would
   * otherwise break the single-line contract — the library cannot rely on callers doing this.
   */
  export function sanitize(s: string): string;
  ```

  `sanitize` is the library-side equivalent of sprint's `flat()`
  ([activity.ts:47](/Users/mm/projects/@marianmeres/agents/sprint/src/activity.ts#L47)), minus
  the `max = 200` cap (the layout caps by width). Sprint keeps its own `flat()` for the
  interpreter; the renderer must not trust it.
- **Done when** — `tests/width.test.ts` passes with cases for: ASCII, CJK, emoji, combining mark,
  a string containing ANSI codes (sanitized out), `max` smaller than the ellipsis, `max = 0`, and a
  loop asserting `displayWidth(truncateToWidth(s, n)) <= n` for every `n` in `0..displayWidth(s)+2`.
- **Affected files** — `src/width.ts` (new), `tests/width.test.ts` (new), `deno.json` (add
  `@std/cli`).
- **Effort / Value / Risk** — S / high / low.
- **Implementation notes** — `Intl.Segmenter` is available in Deno 2.x (verified `typeof
  Intl.Segmenter === "function"`). Do not use `@std/cli/unstable-spinner` for anything: it is
  `@experimental` and does frames + message only (verified via `deno doc`). Glyph trap, measured:
  `"⚒"` → width 1 but `"⚒️"` (with U+FE0F) → `unicodeWidth` says 1 while most terminals render 2.
  Counter glyphs must be text-presentation; document that in the JSDoc for `counters`.

### 2. Fixed layout + degradation ladder as a pure function

- **Problem / observation** — The reference guarantees a _minimum_ tail (`Math.max(8, …)`) but
  no _maximum_ total: with a narrow terminal the head alone exceeds the width, `room` bottoms out
  at 8, the label is never truncated, and the line wraps. Once it wraps, every subsequent `\r`
  redraws on the wrong row and the screen fills with litter.
- **Evidence** —
  [activity.ts:118-124](/Users/mm/projects/@marianmeres/agents/sprint/src/activity.ts#L118-L124):
  `room = Math.max(8, columns() - head.length - 1)`; only `detail` is ever cut, `tool` never is,
  and `head` is never reconsidered. Colour-after-truncation is already correct there
  ([activity.ts:117](/Users/mm/projects/@marianmeres/agents/sprint/src/activity.ts#L117)) — keep it.
- **Proposed change** — one pure composer plus one painter, in `src/layout.ts`:

  ```ts
  export interface LayoutInput {
  	spinner: string; // one frame, already chosen by the caller
  	clock?: string; // "m:ss" or undefined when disabled
  	counters: string[]; // already formatted, e.g. ["12⚒"]; [] when none declared
  	label: string; // sanitized
  	detail: string; // sanitized
  }
  export interface LayoutParts { // what actually fits; each field is "" when dropped
  	spinner: string;
  	clock: string;
  	counters: string;
  	label: string;
  	detail: string;
  }
  /** Never returns parts wider than `columns - 1`. `columns <= 1` → spinner only or nothing. */
  export function layout(input: LayoutInput, columns: number): LayoutParts;
  /** Joins with separators and applies colour: spinner cyan, clock+counters dim, label yellow, detail dim. */
  export function paint(parts: LayoutParts): string;
  ```

  Composition, left to right, with a budget of `columns - 1` (the last column is left free
  because many terminals auto-wrap when it is written — the reference's `- 1` is doing this):

  ```
  <spinner> <clock> · <counters> <label> <detail>
  ```

  Separators only exist between present neighbours: `" · "` between clock and counters only when
  both are present; `" "` between label and detail only when both are non-empty (the reference's
  `${tool && detail ? " " : ""}`,
  [activity.ts:127](/Users/mm/projects/@marianmeres/agents/sprint/src/activity.ts#L127)).

  Degradation order when the whole does not fit (proposal §4, unchanged):

  1. truncate `detail` (ellipsis) — but keep at least `MIN_TAIL = 8` columns for `label + detail`
     if the head allows it;
  2. drop `detail`, truncate `label` (ellipsis);
  3. drop `counters` and retry from 1;
  4. drop `clock` and retry from 1;
  5. spinner alone;
  6. `columns <= 1`: return all-empty parts — the runtime then writes only `\r\x1b[K`.

  Clock format stays the reference's unbounded `m:ss`
  ([activity.ts:110-113](/Users/mm/projects/@marianmeres/agents/sprint/src/activity.ts#L110-L113));
  `125:07` after two hours is fine and the port requires "visually identical". Counters render as
  `<count><glyph>` joined by a single space, in declaration order.
- **Done when** — `tests/layout.test.ts` passes: golden `layout()` outputs at widths
  200 / 80 / 40 / 24 / 16 / 10 / 6 / 3 / 2 / 1 / 0 for one long CJK-containing input, plus a
  property loop over random labels/details/widths asserting
  `displayWidth(join(parts)) <= max(0, columns - 1)` and that `paint()` output with colour disabled
  equals the plain join.
- **Affected files** — `src/layout.ts` (new), `tests/layout.test.ts` (new), `deno.json` (add
  `@std/fmt`).
- **Effort / Value / Risk** — M / high / med. Risk is the ladder's edge cases, which is exactly
  what the golden tests pin.
- **Implementation notes** — `paint()` uses `cyan`/`dim`/`yellow` from `@std/fmt/colors`; it
  respects `NO_COLOR` on its own and tests switch it off with `setColorEnabled(false)` (verified
  export). `layout()` must be side-effect free and must not read the terminal — it receives
  `columns` so the runtime can re-read it per frame (finding 3). A segment/priority system was
  considered and rejected (decision D1): one consumer, a fixed order, and the pure-function seam
  makes swapping it in later a local change.

### 3. Redraw scheduling: tick-only, re-read `columns()` every frame

- **Problem / observation** — The reference redraws synchronously on every stream event — one
  `writeSync` per NDJSON line for frames nobody can see — _and_ on the timer. The proposal asks
  for coalescing via a dirty flag. There is a simpler answer: never draw on an update at all. The
  timer already fires every `intervalMs` (default 100 ms) and _must_ redraw anyway because the
  spinner frame changed, so the worst-case latency of an update is one interval, which is
  imperceptible for a status line.
- **Evidence** —
  [activity.ts:151](/Users/mm/projects/@marianmeres/agents/sprint/src/activity.ts#L151):
  `if (tty) render();` inside `onLine`;
  [activity.ts:133](/Users/mm/projects/@marianmeres/agents/sprint/src/activity.ts#L133): the
  interval also renders. Two independent draw paths, no coalescing.
- **Proposed change** — `set()` / `inc()` mutate state only. The tick does
  `frame = (frame + 1) % frames.length; columns = io.columns(); io.write("\r" + paint(layout(...)) + "\x1b[K")`.
  One initial draw happens in `statusLine()` so the line exists before the first tick
  (mirrors [activity.ts:135](/Users/mm/projects/@marianmeres/agents/sprint/src/activity.ts#L135)).
  `log()` and `resume()` do not redraw either; the next tick does. Re-reading `columns()` every
  tick handles resize with no `SIGWINCH` listener (proposal §6.7 — agreed, it costs nothing at
  10 Hz and a listener is a resource the library would then own).

  This resolves the proposal's open question 4 ("immediate first draw after a quiet period?") as
  **not needed**: there is no quiet period to detect because the tick never stops while the line
  is live. Callers who pass a large `intervalMs` get proportionally slower updates; document that.
- **Done when** — A test with `FakeTime` (see `03-verification-port-and-release.md` #1) asserts
  that ten `set()` calls between two ticks produce exactly one write (the tick's), that the write
  reflects the last `set()`, and that changing the fake `columns()` between ticks changes the
  next frame's width.
- **Affected files** — `src/status-line.ts` (the runtime; detail in
  `02-io-and-lifecycle.md` #3).
- **Effort / Value / Risk** — S / high / low.
- **Implementation notes** — The `dirty` flag survives only with its _other_ meaning from the
  reference ([activity.ts:108](/Users/mm/projects/@marianmeres/agents/sprint/src/activity.ts#L108)):
  "something is on the current line and needs erasing", consulted by `stop()`, `log()`, `pause()`.

## Open questions / decisions needed

All resolved at PLAN time, recorded in [`PROGRESS.md`](./PROGRESS.md) → Decisions log, and
ratified by the owner on 2026-08-26. Relevant here: **D1** fixed layout, **D4** tick-only
drawing, **D10** library-side sanitization.
