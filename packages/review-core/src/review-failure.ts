import { z } from 'zod';

/** Public failed-attempt artifact. Raw errors stay in the server-side log. */
export const reviewFailureSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('review-error'),
  status: z.literal('inconclusive'),
  createdAt: z.iso.datetime(),
  log: z.literal('evidence/error.json'),
}).strict();
