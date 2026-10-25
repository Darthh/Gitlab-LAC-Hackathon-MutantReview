/**
 * Turns the raw timings of benchmarks/energy.ts into energy and SCI with the product's own footprint model,
 * and checks the per-MR whole-file projection against whole-file runs that were actually executed.
 * Pure; used by benchmarks/energy-report.ts (ENERGY.md) and the Front Desk /api/energy endpoint.
 */
import { z } from 'zod';
import { GRID_REGIONS, footprint, projectWholeFile, type Usage } from '../packages/review-core/src/footprint.js';

const count = z.number().int().nonnegative();
const ms = z.number().nonnegative();
const run = z.object({ status: z.string().max(80), wallMs: ms, cpuMs: ms.nullable(), instrumentedMutants: count.nullable() });
const energySchema = z.object({
  source: z.string().max(300),
  repository: z.string().url().max(300).optional(),
  settings: z.object({ concurrency: count }).passthrough(),
  machine: z.object({ platform: z.string().max(80), cpuModel: z.string().max(200), vCpus: z.number().int().positive(), memoryGb: z.number().positive() }),
  /** Where the run happened when it was not GitLab's hosted runner, and anything that could disturb the timings. */
  environment: z.string().max(500).optional(),
  pullRequests: z.array(z.object({
    number: count, status: z.string().max(40), title: z.string().max(400).optional(), changedLines: count.optional(),
    scoped: run.optional(), wholeDry: run.optional(), whole: run.optional(),
  })).max(500),
});

export interface EnergyRow {
  number: number;
  title: string;
  changedLines: number;
  mutants: { changed: number; whole: number };
  cpuSeconds: { changed: number; whole: number };
  energyWh: { changed: number; whole: number };
  sciG: { changed: number; whole: number };
  projectedWholeCpuSeconds: number | null;
}

export interface EnergySummary {
  repository: string;
  measured: number;
  machine: string;
  environment?: string;
  region: string;
  changedLines: { cpuSeconds: number; energyWh: number; sciG: number; mutants: number };
  wholeFile: { cpuSeconds: number; energyWh: number; sciG: number; mutants: number };
  savedPercent: number;
  projectionErrorPercent: number | null;
  rows: EnergyRow[];
}

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
const round = (value: number, digits = 3) => Number(value.toFixed(digits));

export function summarizeEnergy(input: unknown, region = 'us-east1'): EnergySummary | null {
  const data = energySchema.parse(input);
  const intensity = GRID_REGIONS[region]!.gridIntensity;
  const { vCpus, memoryGb } = data.machine;
  const usage = (item: z.infer<typeof run>): Usage => ({ wallMs: item.wallMs, cpuMs: item.cpuMs, vCpus, memoryGb });
  const rows: EnergyRow[] = [];
  const errors: number[] = [];
  for (const pr of data.pullRequests) {
    if (pr.status !== 'completed' || !pr.scoped || !pr.whole || !pr.wholeDry) continue;
    if (pr.scoped.cpuMs === null || pr.whole.cpuMs === null || pr.wholeDry.cpuMs === null) continue;
    const changed = footprint(usage(pr.scoped), intensity);
    const whole = footprint(usage(pr.whole), intensity);
    const changedMutants = pr.scoped.instrumentedMutants ?? 0;
    const wholeMutants = pr.whole.instrumentedMutants ?? 0;
    const projected = projectWholeFile(usage(pr.scoped), usage(pr.wholeDry), changedMutants, wholeMutants);
    if (projected?.cpuMs != null && pr.whole.cpuMs > 0) errors.push(Math.abs(projected.cpuMs - pr.whole.cpuMs) / pr.whole.cpuMs * 100);
    rows.push({
      number: pr.number, title: pr.title ?? '', changedLines: pr.changedLines ?? 0,
      mutants: { changed: changedMutants, whole: wholeMutants },
      cpuSeconds: { changed: changed.cpuSeconds, whole: whole.cpuSeconds },
      energyWh: { changed: changed.energyWh, whole: whole.energyWh },
      sciG: { changed: changed.sciG, whole: whole.sciG },
      projectedWholeCpuSeconds: projected?.cpuMs == null ? null : round(projected.cpuMs / 1000, 1),
    });
  }
  if (!rows.length) return null;
  const total = (pick: (row: EnergyRow) => number) => rows.reduce((sum, row) => sum + pick(row), 0);
  const changedLines = { cpuSeconds: round(total((row) => row.cpuSeconds.changed), 1), energyWh: round(total((row) => row.energyWh.changed)), sciG: round(total((row) => row.sciG.changed)), mutants: total((row) => row.mutants.changed) };
  const wholeFile = { cpuSeconds: round(total((row) => row.cpuSeconds.whole), 1), energyWh: round(total((row) => row.energyWh.whole)), sciG: round(total((row) => row.sciG.whole)), mutants: total((row) => row.mutants.whole) };
  const error = median(errors);
  return {
    repository: data.repository?.replace(/^https:\/\/github\.com\//, '') ?? 'benchmark',
    measured: rows.length,
    machine: `${data.machine.vCpus} vCPU / ${data.machine.memoryGb} GB, ${data.machine.cpuModel}, concurrency ${data.settings.concurrency}`,
    ...(data.environment ? { environment: data.environment } : {}),
    region,
    changedLines,
    wholeFile,
    savedPercent: wholeFile.energyWh > 0 ? round(100 * (1 - changedLines.energyWh / wholeFile.energyWh), 1) : 0,
    projectionErrorPercent: error === null ? null : round(error, 1),
    rows,
  };
}
