import { describe, expect, it } from 'vitest';
import { summarizeEnergy } from '../../../benchmarks/energy-summary.js';

const run = (wallMs: number, cpuMs: number | null, mutants: number | null) => ({ status: 'completed', wallMs, cpuMs, instrumentedMutants: mutants });
const study = (pullRequests: unknown[]) => ({
  source: 'benchmarks/results/es-toolkit.json', repository: 'https://github.com/toss/es-toolkit', settings: { concurrency: 2 },
  machine: { platform: 'linux x64', cpuModel: 'Xeon', vCpus: 2, memoryGb: 8 }, pullRequests,
});

describe('energy benchmark summary', () => {
  it('prices both executed arms with the footprint model and reports the saving', () => {
    const summary = summarizeEnergy(study([
      // 10 changed-line mutants vs 40 whole-file ones; the dry run is the fixed cost.
      { number: 1, status: 'completed', title: 'fix', changedLines: 3, scoped: run(20_000, 28_000, 10), wholeDry: run(10_000, 8_000, 40), whole: run(50_000, 88_000, 40) },
      { number: 2, status: 'failed', reason: 'install failed' },
    ]))!;
    expect(summary.repository).toBe('toss/es-toolkit');
    expect(summary.measured).toBe(1);
    expect(summary.changedLines).toMatchObject({ cpuSeconds: 28, mutants: 10 });
    expect(summary.wholeFile).toMatchObject({ cpuSeconds: 88, mutants: 40 });
    expect(summary.savedPercent).toBeGreaterThan(55);
    expect(summary.savedPercent).toBeLessThan(75);
    // The per-MR projection (dry run + per-mutant cost × N) matches this executed run exactly.
    expect(summary.projectionErrorPercent).toBe(0);
    expect(summary.rows[0]!.projectedWholeCpuSeconds).toBe(88);
  });
  it('skips runs without a CPU measurement and returns nothing when none remain', () => {
    expect(summarizeEnergy(study([{ number: 1, status: 'completed', scoped: run(1, null, 1), wholeDry: run(1, 1, 1), whole: run(1, 1, 1) }]))).toBeNull();
  });
  it('rejects malformed results', () => {
    expect(() => summarizeEnergy({ pullRequests: 'nope' })).toThrow();
  });
});
