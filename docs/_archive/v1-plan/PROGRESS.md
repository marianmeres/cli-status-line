# Implementation Progress — cli-status-line v1

<!-- tracker: v1 -->

Living tracker for acting on [`00-overview-and-roadmap.md`](./00-overview-and-roadmap.md).
A fresh conversation should read this file first, then the relevant `NN-*.md` section.

**Status legend:** ⬜ ready · 🚧 in progress · ⏸️ blocked/awaiting decision · 🔒 human-only · ✅ done · ⏭️ deferred

> Convention: one branch per sprint, one commit per task. Each task resolves its source doc's
> "Open questions" first (record in the Decisions log), then implement → verify → tick here.

> **Precondition (owner, once):** the repository is unborn — commit the scaffold plus this
> `docs/v1-plan/` directory on `master` first, or there is no commit for a sprint branch to start
> from. The scaffold's placeholder `src/cli-status-line.ts` fails `deno lint` (`no-slow-types`),
> which is why `deno lint` is not a sprint-1 `Verify:` line; T01 deletes the placeholder and
> sprint 2 adds the lint check.

> **Driver caveat — RESOLVED 2026-08-26 (`@marianmeres/agents` 3dd85de).** This tracker follows
> `sprint/SPEC.md` §1. The driver's parser used to lag the spec in two places (`🔒` missing from
> `STATUS`, `Deps` never read), which is what D13 was about; both are now patched upstream, so
> this plan runs unmodified. Row order here is topological anyway.

## First sprint (core: seam, width, layout, runtime, fallback)

Branch: `v1-core`
Options: --max-tasks 5 --budget 40 --model claude-opus-5
Verify: deno task test
Verify: deno fmt --check

| Status | ID  | Deps    | Task                                                                                                                                                               | Source                            | Commit  |
| ------ | --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- | ------- |
| ✅     | T01 | —       | `src/io.ts`: `Io` interface, `denoIo` (drain loop, non-throwing `env`, `onExit`), `resolveIo`; `tests/_fake-io.ts`; delete scaffold placeholders                   | [02](./02-io-and-lifecycle.md) #1 | beb9e89 |
| ✅     | T02 | —       | `src/width.ts`: `displayWidth`, grapheme-safe `truncateToWidth`, `sanitize`; add `@std/cli`                                                                        | [01](./01-renderer.md) #1         | bca52e3 |
| ✅     | T03 | T02     | `src/layout.ts`: pure `layout()` with the degradation ladder and hard `columns - 1` budget; `paint()` colours after truncation; add `@std/fmt`                     | [01](./01-renderer.md) #2         | b3808af |
| ✅     | T04 | T01 T03 | `src/status-line.ts`: `statusLine()` runtime — tick-only draw, unref'd interval, `set`/`inc`, `log`, `pause`/`resume`, `stop`, post-stop no-ops, never-throw       | [02](./02-io-and-lifecycle.md) #3 | 3f0e422 |
| ✅     | T05 | T04     | `src/fallback.ts`: enabled detection (`isTerminal`, `TERM=dumb`, `CI`, `enabled` override) and `silent`/`notable`/custom policies via `io.write`; zero `console.*` | [02](./02-io-and-lifecycle.md) #2 | b092de2 |

T04 also carries the redraw-scheduling finding [01](./01-renderer.md) #3 (tick-only drawing,
`columns()` re-read per tick); its `Done when` is the union of both sections.

## Second sprint (contract, surface, port, docs, release)

Branch: `v1-release`
Options: --max-tasks 5 --budget 40
Verify: deno lint

| Status | ID  | Deps    | Task                                                                                                                                                 | Source                                         | Commit  |
| ------ | --- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------- |
| ✅     | T06 | T04     | `hideCursor` opt-in: hide at start, restore in `stop()` and via `io.onExit`; no signal listeners; JSDoc the host contract                            | [02](./02-io-and-lifecycle.md) #4              | 628cf75 |
| ✅     | T07 | T05 T06 | Public surface: `mod.ts` exports, JSDoc on every export/option, drop unused `@std/fs`/`@std/path`, `deno publish --dry-run` clean, `scripts/demo.ts` | [03](./03-verification-port-and-release.md) #2 | bb1f0e8 |
| ✅     | T08 | T07     | Port `sprint/src/activity.ts` to a thin adapter (path-mapped import); acceptance per proposal §9; API corrections flow back into `src/`              | [03](./03-verification-port-and-release.md) #3 | fc955be |
| ✅     | T09 | T08     | `README.md` per the human docs guide, `AGENTS.md` per the agent docs guide; no private-package or sprint path mentions                               | [03](./03-verification-port-and-release.md) #4 | d8a33e6 |
| ✅     | T10 | T09     | Pre-release checklist, `deno task rp` → 0.1.0 on JSR                                                                                                 | [03](./03-verification-port-and-release.md) #5 | —       |
| 🔒     | T11 | T10     | Flip `sprint/deno.json` import from the local path to `jsr:@marianmeres/cli-status-line@^0.1`; re-run sprint e2e                                     | [03](./03-verification-port-and-release.md) #5 | —       |

Sprint 2 inherits sprint 1's `Verify:` lines (`deno task test`, `deno fmt --check`) and adds
`deno lint`. **Lint debt — cleared in T06:** `deno lint` used to report five `no-control-regex`
errors in `src/width.ts` (the ANSI/control-char regexes, all intentional); T06 added a
`deno-lint-ignore-file no-control-regex` and the new `Verify:` line has passed since.
T08 changed `sprint/src/activity.ts` and `sprint/deno.json` in `@marianmeres/agents`, not in this
repository — landed by hand there as `c828cca`; only the API corrections came back into `src/`.
T10 and T11 are one human sitting: publish, then point sprint at the published version — T11 is
marked human-only because it is a two-line edit in another repo that must not run before T10.
**T10 landed 2026-08-26**: `0.1.0` is live on JSR (no commit hash — the publish did not change
this repository). T11 is still open; `sprint/deno.json` continues to resolve the package by
workspace path.

**Sprint 2 closed 2026-08-26.** T06–T09 done and merged to `master`; verification at merge time:
110 tests pass, `deno fmt --check` clean, `deno lint` clean, `deno check src/ tests/ scripts/
examples/` clean, `deno publish --dry-run` succeeds. T10 has since landed (0.1.0 published to
JSR on 2026-08-26). Only T11 remains open, by design: `sprint/deno.json` still resolves
`@marianmeres/cli-status-line` by workspace path, which works today, so T11 is the switch to the
published version, not a fix. Nothing in this repository is blocked on it.

## Backlog (ranked, post-sprint)

| Status | ID  | Rank | Task                                                                                             | Source                                      |
| ------ | --- | ---- | ------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| ⏭️     | T12 | 12   | `succeed()`/`fail()`/`warn()` terminal-state sugar over `stop({ text })`                         | [00](./00-overview-and-roadmap.md) deferred |
| ⏭️     | T13 | 13   | Node adapter in `src/io.ts` (detect Deno first, duck-typed `process`, `unrefTimer(id: unknown)`) | [00](./00-overview-and-roadmap.md) deferred |
| ⏭️     | T14 | 14   | Segment/priority layout system replacing the fixed `layout()`                                    | [00](./00-overview-and-roadmap.md) deferred |

Revisit triggers — do not re-propose without one: **T12** a second consumer asks for the sugar;
**T13** a Node consumer exists (every consumer is Deno today; the seam makes it an afternoon in
one file with no public API change); **T14** a caller needs a different order than
`spinner clock counters label detail`.

## Decisions log

- **2026-08-26** — **D1** Fixed layout, no segment/priority system — one consumer, a fixed
  order, and the pure `layout()` seam makes a later swap a local change (proposal §4, open q. 1).
- **2026-08-26** — **D2** Keep declared counters + `inc()`; no caller-formatted `stats` string —
  the mechanism is ~15 lines, sprint's `12⚒` is the proven use, and declaring up front keeps the
  width math stable (open q. 2).
- **2026-08-26** — **D3** No `succeed()`/`fail()`/`warn()` sugar in v1 — `stop({ text })` covers
  it; deferred as T12 (open q. 3).
- **2026-08-26** — **D4** Draw only on the interval tick; `set()`/`inc()` never write — worst-case
  update latency is one `intervalMs` (100 ms), imperceptible, and it deletes the coalescing/dirty
  machinery. The "immediate first draw after a quiet period" question is moot: the tick never
  stops while the line is live. One initial draw at construction (open q. 4).
- **2026-08-26** — **D5** Direct `io.write` for everything, including fallback lines; zero
  `console.*` in `src/`, so the ecosystem's clog rule (ecosystem.md:65) does not apply (open q. 5).
- **2026-08-26** — **D6** Deno-only v1; already enacted by the owner (`deno.json` has no npm
  tasks). Keep the `Io` seam regardless — tests need it and it makes T13 cheap (open q. 6).
- **2026-08-26** — **D7** `hideCursor` defaults to `false`; when on, restore via `stop()` and
  `io.onExit`; the library never registers signal listeners (a Deno `SIGINT` listener disables
  default termination) — the host owns signals (proposal §6.3, planner-confirmed).
- **2026-08-26** — **D8** `inc()` on an undeclared key is a silent no-op — the never-throw rule
  outranks typo detection; document it (planner addition).
- **2026-08-26** — **D9** Animated iff `enabled ?? (isTerminal() && TERM !== "dumb" && CI not
  set)` where "set" means any value other than `""`, `"0"`, `"false"`; `enabled: true` forces
  animation even off-tty (planner addition, from proposal §6.2).
- **2026-08-26** — **D10** The library sanitizes `label`/`detail` itself (collapse whitespace
  incl. newlines, strip control/ESC chars) — a newline would break the single-line contract and a
  library cannot rely on the caller's `flat()` (planner addition).
- **2026-08-26** — **D11** Timers stay out of the `Io` seam; tests drive them with `FakeTime`
  from `@std/testing/time`. The seam gains `onExit(fn) → unsubscribe` and `env()` that never
  throws (`Deno.env.get` throws `NotCapable` without `--allow-env`, verified) (planner addition).
- **2026-08-26** — **D12** Sprint keeps its byte-identical redirected form (`⋯ m:ss label
  detail`) through a custom fallback function; the library's built-in `notable` form has no
  indentation and no consumer-specific shape (planner addition).

- **2026-08-26** — **D13** Tracker keeps the `🔒` rows (T10, T11) per `sprint/SPEC.md`; the
  driver gets patched (`🔒` in `STATUS`, `Deps` gating) before any automated run of this plan —
  owner's call at the decision interview.
- **2026-08-26** — **D14** The published tarball ships `src/` + `README.md` + `LICENSE` only;
  `deno.json` gains `publish.exclude` for `.*`, `tests/**`, `docs/**`, `scripts/**`,
  `examples/**`, `tmp/**`. The v1 plan docs are repository history, not package payload, and
  `docs/v1-plan/` alone was ~54 KB of the dry-run manifest (finalisation pass, owner-confirmed).
- **2026-08-26** — **D15** `deno.json` maps `@marianmeres/cli-status-line` → `./src/mod.ts` so
  `examples/` import the package by its real name and are copy-pasteable as written; the same
  self-mapping convention as `@marianmeres/fsm` (finalisation pass).
- **2026-08-26** — **Ratified.** D1–D12 were proposed at PLAN time and confirmed one by one by
  the owner in an interactive decision interview the same day; no defaults changed. Every task
  is runnable (`⬜`) except the human-only `🔒` rows.

## How to resume (for a fresh conversation)

1. Read this file + `00-overview-and-roadmap.md`.
2. Pick the first ⬜ task whose `Deps` are all ✅ (or the `T##` you were given); open its source
   doc section for the detail and its **Done when** criterion.
3. Resolve that task's "Open questions" with the owner; record in the Decisions log.
4. Branch → implement → run the `Verify:` commands → update this file → commit when the owner asks.
