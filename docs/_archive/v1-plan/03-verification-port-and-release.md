<!--
GENERATED ANALYSIS — @marianmeres/cli-status-line (v1 implementation plan)
Produced 2026-08-26 by inline research → verification against the reference implementation → synthesis.
Reference claims verified against @marianmeres/agents at commit c252835 (sprint/src/activity.ts, proc.ts, agent.ts).
This repository is an unborn scaffold (no commits yet); scaffold facts verified on disk. Planning artifact; no code was changed.
-->

# Verification, the sprint port, docs, and release

> The proposal's definition of done is not "tests are green" — it is that
> `sprint/src/activity.ts` becomes a thin adapter over this package with no loss of behaviour.
> This doc covers the two halves of that proof: the byte-exact test strategy that the renderer
> and lifecycle docs lean on, and the port itself, followed by the docs and JSR release steps
> that turn it into an ecosystem package.

> **Single most important takeaway:** do the port _inside_ this plan (T08), before the docs are
> written, because it is the only consumer and the only honest test that the
> interpreter/renderer seam landed in the right place. Expect it to send one or two small API
> corrections back into `src/` — that is the point.

> **Headline recommendation:** one fake `Io` + `FakeTime` + `setColorEnabled(false)` gives
> deterministic, byte-exact goldens for every behaviour in docs 01 and 02; no snapshot files, no
> tty needed in CI.

## Summary of recommendations

| # | Recommendation                                                                               | Value | Effort | Risk |
| - | -------------------------------------------------------------------------------------------- | ----- | ------ | ---- |
| 1 | Test harness: memory `Io` fake + `FakeTime` + colour off; goldens over the byte stream       | high  | S      | low  |
| 3 | Port `sprint/src/activity.ts` to a thin adapter; acceptance per proposal §9                  | high  | M      | med  |
| 4 | README (human guide) + AGENTS.md (agent guide) against the frozen API                        | high  | M      | low  |
| 2 | Public surface: `mod.ts`, JSDoc on every export, `deno publish --dry-run`, `scripts/demo.ts` | med   | S      | low  |
| 5 | Release 0.1.0 to JSR (human-only), then flip sprint's import to `jsr:`                       | high  | S      | low  |

## Findings & recommendations (detailed)

### 1. Test harness and strategy

- **Problem / observation** — The reference has no tests
  (`sprint/tests/` holds `tracker_test.ts` and `e2e.sh` only) and could not have any: it writes
  straight to `Deno.stdout`. The whole value of the `Io` seam is realised here.
- **Evidence** — `sprint/tests/` listing; every `Deno.*` call in
  [activity.ts](/Users/mm/projects/@marianmeres/agents/sprint/src/activity.ts) is unmockable.
  Verified available: `FakeTime` in `jsr:@std/testing/time` (controls `setInterval` and
  `Date.now()`), `setColorEnabled`/`stripAnsiCode` in `jsr:@std/fmt/colors`.
- **Proposed change** — `tests/_fake-io.ts`:

  ```ts
  export function fakeIo(
  	over: Partial<Io> & { tty?: boolean; cols?: number } = {},
  ): Io & {
  	out: string[]; // every write, in order
  	bytes(): string; // out.join("")
  	exitFns: (() => void)[]; // what onExit registered (and not yet unsubscribed)
  	unrefd: number[]; // timer ids passed to unrefTimer
  	set(partial: { cols?: number; env?: Record<string, string> }): void;
  };
  ```

  Every suite: `setColorEnabled(false)` in `beforeAll` (one dedicated test asserts colour
  placement with it on, via `stripAnsiCode` to compare the plain text and a regex to check that
  the escape codes wrap whole segments). `using time = new FakeTime()` and `time.tick(100)` to
  drive frames. Assertions are on `io.bytes()` or `io.out` — exact strings including `\r` and
  `\x1b[K`, written inline in the test (no snapshot files: the streams are short and a reader
  should see the bytes next to the behaviour they pin).

  Suites map 1:1 onto the findings: `width`, `layout`, `io`, `status-line`, `fallback`, `cursor`.
- **Done when** — `deno task test` runs all six suites green; `deno test --coverage` shows
  `src/layout.ts` and `src/width.ts` at 100 % line coverage (they are pure; anything uncovered is
  an untested branch of the ladder).
- **Affected files** — `tests/_fake-io.ts`, the six suites, `deno.json` (`@std/testing`).
- **Effort / Value / Risk** — S / high / low.

### 2. Public surface, JSDoc, publish dry-run, demo

- **Problem / observation** — JSR scores packages on documentation and refuses slow types; the
  scaffold already fails `deno lint` on `no-slow-types`
  (`src/cli-status-line.ts:1`, verified). The scaffold's `deno.json` also carries two unused
  imports (`@std/fs`, `@std/path`, lines 15-16).
- **Evidence** — `deno lint` output on the scaffold; `deno.json:13-17`.
- **Proposed change** —
  - `src/mod.ts` exports exactly: `statusLine`, `StatusLine`, `StatusLineOptions`,
    `FallbackPolicy`, `StatusSnapshot`, `Io`, `BRAILLE_FRAMES`, `ASCII_FRAMES`. Nothing from
    `width.ts`/`layout.ts`/`fallback.ts`.
  - Module-level JSDoc on `mod.ts` with the "is it still alive?" paragraph and one runnable
    example; JSDoc on every exported symbol and every option, including the `hideCursor` signal
    contract and the counter-glyph width note.
  - `deno.json`: drop `@std/fs`/`@std/path`; final imports are `@std/cli`, `@std/fmt`,
    `@std/assert`, `@std/testing`. Add `"lint"`, `"check"` tasks if the sibling packages have
    them (mirror `clog`).
  - `scripts/demo.ts`: a ~30-line script that runs the line for a few seconds with fake activity,
    a `log()` in the middle, a `pause()`/`resume()`, and `stop({ text })`; run it also with
    `| cat` and with `COLUMNS` narrowed to eyeball the ladder. It is the manual check the goldens
    cannot replace.
- **Done when** — `deno lint`, `deno fmt --check`, `deno publish --dry-run` all exit 0;
  `deno doc --lint src/mod.ts` reports no missing JSDoc; `deno run scripts/demo.ts` renders
  cleanly on a tty and produces only notable lines with `| cat`.
- **Affected files** — `src/mod.ts`, `deno.json`, `scripts/demo.ts` (new).
- **Effort / Value / Risk** — S / med / low.

### 3. The port back into sprint (acceptance)

- **Problem / observation** — The proposal §9 defines done as: `activity.ts` becomes a thin
  adapter, interpreter functions stay, non-tty log form still appears, stderr / `.runs` capture /
  `resultEvent()` untouched, visually identical on a tty.
- **Evidence** — Interpreter to keep unchanged:
  [`flat`](/Users/mm/projects/@marianmeres/agents/sprint/src/activity.ts#L47),
  [`short`](/Users/mm/projects/@marianmeres/agents/sprint/src/activity.ts#L50-L54),
  [`detailOf`](/Users/mm/projects/@marianmeres/agents/sprint/src/activity.ts#L56-L79),
  [`describe`](/Users/mm/projects/@marianmeres/agents/sprint/src/activity.ts#L82-L99).
  Renderer to replace: [`startActivity`](/Users/mm/projects/@marianmeres/agents/sprint/src/activity.ts#L101-L169).
  Wiring that must not change:
  [agent.ts:115-124](/Users/mm/projects/@marianmeres/agents/sprint/src/agent.ts#L115-L124)
  (`startActivity()` / `onLine` / `stop()`, stderr captured when the line is on) and
  [agent.ts:129-132](/Users/mm/projects/@marianmeres/agents/sprint/src/agent.ts#L129-L132)
  (`.runs` capture). Sprint's `deno.json` imports only `@std/assert` and `@std/fmt`
  (verified) — the new dependency is added there.
- **Proposed change** — `activity.ts` keeps its exported `Activity` type and `startActivity()`
  signature so `agent.ts` does not change. Inside:

  ```ts
  import { statusLine } from "@marianmeres/cli-status-line";

  export function startActivity(): Activity {
  	const line = statusLine({
  		counters: { tools: "⚒" },
  		// Redirected output keeps its exact historical form (three-space indent, 160 chars).
  		fallback: (s) => s.notable ? `   ⋯ ${s.clock} ${s.label} ${s.detail}` : null,
  	});
  	line.set("session", "starting");
  	return {
  		onLine(raw) {
  			let ev;
  			try {
  				ev = JSON.parse(raw);
  			} catch {
  				return;
  			}
  			const next = describe(ev);
  			if (!next) return;
  			if (next.isTool) line.inc("tools");
  			line.set(next.tool, next.detail, { notable: !!next.isTool });
  		},
  		stop: () => line.stop(),
  	};
  }
  ```

  Dependency wiring: during development, map `"@marianmeres/cli-status-line"` to
  `"../cli-status-line/src/mod.ts"` in `sprint/deno.json` (sprint is private and never
  published, so a path mapping is legitimate there); after T10 flip it to
  `jsr:@marianmeres/cli-status-line@^0.1` (T11).
- **Done when** — `activity.ts` contains no `Deno.stdout`, `writeSync`, `setInterval`,
  `consoleSize` or `\x1b` (`grep -cE 'Deno\.stdout|writeSync|setInterval|consoleSize|x1b' activity.ts`
  → 0, except `Deno.cwd()` in `short()`); `sprint/tests/e2e.sh` passes as before; a manual run
  with `--activity` on a tty and one with `> log` both look as they did (compare the log form
  byte-for-byte against a pre-port capture).
- **Affected files** — `sprint/src/activity.ts`, `sprint/deno.json`. Nothing else in sprint.
- **Effort / Value / Risk** — M / high / med. The risk is discovering the API is subtly wrong for
  the consumer; that is the intended outcome, and fixes flow back into `src/` under the same
  task before it is marked done.
- **Implementation notes** — Sprint's `flat()` stays on the interpreter side; the library
  sanitizes again, harmlessly. The old code counted the tool _before_ `set()` — order does not
  matter now that drawing is tick-only.

### 4. Documentation: README and AGENTS.md

- **Problem / observation** — `README.md` is one line (the package name). No AGENTS.md.
- **Proposed change** — After the port (API frozen): README per the human docs guide
  (`/Users/mm/projects/@marianmeres/agents/mm-local-docs/HUMAN_DOCUMENTATION_GUIDE.md`) — what it
  is, the rendered-shape diagram from the proposal, install, a 10-line example, options table,
  the non-tty behaviour, the `hideCursor` contract, "Deno only, why", and the "not a segment
  system / no multi-line / no progress bars" scope statement. AGENTS.md per the agent docs guide
  (`…/AGENT_DOCUMENTATION_GUIDE.md`). Neither doc mentions sprint by path or any private package;
  describe the origin generically ("extracted from an internal driver").
- **Done when** — Both files exist and follow their guide's structure; every code block in the
  README runs (`deno check` on extracted snippets, or `deno test --doc` if the guide asks for
  doc-tests); the README shows the actual `deno.json` import line.
- **Affected files** — `README.md`, `AGENTS.md` (new).
- **Effort / Value / Risk** — M / high / low.

### 5. Release and the post-release import flip

- **Problem / observation** — This is the first public, irreversible step. `deno.json:5-12`
  already carries the ecosystem's `release`/`publish`/`rp` tasks (verified npm-free).
- **Proposed change** — Run the pre-release checklist
  (`/Users/mm/projects/@marianmeres/agents/mm-local-docs/PRE_RELEASE_DOCS_UPDATE.md`), confirm
  `deno publish --dry-run` is clean, then `deno task rp` (human-only). Then T11: switch sprint's
  import mapping from the local path to `jsr:@marianmeres/cli-status-line@^0.1`, re-run the
  sprint e2e.
- **Done when** — `https://jsr.io/@marianmeres/cli-status-line` shows 0.1.0; `sprint/deno.json`
  references `jsr:` and `sprint/tests/e2e.sh` passes.
- **Affected files** — `deno.json` (version bump by the release tool), `sprint/deno.json`.
- **Effort / Value / Risk** — S / high / low.

## Open questions / decisions needed

All resolved at PLAN time, recorded in [`PROGRESS.md`](./PROGRESS.md) → Decisions log, and
ratified by the owner on 2026-08-26. Relevant here: **D3** no `succeed()`/`fail()` sugar
in v1; **D12** sprint keeps its byte-identical redirected form through a custom fallback function
rather than the library growing an indentation option.
