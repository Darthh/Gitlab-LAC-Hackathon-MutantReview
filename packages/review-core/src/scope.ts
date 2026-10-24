import { createHash } from 'node:crypto';
import type { MutationScope, NormalizedMutant } from './types.js';

/** Reject Git path traversal and filenames whose range syntax would expand mutation scope. */
export function normalizePath(input: string): string {
  const path = input.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!path || path.startsWith('/') || /[\x00-\x1f:*?\[\]{}!]/.test(path) || path.split('/').some(p => p === '..' || p === '')) {
    throw new Error('Unsafe or unsupported repository-relative path');
  }
  return path;
}

export function isProductionTypeScript(path: string): boolean {
  return /\.tsx?$/.test(path) && !/\.d\.ts$/.test(path)
    && !/(^|\/)(node_modules|vendor|vendors|dist|build|coverage|generated|__tests__|tests?|fixtures)(\/|$)/i.test(path)
    && !/\.(test|spec|generated)\.tsx?$/i.test(path);
}

function readGitPath(text: string): string | null {
  let value = text.split('\t')[0]!;
  if (value === '/dev/null') return null;
  if (value.startsWith('"')) {
    // Git's octal-escaped non-ASCII paths are intentionally unsupported, never guessed.
    try { value = JSON.parse(value) as string; } catch { throw new Error('Unsupported quoted Git path'); }
  }
  return normalizePath(value.replace(/^[ab]\//, ''));
}

/** Parse `git diff --unified=0 --no-ext-diff BASE HEAD`; only added-side lines enter scope. */
export function parseDiff(diff: string): MutationScope[] {
  const result: MutationScope[] = [];
  let path: string | null = null;
  let oldPath: string | null = null;
  let cursor = 0;
  let inHunk = false;
  let current: MutationScope | undefined;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) { path = null; oldPath = null; current = undefined; inHunk = false; continue; }
    if (line.startsWith('--- ') && !inHunk) { oldPath = readGitPath(line.slice(4)); continue; }
    if (line.startsWith('+++ ') && !inHunk) {
      path = readGitPath(line.slice(4));
      if (path && isProductionTypeScript(path)) {
        current = { path, lines: [], change: oldPath === null ? 'added' : oldPath === path ? 'modified' : 'renamed' };
        result.push(current);
      }
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) { cursor = Number(hunk[1]); inHunk = true; continue; }
    if (!inHunk) continue;
    if (line.startsWith('+')) {
      const code = line.slice(1).trim();
      // This is a conservative candidate scope. Stryker determines executable mutation sites.
      if (current && code && !/^(\/\/|\/\*|\*|import\b|export\s+type\b|type\b|interface\b)/.test(code) && !/^[{};]+$/.test(code)) {
        const prior = current.lines.at(-1);
        if (prior && prior.end + 1 === cursor) prior.end = cursor;
        else current.lines.push({ start: cursor, end: cursor });
      }
      cursor++;
    } else if (line.startsWith(' ')) cursor++;
  }
  return result.filter(scope => scope.lines.length > 0);
}

export function strykerRanges(scope: MutationScope[]): string[] {
  return scope.flatMap(file => file.lines.map(line => `${normalizePath(file.path)}:${line.start}-${line.end}`));
}

export function filterMutantsToScope<T extends Pick<NormalizedMutant, 'path' | 'location'>>(mutants: T[], scope: MutationScope[]): T[] {
  return mutants.filter(mutant => scope.some(file => file.path === normalizePath(mutant.path)
    && file.lines.some(range => mutant.location.start.line <= range.end && mutant.location.end.line >= range.start)));
}

/** Callers must include dependency lockfile, runner config, snapshots, policy, runtime and relevant environment. */
export function cacheKey(inputs: Record<string, string>): string {
  const required = ['lockfile', 'runnerConfig', 'snapshots', 'policy', 'toolchain', 'environment'];
  if (required.some(key => !(key in inputs))) throw new Error('Cache key is missing a required invalidation input');
  return createHash('sha256').update(JSON.stringify(Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
}
