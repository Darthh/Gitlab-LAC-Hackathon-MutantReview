/**
 * Software Carbon Intensity (SCI, Green Software Foundation, ISO/IEC 21031:2024) of one review.
 *
 *   SCI = (E × I + M) per R        R = one merge-request review
 *   E   = (CPU + memory energy) × PUE, CPU from measured CPU time, never from a guess when a measurement exists
 *   M   = TE × (TiR / EL) × (RR / ToR)
 *
 * Pure functions. Coefficients and their sources live in FOOTPRINT_SOURCES and docs/sustainability.md.
 */

export interface PowerModel {
  /** Watts per vCPU at 0% and 100% utilisation. */
  cpuWattsIdle: number;
  cpuWattsMax: number;
  /** Watts per GB of reserved memory. */
  memoryWattsPerGb: number;
  pue: number;
  /** Total embodied emissions of one host (kgCO2e), its vCPUs and expected lifespan. */
  embodiedHostKg: number;
  hostVcpus: number;
  lifespanYears: number;
}

/**
 * Central: Cloud Carbon Footprint's GCP median coefficients (0.71 / 4.26 W per vCPU, 0.392 W/GB, PUE 1.1).
 * Low: AMD EPYC 3rd gen per-vCPU coefficients, as used for CI runners by Saavedra et al. (2025).
 * High: Cloud Carbon Footprint's earlier GCP averages (1.34 / 4.98 W per vCPU).
 * Embodied: 1,610.79 kgCO2e for a 112-vCPU host over 4 years (CCF data, as used by Saavedra et al.).
 */
export const POWER_MODELS: Record<'low' | 'central' | 'high', PowerModel> = {
  low: { cpuWattsIdle: 0.434, cpuWattsMax: 1.948, memoryWattsPerGb: 0.392, pue: 1.1, embodiedHostKg: 1610.79, hostVcpus: 112, lifespanYears: 4 },
  central: { cpuWattsIdle: 0.71, cpuWattsMax: 4.26, memoryWattsPerGb: 0.392, pue: 1.1, embodiedHostKg: 1610.79, hostVcpus: 112, lifespanYears: 4 },
  high: { cpuWattsIdle: 1.34, cpuWattsMax: 4.98, memoryWattsPerGb: 0.392, pue: 1.1, embodiedHostKg: 1610.79, hostVcpus: 112, lifespanYears: 4 },
};

/** Google Cloud's published 2025 grid carbon intensity (gCO2e/kWh) and carbon-free energy share per region. */
export const GRID_REGIONS: Record<string, { gridIntensity: number; cfePercent: number; location: string }> = {
  'us-east1': { gridIntensity: 579, cfePercent: 31, location: 'South Carolina' },
  'us-east4': { gridIntensity: 343, cfePercent: 57, location: 'Northern Virginia' },
  'us-east5': { gridIntensity: 343, cfePercent: 57, location: 'Columbus' },
  'us-central1': { gridIntensity: 432, cfePercent: 88, location: 'Iowa' },
  'us-south1': { gridIntensity: 299, cfePercent: 83, location: 'Dallas' },
  'us-west1': { gridIntensity: 98, cfePercent: 83, location: 'Oregon' },
  'europe-west1': { gridIntensity: 126, cfePercent: 79, location: 'Belgium' },
  'europe-north1': { gridIntensity: 30, cfePercent: 98, location: 'Finland' },
  'northamerica-northeast1': { gridIntensity: 11, cfePercent: 97, location: 'Montréal' },
};

export const FOOTPRINT_SOURCES = {
  sci: 'https://greensoftware.foundation/standards/sci/',
  power: 'https://www.cloudcarbonfootprint.org/docs/methodology/',
  embodied: 'https://www.cloudcarbonfootprint.org/docs/embodied-emissions',
  ciCoefficients: 'https://arxiv.org/abs/2510.26413',
  grid: 'https://cloud.google.com/sustainability/region-carbon',
  runners: 'https://docs.gitlab.com/ci/runners/hosted_runners/linux/',
};

/** What one piece of work used: wall time on a reserved machine and the CPU time it actually burned. */
export interface Usage {
  wallMs: number;
  /** Measured user+system CPU time of the process tree; null when the platform cannot measure it. */
  cpuMs: number | null;
  /** vCPUs and memory reserved for the job (the runner VM), not what the process happened to touch. */
  vCpus: number;
  memoryGb: number;
}

export interface Footprint {
  energyWh: number;
  operationalG: number;
  embodiedG: number;
  /** SCI for this unit of work, gCO2e. */
  sciG: number;
  cpuSeconds: number;
  utilization: number;
  /** False when CPU time was unavailable and full utilisation was assumed (an upper bound). */
  cpuMeasured: boolean;
}

const round = (value: number, digits = 4) => Number(value.toFixed(digits));

export function addUsage(items: Usage[]): Usage | null {
  if (!items.length) return null;
  return {
    wallMs: items.reduce((sum, item) => sum + item.wallMs, 0),
    cpuMs: items.some((item) => item.cpuMs === null) ? null : items.reduce((sum, item) => sum + item.cpuMs!, 0),
    vCpus: Math.max(...items.map((item) => item.vCpus)),
    memoryGb: Math.max(...items.map((item) => item.memoryGb)),
  };
}

export function footprint(usage: Usage, gridIntensity: number, model: PowerModel = POWER_MODELS.central): Footprint {
  if (!(usage.wallMs >= 0) || !(usage.vCpus > 0) || !(usage.memoryGb >= 0) || !(gridIntensity >= 0)) throw new Error('Invalid usage for a footprint');
  const wallHours = usage.wallMs / 3_600_000;
  const reservedCpuHours = wallHours * usage.vCpus;
  const cpuMeasured = usage.cpuMs !== null;
  // CPU time can exceed reserved time only through measurement noise; clamp to the reservation.
  const busyCpuHours = Math.min(cpuMeasured ? usage.cpuMs! / 3_600_000 : reservedCpuHours, reservedCpuHours);
  // CCF: watts = idle + utilisation × (max − idle), summed over reserved vCPU-hours. Equivalent form below.
  const cpuWh = model.cpuWattsIdle * reservedCpuHours + (model.cpuWattsMax - model.cpuWattsIdle) * busyCpuHours;
  const memoryWh = model.memoryWattsPerGb * usage.memoryGb * wallHours;
  const energyWh = (cpuWh + memoryWh) * model.pue;
  const operationalG = energyWh / 1000 * gridIntensity;
  // SCI embodied share: TE × (time reserved / lifespan) × (vCPUs reserved / host vCPUs).
  const embodiedG = model.embodiedHostKg * 1000 * (wallHours / (model.lifespanYears * 365.25 * 24)) * (usage.vCpus / model.hostVcpus);
  return {
    energyWh: round(energyWh),
    operationalG: round(operationalG),
    embodiedG: round(embodiedG),
    sciG: round(operationalG + embodiedG),
    cpuSeconds: round(busyCpuHours * 3600, 1),
    utilization: reservedCpuHours ? round(busyCpuHours / reservedCpuHours, 3) : 0,
    cpuMeasured,
  };
}

/**
 * Projects what mutating the whole changed files would have cost, from two runs every review already makes:
 * the changed-line run (fixed cost + n mutants) and the whole-file dry run (fixed cost, which also counts N).
 * per-mutant ≈ (changed-line − dry run) / n; whole-file ≈ dry run + per-mutant × N. Null when not identifiable.
 */
export function projectWholeFile(changedLines: Usage, wholeFileDryRun: Usage, changedMutants: number, wholeFileMutants: number | null): Usage | null {
  if (wholeFileMutants === null || changedMutants < 1 || wholeFileMutants < changedMutants) return null;
  const perMutantWall = (changedLines.wallMs - wholeFileDryRun.wallMs) / changedMutants;
  if (!(perMutantWall > 0)) return null;
  const perMutantCpu = changedLines.cpuMs === null || wholeFileDryRun.cpuMs === null ? null : (changedLines.cpuMs - wholeFileDryRun.cpuMs) / changedMutants;
  if (perMutantCpu !== null && !(perMutantCpu > 0)) return null;
  return {
    wallMs: Math.round(wholeFileDryRun.wallMs + perMutantWall * wholeFileMutants),
    cpuMs: perMutantCpu === null ? null : Math.round(wholeFileDryRun.cpuMs! + perMutantCpu * wholeFileMutants),
    vCpus: changedLines.vCpus,
    memoryGb: changedLines.memoryGb,
  };
}

/** Where the review ran. GitLab's hosted x86 runners run in us-east1/us-east5 (we assume the dirtier us-east1); Arm64 in us-central1. */
export function runnerRegion(env: Record<string, string | undefined>): { region: string; basis: string } {
  const explicit = env.MUTANT_REVIEW_GRID_REGION?.trim();
  if (explicit && GRID_REGIONS[explicit]) return { region: explicit, basis: 'MUTANT_REVIEW_GRID_REGION' };
  const runner = `${env.CI_RUNNER_DESCRIPTION ?? ''} ${env.CI_RUNNER_TAGS ?? ''}`.toLowerCase();
  if (/arm64|aarch64/.test(runner) && /saas-linux|gitlab\.com/.test(runner)) return { region: 'us-central1', basis: 'GitLab hosted Arm64 runner' };
  if (/saas-linux|runners-manager\.gitlab\.com/.test(runner)) return { region: 'us-east1', basis: 'GitLab hosted x86-64 runner (us-east1 or us-east5; the higher-carbon us-east1 is assumed)' };
  return { region: 'us-east1', basis: 'default: assumed to match a GitLab hosted x86-64 runner' };
}

export interface FootprintReceipt {
  functionalUnit: 'one merge-request review';
  boundary: string;
  region: string;
  regionBasis: string;
  gridIntensity: number;
  machine: { vCpus: number; memoryGb: number };
  measured: Usage;
  /** The whole review: every process Mutant Review started, measured. */
  actual: Footprint;
  /** Where it went, step by step (same model, same region). */
  steps: { step: string; cpuSeconds: number; energyWh: number; sciG: number }[];
  /** SCI of this review under the low and high power models. */
  range: { lowG: number; highG: number };
  /** The changed-line Stryker run alone, measured, and the whole-file run it replaced, projected. */
  changedLinesRun: (Footprint & { mutants: number }) | null;
  projectedWholeFile: (Footprint & { mutants: number; projected: true }) | null;
  savedG: number | null;
  savedPercent: number | null;
  modelCalls: { made: number; avoided: number };
}

export function footprintReceipt(input: {
  review: (Usage & { step?: string })[];
  changedLinesRun: Usage | null;
  wholeFileDryRun: Usage | null;
  changedMutants: number;
  wholeFileMutants: number | null;
  env: Record<string, string | undefined>;
  modelCalls?: { made: number; avoided: number };
}): FootprintReceipt | null {
  const measured = addUsage(input.review);
  if (!measured) return null;
  const { region, basis } = runnerRegion(input.env);
  const intensity = GRID_REGIONS[region]!.gridIntensity;
  const changed = input.changedLinesRun ? { ...footprint(input.changedLinesRun, intensity), mutants: input.changedMutants } : null;
  // When the whole files hold no mutants beyond the changed lines, the whole-file alternative is this very run.
  const projectedUsage = !input.changedLinesRun ? null
    : input.wholeFileMutants !== null && input.wholeFileMutants === input.changedMutants ? input.changedLinesRun
      : input.wholeFileDryRun ? projectWholeFile(input.changedLinesRun, input.wholeFileDryRun, input.changedMutants, input.wholeFileMutants) : null;
  const projected = projectedUsage ? { ...footprint(projectedUsage, intensity), mutants: input.wholeFileMutants!, projected: true as const } : null;
  const savedG = projected && changed ? round(Math.max(0, projected.sciG - changed.sciG)) : null;
  return {
    functionalUnit: 'one merge-request review',
    boundary: 'Processes Mutant Review starts in the review job (baseline tests with coverage, Stryker on the changed lines, the whole-file dry run that counts what scoping avoided) on the reserved runner VM: CPU, memory, data-centre overhead (PUE) and the embodied share of the host. Excludes job setup (image pull, npm ci), network, storage and model inference.',
    region,
    regionBasis: basis,
    gridIntensity: intensity,
    machine: { vCpus: measured.vCpus, memoryGb: measured.memoryGb },
    measured,
    actual: footprint(measured, intensity),
    steps: input.review.map((item, index) => {
      const value = footprint(item, intensity);
      return { step: item.step ?? `step ${index + 1}`, cpuSeconds: value.cpuSeconds, energyWh: value.energyWh, sciG: value.sciG };
    }),
    range: { lowG: footprint(measured, intensity, POWER_MODELS.low).sciG, highG: footprint(measured, intensity, POWER_MODELS.high).sciG },
    changedLinesRun: changed,
    projectedWholeFile: projected,
    savedG,
    savedPercent: projected && savedG !== null && projected.sciG > 0 ? round(100 * savedG / projected.sciG, 1) : null,
    modelCalls: input.modelCalls ?? { made: 0, avoided: 0 },
  };
}

export function formatGrams(grams: number): string {
  if (grams >= 1000) return `${(grams / 1000).toFixed(2)} kgCO2e`;
  if (grams >= 1) return `${grams.toFixed(2)} gCO2e`;
  return `${(grams * 1000).toFixed(0)} mgCO2e`;
}
