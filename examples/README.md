# Examples

Runnable scripts, smallest first. Each one is self-contained — no arguments, no
setup — and each is built around a single question the API answers.

```sh
deno run examples/01-basic.ts
```

They import the package by its real name (`@marianmeres/cli-status-line`),
mapped to `./src/mod.ts` in this repository's `deno.json`, so the import line in
each file is the line you would write in your own project.

| Script                                                             | The question it answers                                                                         |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| [`01-basic.ts`](./01-basic.ts)                                     | What does the minimal thing look like?                                                          |
| [`02-counters-and-log.ts`](./02-counters-and-log.ts)               | How do I count things, and how do I print a real log line without colliding with the animation? |
| [`03-non-tty-fallback.ts`](./03-non-tty-fallback.ts)               | What lands in the log file when this runs under a pipe or in CI?                                |
| [`04-custom-fallback.ts`](./04-custom-fallback.ts)                 | How do I control that format instead of taking the built-in one?                                |
| [`05-narrow-terminal.ts`](./05-narrow-terminal.ts)                 | What comes off the line first when the terminal is too narrow?                                  |
| [`06-pause-for-prompt.ts`](./06-pause-for-prompt.ts)               | How do I ask the user something in the middle of a run?                                         |
| [`07-hide-cursor-and-signals.ts`](./07-hide-cursor-and-signals.ts) | How do I hide the cursor, and what do I owe the library in return?                              |

## Seeing both code paths

The interesting split is animated-vs-not, and you can see it from any of these
without changing a line:

```sh
deno run examples/02-counters-and-log.ts         # animated
deno run examples/02-counters-and-log.ts | cat   # notable lines only
CI=1 deno run examples/02-counters-and-log.ts    # same, on a tty
```

`COLUMNS=40` does **not** narrow the line — width comes from
`Deno.consoleSize()`, not the environment. Resize the terminal window, or see
[`05-narrow-terminal.ts`](./05-narrow-terminal.ts) for rendering at a chosen
width through the `io` seam.

## Related

[`../scripts/demo.ts`](../scripts/demo.ts) is the maintainer's eyeball check —
one script that exercises every path at once. These examples pull those paths
apart one per file.
