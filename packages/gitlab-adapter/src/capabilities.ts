import { GitLabAdapter } from './index.js';

const projectId = Number(process.env.GITLAB_PROJECT_ID);
if (!projectId) throw new Error('Set GITLAB_PROJECT_ID to the one approved demonstration project');
const adapter = new GitLabAdapter({
  baseUrl: process.env.GITLAB_URL ?? 'https://gitlab.com',
  projectId,
  token: process.env.GITLAB_READ_TOKEN,
});
const iid = process.env.GITLAB_MR_IID ? Number(process.env.GITLAB_MR_IID) : undefined;
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), ...await adapter.capabilityCheck(iid),
  evidenceBoundary: 'Read-only API inspection; write permission, flow execution and merge blocking require separate live checks.' }, null, 2));
