import { readEvidenceCache } from '../../../packages/gitlab-adapter/src/evidence-cache.js';
import { validateEvidence } from './evidence-validation.js';

export interface SignedEvidenceSettings {
  cacheFile: string;
  publicKeyFile: string;
  projectId: number;
  mrIid: number;
  jobId: number;
}

/** Only anonymous MR metadata and a configured public verification key enter this reader. */
export async function loadSignedEvidence(
  settings: SignedEvidenceSettings,
  adapter: { currentMergeRequest(iid: number): Promise<{ sha: string }> },
  now = new Date(),
) {
  const current = await adapter.currentMergeRequest(settings.mrIid);
  const currentHeadCheckedAt = new Date().toISOString();
  let cache;
  try {
    cache = await readEvidenceCache(settings.cacheFile, settings.publicKeyFile, {
      projectId: settings.projectId,
      mrIid: settings.mrIid,
      jobId: settings.jobId,
      headSha: current.sha,
    }, now);
  } catch {
    throw new Error('Signed evidence cache could not be verified, has expired, or does not match the current MR head. Refresh the authenticated artifact capture.');
  }
  const evidence = validateEvidence(cache.evidence, {
    source: 'gitlab',
    projectId: String(settings.projectId),
    mergeRequestIid: settings.mrIid,
    jobId: String(settings.jobId),
    headSha: current.sha,
  });
  if (evidence.provenance.pipelineId !== cache.pipelineId) throw new Error('Evidence rejected: signed cache and artifact refer to different pipelines');
  return {
    evidence,
    delivery: {
      mode: 'signed-cache' as const,
      verifiedAt: cache.verifiedAt,
      currentHeadCheckedAt,
      currentHeadSha: current.sha,
    },
  };
}
