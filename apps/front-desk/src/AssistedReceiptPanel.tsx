import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  BookOpen,
  Check,
  GitCommitHorizontal,
  ReceiptText,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import type { AssistedReceipt } from "../server/assisted-receipt-validation";

/** The endpoint returns only validated exported receipts; an absent receipt stays absent. */
export default function AssistedReceiptPanel({
  lessonsOnly = false,
}: {
  lessonsOnly?: boolean;
}) {
  const [receipt, setReceipt] = useState<AssistedReceipt | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/assisted-receipt", { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) return;
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.error ||
              "The exported repair receipt could not be validated.",
          );
        setReceipt(result);
      })
      .catch((err) => {
        if (err.name !== "AbortError") setError(err.message);
      });
    return () => controller.abort();
  }, []);
  if (error)
    return (
      <div className="notice receipt-warning" role="status">
        <TriangleAlert size={18} />
        <p>{error}</p>
      </div>
    );
  if (!receipt || (lessonsOnly && !receipt.lesson)) return null;
  if (lessonsOnly && receipt.lesson)
    return (
      <section className="panel assisted-record">
        <div className="panel-heading">
          <div className="panel-title">
            <BookOpen size={18} />
            <h2>Human-approved lesson</h2>
          </div>
          <span className="badge green">
            <Check size={12} />
            Verified repair
          </span>
        </div>
        <div className="receipt-body">
          <h3>{receipt.lesson.id}</h3>
          <p className="assisted-description">
            {receipt.lesson.recommendation}
          </p>
          <dl className="evidence-details">
            <div>
              <dt>Approved by</dt>
              <dd>
                GitLab user #{receipt.lesson.approvedBy} ·{" "}
                {new Date(receipt.lesson.approvedAt).toLocaleString()}
              </dd>
            </div>
            <div>
              <dt>Lesson commit</dt>
              <dd>
                <a href={receipt.lesson.url} target="_blank" rel="noreferrer">
                  <code>{receipt.lesson.commitSha}</code>{" "}
                  <ArrowUpRight size={12} />
                </a>
              </dd>
            </div>
            <div>
              <dt>Repository branch</dt>
              <dd>{receipt.lesson.branch}</dd>
            </div>
            <div>
              <dt>Later application</dt>
              <dd>
                No verified later application is asserted by this receipt.
              </dd>
            </div>
          </dl>
          <p className="small muted">
            Approved on a separate lesson branch. Merge status and later Duo
            reuse require their own evidence.
          </p>
        </div>
      </section>
    );
  return (
    <section className="panel assisted-record">
      <div className="panel-heading">
        <div className="panel-title">
          <ReceiptText size={18} />
          <h2>Assisted repair receipt</h2>
        </div>
        <span
          className={`badge ${receipt.verification.status === "passed" ? "green" : "red"}`}
        >
          {receipt.verification.status === "passed" ? (
            <Check size={12} />
          ) : (
            <TriangleAlert size={12} />
          )}
          Fresh verification {receipt.verification.status}
        </span>
      </div>
      <div className="receipt-body">
        <p className="assisted-description">
          MR !{receipt.mrIid} · {receipt.proposalId}. This is a separate
          GitLab-approved repair, verified locally against the immutable repair
          commit. The GitLab pipeline state is reported separately below.
        </p>
        <div
          className={`receipt-chain ${receipt.verification.status === "failed" ? "receipt-warning" : ""}`}
        >
          <span>
            <ShieldCheck size={17} />
            Patch approved
          </span>
          <span>
            <GitCommitHorizontal size={17} />
            Repair committed
          </span>
          <span>
            <Check size={17} />
            {receipt.verification.status === "passed"
              ? "Original passes"
              : "Verification failed"}
          </span>
          <span>
            <ShieldCheck size={17} />
            {receipt.verification.status === "passed"
              ? "Target assertion fails"
              : "Renewed approval required"}
          </span>
        </div>
        <dl className="evidence-details">
          <div>
            <dt>Source revision</dt>
            <dd>
              <code>{receipt.sourceHeadSha}</code>
            </dd>
          </div>
          <div>
            <dt>Patch approval</dt>
            <dd>
              GitLab user #{receipt.repair.approvedBy} ·{" "}
              {new Date(receipt.repair.approvedAt).toLocaleString()}
            </dd>
          </div>
          <div>
            <dt>Repair commit</dt>
            <dd>
              <a href={receipt.repair.url} target="_blank" rel="noreferrer">
                <code>{receipt.repair.commitSha}</code>{" "}
                <ArrowUpRight size={12} />
              </a>
            </dd>
          </div>
          <div>
            <dt>Repair branch</dt>
            <dd>{receipt.repair.branch} · not merged by this workflow</dd>
          </div>
          <div>
            <dt>Verification approval</dt>
            <dd>
              GitLab user #{receipt.verification.approvedBy} ·{" "}
              {new Date(receipt.verification.approvedAt).toLocaleString()}
            </dd>
          </div>
          <div>
            <dt>Fresh executions</dt>
            <dd>
              {receipt.verification.runs.length} original / targeted mutant
              pairs ·{" "}
              {receipt.verification.cleanRerun
                ? "clean rerun reproduced"
                : "reproduction not established"}
            </dd>
          </div>
          <div>
            <dt>Pipeline</dt>
            <dd>
              <a href={receipt.pipeline.url} target="_blank" rel="noreferrer">
                #{receipt.pipeline.id} ·{" "}
                {receipt.pipeline.observedStatus
                  ? `GitLab reports ${receipt.pipeline.observedStatus}`
                  : "outcome unverified"}{" "}
                <ArrowUpRight size={12} />
              </a>
              <span className="small muted">
                Local repair proof does not establish successful CI execution.
              </span>
            </dd>
          </div>
          <div>
            <dt>Exact patch hash</dt>
            <dd>
              <code>{receipt.patchHash}</code>
            </dd>
          </div>
          {receipt.lessonApplication && (
            <div>
              <dt>Related lesson</dt>
              <dd>
                {receipt.lessonApplication.lessonIds.join(", ")} ·{" "}
                {receipt.lessonApplication.status}. Duo execution is unverified.
                <br />
                {receipt.lessonApplication.whyApplies}
              </dd>
            </div>
          )}
        </dl>
        <details className="receipt-patch-details">
          <summary>Inspect the approved patch</summary>
          <pre>{receipt.proposalPatch}</pre>
        </details>
        <div className="receipt-actions">
          <a className="button secondary" href="/api/assisted-receipt/download">
            <ArrowDownToLine size={14} />
            Export repair receipt
          </a>
          <a
            className="button primary"
            href={receipt.repair.url}
            target="_blank"
            rel="noreferrer"
          >
            Inspect repair in GitLab
            <ArrowUpRight size={14} />
          </a>
        </div>
      </div>
    </section>
  );
}
