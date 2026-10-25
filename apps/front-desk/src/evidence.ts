import type { EvidenceFootprint, EvidenceSavings, EvidenceTriage } from "../server/evidence-validation";
export type { EvidenceFootprint } from "../server/evidence-validation";
export type { LedgerEntry } from "../server/ledger-validation";

export interface Evidence {
  triage?: EvidenceTriage;
  savings?: EvidenceSavings;
  footprint?: EvidenceFootprint | null;
  schemaVersion: number;
  runId: string;
  createdAt: string;
  source: "local" | "gitlab";
  provenance: {
    projectId: string | null;
    mrIid: number | string | null;
    headSha: string;
    baseSha: string | null;
    pipelineId: string | null;
    jobId: string | null;
    policyVersion: string;
    toolchain: Record<string, string>;
    scopeKind: string;
  };
  baseline: {
    status: string;
    tests: number;
    branchCoverage: number | null;
    durationMs: number;
    log: string;
  };
  scope: {
    files: { path: string; startLine: number; endLine: number }[];
    complete: boolean;
    reason: string;
  };
  mutation: {
    status: string;
    score: number | null;
    counts: Record<string, number>;
    mutants: Mutant[];
    durationMs: number | null;
    reportPath: string | null;
  };
  findings: Finding[];
  verification: {
    status: string;
    scope: string;
    originalPasses: boolean;
    mutantFails: boolean;
    cleanRerun: boolean;
    logs: unknown[];
    runs?: {
      attempt: number;
      original: { durationMs: number; exitCode: number | null };
      mutant: { durationMs: number; exitCode: number | null };
      assertionKilled: boolean;
    }[];
  };
  metrics: Record<string, number | null>;
  integrations: { gitlab: string; duo: string };
  gate: { status: string; reasons: string[] };
}
export interface Mutant {
  id: string;
  fingerprint: string;
  path: string;
  line: number;
  original: string;
  replacement: string;
  operator: string;
  status: string;
}
export interface Finding {
  id: string;
  title: string;
  consequence: string;
  requirement: string;
  mutantFingerprint: string;
  proposal: { id: string; patch: string; patchHash: string; testPath: string };
  interpretationSource: string;
  confidence: number | null;
  approvalStatus: string;
}
export interface Configuration {
  projectUrl: string | null;
  mrUrl: string | null;
  flowHandle: string | null;
  revision: string;
}
