export interface LineInterval { start: number; end: number }
export interface MutationScope { path: string; lines: LineInterval[]; change: 'added' | 'modified' | 'renamed' }
export interface Location { start: { line: number; column: number }; end: { line: number; column: number } }
export type MutantStatus = 'Killed' | 'Survived' | 'NoCoverage' | 'Timeout' | 'CompileError' | 'RuntimeError' | 'Ignored' | 'Pending';
export interface Provenance {
  headSha: string;
  baseSha?: string;
  projectId?: string;
  mergeRequestIid?: number;
  pipelineId?: string;
  jobId?: string;
  toolchain?: Record<string, string>;
  fresh?: boolean;
}
export interface NormalizedMutant {
  id: string;
  fingerprint: string;
  path: string;
  location: Location;
  original: string;
  replacement: string;
  operator: string;
  status: MutantStatus;
  coveredBy: string[];
  killedBy: string[];
  /** Set only after an execution log or structured assertion result establishes the failure cause. */
  assertionKilled?: boolean;
  provenance?: Provenance;
}
export interface MutationMetrics {
  score: number | null;
  killed: number;
  assertionKills: number | null;
  survived: number;
  noCoverage: number;
  timedOut: number;
  invalid: number;
  ignored: number;
  pending: number;
  total: number;
}
