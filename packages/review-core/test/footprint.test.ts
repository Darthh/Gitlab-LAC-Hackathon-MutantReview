import { describe, expect, it } from 'vitest';
import { footprint, footprintReceipt, formatGrams, GRID_REGIONS, POWER_MODELS, projectWholeFile, runnerRegion, type Usage } from '../src/index.js';

const minute: Usage = { wallMs: 60_000, cpuMs: 60_000, vCpus: 2, memoryGb: 8 };

describe('SCI footprint of a review', () => {
  it('follows the CCF energy model and the SCI embodied formula, worked by hand', () => {
    // One minute on a 2 vCPU / 8 GB runner, one vCPU busy (50% utilisation), us-east1.
    const result = footprint(minute, 579);
    const cpuWh = 0.71 * 2 / 60 + (4.26 - 0.71) * 1 / 60; // idle on both vCPUs + busy share
    const memoryWh = 0.392 * 8 / 60;
    const energyWh = (cpuWh + memoryWh) * 1.1;
    const embodiedG = 1_610_790 * (1 / 60 / (4 * 365.25 * 24)) * (2 / 112);
    expect(result.energyWh).toBeCloseTo(energyWh, 4);
    expect(result.operationalG).toBeCloseTo(energyWh / 1000 * 579, 4);
    expect(result.embodiedG).toBeCloseTo(embodiedG, 4);
    expect(result.sciG).toBeCloseTo(energyWh / 1000 * 579 + embodiedG, 3);
    expect(result.utilization).toBe(0.5);
    expect(result.cpuMeasured).toBe(true);
  });

  it('assumes full utilisation, an upper bound, when CPU time cannot be measured', () => {
    const unmeasured = footprint({ ...minute, cpuMs: null }, 579);
    const busy = footprint({ ...minute, cpuMs: 120_000 }, 579);
    expect(unmeasured.cpuMeasured).toBe(false);
    expect(unmeasured.energyWh).toBe(busy.energyWh);
    expect(unmeasured.energyWh).toBeGreaterThan(footprint(minute, 579).energyWh);
  });

  it('never credits more CPU time than the reservation holds', () => {
    expect(footprint({ ...minute, cpuMs: 10 * 60_000 }, 579).utilization).toBe(1);
  });

  it('orders the low, central and high power models', () => {
    const [low, central, high] = (['low', 'central', 'high'] as const).map((name) => footprint(minute, 579, POWER_MODELS[name]).sciG);
    expect(low).toBeLessThan(central!);
    expect(central).toBeLessThan(high!);
  });

  it('scales with grid intensity: a low-carbon region cuts operational emissions only', () => {
    const east = footprint(minute, GRID_REGIONS['us-east1']!.gridIntensity);
    const oregon = footprint(minute, GRID_REGIONS['us-west1']!.gridIntensity);
    expect(oregon.energyWh).toBe(east.energyWh);
    expect(oregon.embodiedG).toBe(east.embodiedG);
    expect(oregon.operationalG).toBeLessThan(east.operationalG / 5);
  });

  it('rejects impossible usage', () => {
    expect(() => footprint({ ...minute, vCpus: 0 }, 579)).toThrow('Invalid usage');
    expect(() => footprint({ ...minute, wallMs: -1 }, 579)).toThrow('Invalid usage');
  });
});

describe('whole-file projection', () => {
  const dry: Usage = { wallMs: 10_000, cpuMs: 8_000, vCpus: 2, memoryGb: 8 };
  const scoped: Usage = { wallMs: 20_000, cpuMs: 28_000, vCpus: 2, memoryGb: 8 };

  it('is the dry run plus the measured cost per mutant times the whole-file count', () => {
    // 10 mutants cost 10 s wall and 20 CPU-s beyond the fixed cost, so 40 mutants cost 40 s and 80 CPU-s.
    expect(projectWholeFile(scoped, dry, 10, 40)).toEqual({ wallMs: 50_000, cpuMs: 88_000, vCpus: 2, memoryGb: 8 });
  });

  it('equals the changed-line run when scoping removed nothing', () => {
    expect(projectWholeFile(scoped, dry, 10, 10)).toEqual(scoped);
  });

  it('refuses to project from runs it cannot separate', () => {
    expect(projectWholeFile(scoped, dry, 0, 40)).toBeNull();
    expect(projectWholeFile(scoped, dry, 10, null)).toBeNull();
    expect(projectWholeFile(scoped, dry, 10, 5)).toBeNull();
    expect(projectWholeFile(dry, scoped, 10, 40)).toBeNull();
  });
});

describe('runner region', () => {
  it('maps GitLab hosted runners to their published regions', () => {
    expect(runnerRegion({ CI_RUNNER_DESCRIPTION: '3-blue.saas-linux-small-amd64.runners-manager.gitlab.com/default' }).region).toBe('us-east1');
    expect(runnerRegion({ CI_RUNNER_DESCRIPTION: '1-green.saas-linux-small-arm64.runners-manager.gitlab.com/default' }).region).toBe('us-central1');
    expect(runnerRegion({ CI_RUNNER_TAGS: '["saas-linux-small-arm64"]' }).region).toBe('us-central1');
  });

  it('honours an explicit region and ignores an unknown one', () => {
    expect(runnerRegion({ MUTANT_REVIEW_GRID_REGION: 'europe-north1' })).toEqual({ region: 'europe-north1', basis: 'MUTANT_REVIEW_GRID_REGION' });
    expect(runnerRegion({ MUTANT_REVIEW_GRID_REGION: 'moon-1' }).region).toBe('us-east1');
  });
});

describe('footprint receipt', () => {
  const baseline: Usage = { wallMs: 5_000, cpuMs: 4_000, vCpus: 2, memoryGb: 8 };
  const dry: Usage = { wallMs: 10_000, cpuMs: 8_000, vCpus: 2, memoryGb: 8 };
  const scoped: Usage = { wallMs: 20_000, cpuMs: 28_000, vCpus: 2, memoryGb: 8 };

  it('reports the measured review and the mutation work scoping avoided', () => {
    const receipt = footprintReceipt({ review: [baseline, scoped, dry], changedLinesRun: scoped, wholeFileDryRun: dry, changedMutants: 10, wholeFileMutants: 40, env: {}, modelCalls: { made: 0, avoided: 2 } })!;
    expect(receipt.functionalUnit).toBe('one merge-request review');
    expect(receipt.measured).toEqual({ wallMs: 35_000, cpuMs: 40_000, vCpus: 2, memoryGb: 8 });
    expect(receipt.changedLinesRun!.mutants).toBe(10);
    expect(receipt.projectedWholeFile!.mutants).toBe(40);
    expect(receipt.savedG).toBeGreaterThan(0);
    expect(receipt.savedPercent).toBeGreaterThan(50);
    expect(receipt.range.lowG).toBeLessThan(receipt.actual.sciG);
    expect(receipt.range.highG).toBeGreaterThan(receipt.actual.sciG);
    expect(receipt.modelCalls).toEqual({ made: 0, avoided: 2 });
  });

  it('needs no dry run when the whole files hold no other mutants: the alternative is the same run, and nothing is saved', () => {
    const receipt = footprintReceipt({ review: [baseline, scoped], changedLinesRun: scoped, wholeFileDryRun: null, changedMutants: 5, wholeFileMutants: 5, env: {} })!;
    expect(receipt.steps).toHaveLength(2);
    expect(receipt.projectedWholeFile).toMatchObject({ mutants: 5, sciG: receipt.changedLinesRun!.sciG });
    expect(receipt.savedG).toBe(0);
    expect(receipt.savedPercent).toBe(0);
  });

  it('claims no saving it cannot project, and nothing without a measurement', () => {
    const receipt = footprintReceipt({ review: [baseline], changedLinesRun: null, wholeFileDryRun: null, changedMutants: 0, wholeFileMutants: null, env: {} })!;
    expect(receipt.projectedWholeFile).toBeNull();
    expect(receipt.savedG).toBeNull();
    expect(footprintReceipt({ review: [], changedLinesRun: null, wholeFileDryRun: null, changedMutants: 0, wholeFileMutants: null, env: {} })).toBeNull();
  });
});

describe('formatGrams', () => {
  it('picks a readable unit', () => {
    expect(formatGrams(0.0183)).toBe('18 mgCO2e');
    expect(formatGrams(2.345)).toBe('2.35 gCO2e');
    expect(formatGrams(1234)).toBe('1.23 kgCO2e');
  });
});
