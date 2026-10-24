import { z } from 'zod';

export const triageSchema = z.object({
  findingId: z.string().min(1).max(100),
  mutantFingerprints: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(20),
  classification: z.enum(['actionable-testing-gap', 'possibly-equivalent', 'possibly-low-priority', 'insufficient-contract-information', 'execution-problem']),
  behavioralGap: z.string().min(1).max(3000),
  requirementReference: z.string().min(1).max(500),
  suggestedTests: z.array(z.object({ input: z.union([z.string(), z.number()]), expected: z.union([z.string(), z.number(), z.boolean(), z.null()]), rationale: z.string().min(1).max(1000) }).strict()).max(10),
  proposedPatch: z.string().max(30000),
  confidence: z.number().min(0).max(1),
  uncertainty: z.array(z.string().max(1000)).max(10),
}).strict();
export type Triage = z.infer<typeof triageSchema>;

export function validateTriage(value: unknown, knownFingerprints: string[]): Triage {
  const parsed = triageSchema.parse(value);
  const known = new Set(knownFingerprints);
  if (parsed.mutantFingerprints.some(fingerprint => !known.has(fingerprint))) throw new Error('Triage references an unknown mutant');
  if (parsed.classification === 'actionable-testing-gap' && (!parsed.proposedPatch.trim() || !parsed.suggestedTests.length)) throw new Error('Actionable triage requires a patch and contract-derived test');
  return parsed;
}
