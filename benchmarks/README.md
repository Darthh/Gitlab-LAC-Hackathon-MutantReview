# Historical evaluation

The Mutant Review gate was run over the latest 25 eligible merged PRs of [toss/es-toolkit](https://github.com/toss/es-toolkit) (MIT) before the 2026-10-23T23:59:59Z cutoff. **Results, methodology and limitations: [RESULTS.md](RESULTS.md).** Machine-readable record of every considered PR, including exclusions and failures: [`results/es-toolkit.json`](results/es-toolkit.json); raw Stryker reports under 300 KB in [`results/raw/`](results/raw/). Study status and counts: [`manifest.json`](manifest.json).

The predeclared candidate was Zod; the target was switched to es-toolkit before any analysis ran (see RESULTS.md). No Zod analysis exists.

## Rerun

From the repository root (needs git, `gh` logged in, Node 24; uses only the already-installed `tsx`):

```sh
node node_modules/tsx/dist/cli.mjs benchmarks/run.ts      # clone to %TEMP%/mrbench/es-toolkit, analyse, write results/es-toolkit.json
node node_modules/tsx/dist/cli.mjs benchmarks/report.ts   # render RESULTS.md from the results JSON
```

`run.ts` options: `--repo owner/name`, `--src src/`, `--cutoff <ISO>`, `--limit 25`, `--only <PR>`, `--out <file>`, `--workdir <dir>`. Completed and excluded PRs already in the output file are reused; failed ones are retried. It installs each historical lockfile in a disposable clone (Yarn `node-modules` linker, no install scripts), adds Stryker 10.1.1 there, restores `package.json`/`yarn.lock`, and never touches this repository's dependencies.

## Rules kept from the protocol

Every considered PR and exclusion reason is published; failed analyses are reported, never dropped. A surviving mutant is a behaviour change no test detected, not proof a production bug shipped; survivors other than the quoted examples were not human-reviewed. Nothing here establishes that any historical tests were AI-generated. No token, dollar, energy or carbon savings are claimed.
