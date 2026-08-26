# v1 Implementation Plan — `@marianmeres/cli-status-line`

This directory holds the **code-verified** implementation plan for v1 of the package, produced on
**2026-08-26** from the design proposal in `tmp/DESIGN-PROPOSAL.md` (gitignored) and the reference
implementation it generalizes (`@marianmeres/agents` at commit `c252835`,
`sprint/src/activity.ts`). It is a **planning artifact** — no source code was changed; the repo
was an unborn scaffold at the time. Every claim about the reference cites `file:line` and was
checked against the actual code and toolchain (Deno 2.9.5, `@std/cli` 1.0.32).

**Start here:** [`00-overview-and-roadmap.md`](./00-overview-and-roadmap.md) — the review of the
proposal, the ranked master plan, the first sprint, and the sequencing graph.

## Documents

| #  | Doc                                                                    | Scope                                           | Headline finding                                                                                 |
| -- | ---------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 00 | [overview-and-roadmap](./00-overview-and-roadmap.md)                   | Review + ranked roadmap                         | Proposal is sound; pure `layout()`, tick-only drawing, port before docs; four missed traps added |
| 01 | [renderer](./01-renderer.md)                                           | Width, fixed layout, degradation ladder, redraw | `layout(snapshot, columns)` as a pure function; hard `columns - 1` budget; `sanitize()`          |
| 02 | [io-and-lifecycle](./02-io-and-lifecycle.md)                           | `Io` seam, tty/fallback, stop/pause/log, cursor | `env()` must never throw; `onExit` in the seam; zero `console.*`; no signal listeners            |
| 03 | [verification-port-and-release](./03-verification-port-and-release.md) | Tests, sprint port, docs, JSR                   | Fake `Io` + `FakeTime` goldens; the port is the acceptance test and precedes the docs            |
| —  | [PROGRESS](./PROGRESS.md)                                              | Living tracker                                  | T01–T11 + decisions D1–D12                                                                       |

## How it was produced

Inline: read the proposal and all three reference files → verified each claimed defect and each
`@std` / Deno API the plan relies on (`deno doc`, `deno eval`) → cut or downgraded what was
already done or unneeded (noted in place as _"Downgraded from the draft"_) → synthesized the
overview and seeded the tracker.

> The proposal's six open questions are resolved in the `PROGRESS.md` Decisions log (D1–D13,
> incl. planner additions). All were confirmed by the owner in a decision interview on
> 2026-08-26; nothing is left `⏸️`. Amend with a dated entry if a call changes.
