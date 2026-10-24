import express from "express";
import { readFile, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { validateEvidence } from "./evidence-validation.js";
import { readLedger } from "./ledger-validation.js";
import { readBenchmark } from "./benchmark.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const app = express();
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});
// Container images carry no .git; CI passes the commit as REVISION.
let revision = process.env.REVISION || "unavailable";
if (!process.env.REVISION) try {
  revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
} catch {
  /* source archive */
}

const publicProject = "https://gitlab.com/mutant-review1/mutant-review";
const handle = process.env.MUTANT_REVIEW_HANDLE?.trim();
const flowHandle = handle && /^@[a-zA-Z0-9_.-]+$/.test(handle) ? handle : null;

// Read-only console: it serves the evidence CI produced for this build. No credentials.
app.get("/api/config", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ projectUrl: publicProject, mrUrl: null, flowHandle, revision });
});

async function loadEvidence() {
  const filename = resolve(root, "evidence/latest.json");
  if ((await stat(filename)).size > 5_000_000)
    throw new Error("Evidence exceeds the 5 MB limit.");
  return validateEvidence(JSON.parse(await readFile(filename, "utf8")), { source: "local" });
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
    const message = error instanceof Error ? error.message : "";
    const safe = message.startsWith("Evidence rejected: ") ||
      message === "Evidence format is unsupported or malformed. Regenerate the run." ||
      message === "Evidence exceeds the 5 MB limit.";
    res.status(missing ? 404 : 502).json({
      error: missing
        ? "No execution evidence yet. Run npm run demo in the project, then refresh."
        : safe ? message : "Execution evidence could not be validated or read.",
    });
  }
});
app.get("/api/health", (_req, res) => res.json({ status: "ok", revision }));
app.get("/api/benchmark", async (_req, res) => {
  try {
    const summary = await readBenchmark(resolve(root, "benchmarks/results"));
    if (!summary) return void res.status(404).json({ error: "No benchmark results in this build." });
    res.json({ ...summary, reportUrl: `${publicProject}/-/blob/main/benchmarks/RESULTS.md` });
  } catch {
    res.status(500).json({ error: "Benchmark results are malformed." });
  }
});
app.get("/api/ledger", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    res.json(await readLedger(resolve(process.cwd(), ".mutant-review/ledger.json")));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    res.status(500).json({
      error: message.startsWith("Ledger ")
        ? message
        : "The repair ledger could not be read. Check .mutant-review/ledger.json on the server.",
    });
  }
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
// Cloud Run sets PORT and needs HOST=0.0.0.0; local runs stay loopback-only.
const port = Number(process.env.PORT ?? 4173);
app.listen(port, process.env.HOST ?? "127.0.0.1", () =>
  console.log(`Mutant Review Front Desk: http://localhost:${port}`),
);
