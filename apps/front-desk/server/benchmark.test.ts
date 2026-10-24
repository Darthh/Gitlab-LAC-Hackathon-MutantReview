import { describe, expect, it } from 'vitest';
import { summarizeBenchmark } from './benchmark.js';

const pr = (status: string, total: number, survived: number, noCoverage: number, wholeFileMutants: number | null = total * 2) =>
  ({ status, metrics: { total, survived, noCoverage }, wholeFileMutants });

describe('benchmark summary', () => {
  it('counts only completed analyses and keeps whole-file totals honest', () => {
    const summary = summarizeBenchmark({ target: { repository: 'https://github.com/toss/es-toolkit' }, pullRequests: [
      pr('completed', 10, 2, 0), pr('completed', 0, 0, 0), pr('completed', 5, 0, 1), pr('excluded', 99, 99, 99), pr('failed', 7, 7, 0),
    ] });
    expect(summary).toEqual({ repository: 'toss/es-toolkit', analyzed: 3, withMutants: 2, withSurvivors: 2, mutantsRun: 15, wholeFileMutants: 30, survived: 2, noCoverage: 1 });
  });
  it('reports whole-file mutants as unmeasured when any analysis lacks them', () => {
    expect(summarizeBenchmark({ target: { repository: 'https://github.com/a/b' }, pullRequests: [pr('completed', 4, 1, 0, null)] }).wholeFileMutants).toBeNull();
  });
  it('rejects malformed results', () => {
    expect(() => summarizeBenchmark({ target: { repository: 'not a url' }, pullRequests: [] })).toThrow();
    expect(() => summarizeBenchmark({ target: { repository: 'https://github.com/a/b' }, pullRequests: [pr('completed', -1, 0, 0)] })).toThrow();
  });
});
