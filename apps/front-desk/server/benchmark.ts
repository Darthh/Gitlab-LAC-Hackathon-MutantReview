import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const count = z.number().int().nonnegative();
const resultSchema = z.object({
  target: z.object({ repository: z.string().url().max(300) }),
  pullRequests: z.array(z.object({
    status: z.string().max(40),
    metrics: z.object({ total: count, survived: count, noCoverage: count }).partial().nullish(),
    wholeFileMutants: count.nullish(),
  })).max(500),
});

export interface BenchmarkSummary {
  repository: string;
  analyzed: number;
  withMutants: number;
  withSurvivors: number;
  mutantsRun: number;
  wholeFileMutants: number | null;
  survived: number;
  noCoverage: number;
}

/** Aggregates the committed benchmark results; numbers come only from completed analyses. */
export function summarizeBenchmark(input: unknown): BenchmarkSummary {
  const data = resultSchema.parse(input);
  const done = data.pullRequests.filter((pr) => pr.status === "completed");
  const metric = (pr: (typeof done)[number], key: "total" | "survived" | "noCoverage") => pr.metrics?.[key] ?? 0;
  const sum = (key: "total" | "survived" | "noCoverage") => done.reduce((total, pr) => total + metric(pr, key), 0);
  return {
    repository: data.target.repository.replace(/^https:\/\/github\.com\//, ""),
    analyzed: done.length,
    withMutants: done.filter((pr) => metric(pr, "total") > 0).length,
    withSurvivors: done.filter((pr) => metric(pr, "survived") + metric(pr, "noCoverage") > 0).length,
    mutantsRun: sum("total"),
    wholeFileMutants: done.every((pr) => pr.wholeFileMutants != null) ? done.reduce((total, pr) => total + (pr.wholeFileMutants ?? 0), 0) : null,
    survived: sum("survived"),
    noCoverage: sum("noCoverage"),
  };
}

export async function readBenchmark(directory: string): Promise<BenchmarkSummary | null> {
  const names = (await readdir(directory).catch(() => [])).filter((name) => name.endsWith(".json")).sort();
  if (!names.length) return null;
  const file = join(directory, names[0]!);
  if ((await stat(file)).size > 5_000_000) throw new Error("Benchmark results exceed the 5 MB limit.");
  return summarizeBenchmark(JSON.parse(await readFile(file, "utf8")));
}
