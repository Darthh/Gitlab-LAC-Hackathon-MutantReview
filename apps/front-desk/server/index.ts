import express from "express";
import { readFile, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { GitLabAdapter } from "../../../packages/gitlab-adapter/src/index.js";
import { shippingFee } from "../../../packages/demo-domain/src/shipping.js";
import { gitlabOrigin, validateEvidence } from "./evidence-validation.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const app = express();
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});
let revision = "unavailable";
try {
  revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
} catch {
  /* source archive */
}

const remoteJob = process.env.GITLAB_EVIDENCE_JOB_ID?.trim();
const mrSetting = process.env.GITLAB_MR_IID?.trim();
const publicProject = "https://gitlab.com/Darthh2/mutant-review";
const configuredHandle = process.env.GITLAB_FLOW_HANDLE?.trim();
const flowHandle =
  configuredHandle && /^@[a-zA-Z0-9_.-]+$/.test(configuredHandle)
    ? configuredHandle
    : null;
let adapter: GitLabAdapter | null = null;
let configurationError = false;
let jobId: number | undefined;
let mrIid: number | undefined;
let upstreamOrigin = "";
function positiveSetting(value: string): number {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new Error("Invalid numeric GitLab setting");
  return Number(value);
}
try {
  upstreamOrigin = gitlabOrigin(process.env.GITLAB_URL || "https://gitlab.com");
  const projectId = positiveSetting(
    process.env.GITLAB_PROJECT_ID?.trim() || "88030103",
  );
  if (remoteJob) jobId = positiveSetting(remoteJob);
  if (mrSetting) mrIid = positiveSetting(mrSetting);
  adapter = new GitLabAdapter({
    baseUrl: upstreamOrigin,
    projectId,
    token: process.env.GITLAB_READ_TOKEN,
  });
} catch {
  configurationError = true;
}

function trustedProjectLink(value: string): string | null {
  try {
    const url = new URL(value);
    return url.origin === upstreamOrigin &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
      ? url.href.replace(/\/$/, "")
      : null;
  } catch {
    return null;
  }
}
let metadata: { projectUrl: string | null; expiresAt: number } | null = null;
let metadataRequest: Promise<string | null> | null = null;
async function projectLink(): Promise<string | null> {
  if (metadata && metadata.expiresAt > Date.now()) return metadata.projectUrl;
  if (metadataRequest) return metadataRequest;
  metadataRequest = (async () => {
    let projectUrl: string | null = null;
    try {
      if (adapter)
        projectUrl = trustedProjectLink(
          (await adapter.capabilityCheck()).projectUrl,
        );
    } catch {
      /* metadata does not establish artifact access */
    }
    if (
      !projectUrl &&
      adapter?.projectId === 88030103 &&
      upstreamOrigin === "https://gitlab.com"
    )
      projectUrl = publicProject;
    metadata = { projectUrl, expiresAt: Date.now() + 60_000 };
    return projectUrl;
  })();
  try {
    return await metadataRequest;
  } finally {
    metadataRequest = null;
  }
}

app.get("/api/config", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const projectUrl = await projectLink();
  res.json({
    projectUrl,
    mrUrl:
      projectUrl && mrIid ? `${projectUrl}/-/merge_requests/${mrIid}` : null,
    flowHandle,
    revision,
    evidenceSource: remoteJob ? "gitlab" : "local",
    connected: !!(remoteJob && adapter && !configurationError),
    configurationError: configurationError
      ? "Check numeric GitLab project, MR, job, and HTTPS origin settings on the server."
      : null,
  });
});

async function loadEvidence() {
  if (remoteJob) {
    if (configurationError || !adapter || !jobId)
      throw new Error(
        "Invalid GitLab evidence configuration. Check the server settings.",
      );
    const expected = {
      source: "gitlab" as const,
      projectId: String(adapter.projectId),
      mergeRequestIid: mrIid,
      jobId: String(jobId),
    };
    const evidence = validateEvidence(
      await adapter.readEvidenceArtifact(jobId),
      expected,
    );
    // Job provenance alone cannot establish that a pinned artifact still matches the active MR.
    const current = await adapter.currentMergeRequest(
      evidence.provenance.mrIid!,
    );
    return validateEvidence(evidence, { ...expected, headSha: current.sha });
  }
  const filename = resolve(root, "evidence/latest.json");
  if ((await stat(filename)).size > 5_000_000)
    throw new Error("Evidence exceeds the 5 MB limit.");
  const raw = await readFile(filename, "utf8");
  if (Buffer.byteLength(raw, "utf8") > 5_000_000)
    throw new Error("Evidence exceeds the 5 MB limit.");
  return validateEvidence(JSON.parse(raw), { source: "local" });
}

function publicEvidenceError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (
    message.startsWith("Evidence rejected: ") ||
    message ===
      "Evidence format is unsupported or malformed. Regenerate the run." ||
    message === "Evidence exceeds the 5 MB limit." ||
    message ===
      "Invalid GitLab evidence configuration. Check the server settings."
  )
    return message;
  if (/^GitLab request failed \(\d{3}\)$/.test(message))
    return `${message}. Check project artifact read access.`;
  return "Execution evidence could not be validated or read. Check the configured job, current MR revision, and server access.";
}
app.get(["/api/evidence", "/api/evidence/download"], async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const data = await loadEvidence();
    if (req.path.endsWith("/download"))
      res.attachment(
        `mutant-review-${data.runId.replace(/[^a-zA-Z0-9-]/g, "")}.json`,
      );
    res.json(data);
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    res
      .status(missing ? 404 : 502)
      .json({
        error: missing
          ? "No execution evidence yet. Run npm run demo in the project, then refresh."
          : publicEvidenceError(error),
      });
  }
});
app.get("/api/health", (_req, res) => res.json({ status: "ok", revision }));
app.get("/api/checkout", (req, res) => {
  const raw = req.query.subtotal;
  const subtotal =
    typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(subtotal) || subtotal < 0) {
    res
      .status(400)
      .json({ error: "subtotal must be a nonnegative integer in cents" });
    return;
  }
  res.json({
    subtotalCents: subtotal,
    shippingCents: shippingFee(subtotal),
    revision,
  });
});
if (process.argv.includes("--production")) {
  app.use(express.static(resolve(root, "dist/front-desk")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(resolve(root, "dist/front-desk/index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    configFile: resolve(root, "apps/front-desk/vite.config.ts"),
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 4173);
app.listen(port, "127.0.0.1", () =>
  console.log(`Mutant Review Front Desk: http://localhost:${port}`),
);
