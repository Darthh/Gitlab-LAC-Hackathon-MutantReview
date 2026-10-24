import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleCheck,
  Clock3,
  Code2,
  Copy,
  Cpu,
  ExternalLink,
  FileCode2,
  FlaskConical,
  Funnel,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  HelpCircle,
  LayoutDashboard,
  ListFilter,
  LoaderCircle,
  Menu,
  MoreHorizontal,
  Play,
  ReceiptText,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  ShieldX,
  Sparkles,
  Terminal,
  TriangleAlert,
  X,
  Zap,
} from "lucide-react";
import type {
  Configuration,
  Evidence,
  Finding,
  LedgerEntry,
  Mutant,
} from "./evidence";
import AssistedReceiptPanel from "./AssistedReceiptPanel";

type Page = "overview" | "findings" | "verification" | "lessons" | "ledger";
type ConnectionConfiguration = Configuration & {
  evidenceJobUrl: string | null;
  evidenceDelivery: {
    mode: "local" | "artifact-api" | "signed-cache";
    verifiedAt: string | null;
    currentHeadCheckedAt: string | null;
    currentHeadSha: string | null;
  };
};
const navigation: { key: Page; label: string; icon: typeof Activity }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "findings", label: "Findings", icon: FlaskConical },
  { key: "verification", label: "Repair receipts", icon: ReceiptText },
  { key: "lessons", label: "Lessons", icon: BookOpen },
  { key: "ledger", label: "Work ledger", icon: Activity },
];
const formatTime = (ms: number | null) =>
  ms == null ? "Unavailable" : `${(ms / 1000).toFixed(1)}s`;
const percent = (n: number | null | undefined) =>
  n == null ? "—" : `${Number(n.toFixed(1))}%`;
const trimSha = (s: string | undefined) => s?.slice(0, 8) || "Unavailable";
const displayTime = (value: string | null | undefined) =>
  value
    ? `${new Date(value).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/Los_Angeles",
      })} PT`
    : "Unavailable";
function projectIdentity(value: string | null | undefined) {
  try {
    const parts = new URL(value || "").pathname.split("/").filter(Boolean).map(decodeURIComponent);
    return {
      namespace: parts.slice(0, -1).join("/") || "GitLab workspace",
      name: parts.at(-1) || "GitLab project",
    };
  } catch {
    return { namespace: "GitLab workspace", name: "GitLab project" };
  }
}
function Logo({ large = false }: { large?: boolean }) {
  return (
    <span className={`brand-mark ${large ? "large" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none">
        <path
          d="M9 6c20 10-6 10 14 20M23 6C3 16 29 16 9 26M10 10h12M12 16h8M10 22h12"
          stroke="currentColor"
          strokeWidth="2.3"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
function Badge({
  children,
  tone = "neutral",
  dot = false,
}: {
  children: ReactNode;
  tone?: string;
  dot?: boolean;
}) {
  return (
    <span className={`badge ${tone}`}>
      {dot && <span className="status-dot" />}
      {children}
    </span>
  );
}
function Empty({
  icon: Icon = BookOpen,
  title,
  children,
}: {
  icon?: typeof BookOpen;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={26} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>("overview");
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [config, setConfig] = useState<ConnectionConfiguration | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<
    "connection" | "search" | "patch" | null
  >(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All mutants");
  const [mobileNav, setMobileNav] = useState(false);
  const [copied, setCopied] = useState(false);
  const [detailTab, setDetailTab] = useState("Mutation");
  const [refreshes, setRefreshes] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  async function refresh() {
    setRefreshes((n) => n + 1);
    setLoading(true);
    setError("");
    try {
      const [runResponse, configResponse] = await Promise.all([
        fetch("/api/evidence"),
        fetch("/api/config"),
      ]);
      const run = await runResponse.json();
      if (!runResponse.ok)
        throw new Error(run.error || "Execution evidence could not be loaded.");
      setEvidence(run);
      setConfig(await configResponse.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    function keyboard(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setDialog(null);
        setMobileNav(false);
      }
      if (
        (e.key === "/" || (e.key === "k" && (e.metaKey || e.ctrlKey))) &&
        !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)
      ) {
        e.preventDefault();
        setDialog("search");
      }
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, []);
  useEffect(() => {
    if (dialog) {
      lastFocus.current = document.activeElement as HTMLElement;
      closeRef.current?.focus();
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
      lastFocus.current?.focus();
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [dialog]);
  function navigate(next: Page) {
    setPage(next);
    setMobileNav(false);
    setQuery("");
    setDialog(null);
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  const finding = evidence?.findings[0];
  const survivors = evidence?.mutation.counts.survived || 0;
  const projectLink = config?.projectUrl;
  const isMeasured = evidence?.mutation.status === "complete";
  const currentLabel = navigation.find((n) => n.key === page)!.label;
  const elapsed = evidence?.metrics.totalDurationMs ?? null;
  const signedDelivery = config?.evidenceDelivery?.mode === "signed-cache";
  const connectedProject = config?.connected && evidence?.source === "gitlab";
  const identity = projectIdentity(projectLink);

  const gitlabLink = (
    label = "Open in GitLab",
    className = "button secondary",
  ) =>
    config?.mrUrl || projectLink ? (
      <a
        className={className}
        href={config?.mrUrl || projectLink!}
        target="_blank"
        rel="noreferrer"
      >
        {label}
        <ArrowUpRight size={14} />
      </a>
    ) : (
      <button className={className} onClick={() => setDialog("connection")}>
        {label}
        <ArrowUpRight size={14} />
      </button>
    );
  function CodeComparison({ mutant }: { mutant?: Mutant }) {
    const snippet = (code: string, changed: boolean) =>
      code.split(/(>=|>|\b\d[\d_]*\b|\breturn\b)/g).map((token, index) => {
        if (token === ">=" || token === ">")
          return (
            <mark key={index} className={changed ? "mutant-op" : "original-op"}>
              {token}
            </mark>
          );
        if (/^\d/.test(token))
          return (
            <span key={index} className="code-orange">
              {token}
            </span>
          );
        if (token === "return")
          return (
            <span key={index} className="code-purple">
              {token}
            </span>
          );
        return token;
      });
    return (
      <div className="code-comparison">
        <div className="code-pane">
          <div className="code-label">
            <span>
              <span className="tiny-dot green-dot" />
              Original implementation
            </span>
            <Badge tone="dark">
              Baseline {evidence?.baseline.status || "unavailable"}
            </Badge>
          </div>
          <pre>
            <span className="line-number">{mutant?.line || "—"}</span>
            <code>
              {mutant
                ? snippet(mutant.original, false)
                : "No targeted mutation evidence"}
            </code>
          </pre>
        </div>
        <div className="code-pane mutant-pane">
          <div className="code-label">
            <span>
              <span className="tiny-dot amber-dot" />
              Targeted mutation
            </span>
            <Badge tone="dark-amber">{mutant?.status || "Not run"}</Badge>
          </div>
          <pre>
            <span className="line-number">{mutant?.line || "—"}</span>
            <code>
              {mutant ? snippet(mutant.replacement, true) : "Not run"}
            </code>
          </pre>
        </div>
        <div className="code-footer">
          <Code2 size={13} />
          <span>{mutant?.operator || "Operator unavailable"}</span>
          <span className="code-foot-divider" />
          <span>Same tests. Different behavior.</span>
        </div>
      </div>
    );
  }
  const target = evidence?.mutation.mutants.find(
    (m) => m.fingerprint === finding?.mutantFingerprint,
  );

  function FindingDetail({ compact = false }: { compact?: boolean }) {
    if (!finding)
      return (
        <Empty icon={FlaskConical} title="No finding to inspect">
          Findings appear after a completed mutation run. No findings does not
          establish a passing gate.
        </Empty>
      );
    return (
      <section className="panel finding-panel">
        <div className="panel-heading">
          <div className="panel-title">
            <span className="icon-tile amber">
              <FlaskConical size={17} />
            </span>
            <h2>
              {compact
                ? "A gap worth a closer look"
                : "Inclusive shipping threshold"}
            </h2>
            <Badge tone="amber">Survived</Badge>
          </div>
          <span className="small muted">
            {finding.id.split("-").slice(0, 2).join("-")}
          </span>
        </div>
        <div className="finding-body">
          <div className="file-location">
            <FileCode2 size={14} />
            <span>packages/demo-domain/src/shipping.ts</span>
            <span className="line-tag">L{target?.line || 4}</span>
          </div>
          <h3>{finding.title}</h3>
          <p>{finding.consequence}</p>
          {!compact && (
            <div
              className="detail-tabs"
              role="tablist"
              aria-label="Finding evidence"
            >
              {["Mutation", "Contract", "Proposed test"].map((t) => (
                <button
                  role="tab"
                  aria-selected={t === detailTab}
                  key={t}
                  className={detailTab === t ? "active" : ""}
                  onClick={() => setDetailTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
          {compact || detailTab === "Mutation" ? (
            <CodeComparison mutant={target} />
          ) : detailTab === "Contract" ? (
            <div className="contract">
              <BookOpen size={18} />
              <div>
                <b>SHIPPING-001</b>
                <p>{finding.requirement}</p>
                <span className="small muted">
                  Expected result at 10,000 cents: 0 cents shipping.
                </span>
              </div>
            </div>
          ) : (
            <Patch finding={finding} />
          )}
          <div className="finding-note">
            <ShieldCheck size={15} />
            <span>
              Measured by Stryker. Explanation from the demo contract.
            </span>
            <span className="advisory-label">Duo pending</span>
          </div>
        </div>
        <div className="panel-actions">
          <span>
            <Circle size={13} /> Awaiting patch approval
          </span>
          <button
            className="text-button"
            onClick={() =>
              compact ? navigate("findings") : setDialog("patch")
            }
          >
            {compact ? "Explore finding" : "Review proposed patch"}
            <ArrowRight size={15} />
          </button>
        </div>
      </section>
    );
  }
  function Patch({ finding: item }: { finding: Finding }) {
    return (
      <div className="patch">
        <div className="patch-header">
          <FileCode2 size={14} />
          <span>{item.proposal.testPath.split("/").pop()}</span>
          <Badge tone="green">+4 lines</Badge>
          <button
            className="icon-button"
            aria-label="Copy proposed patch"
            onClick={() => void copy(item.proposal.patch)}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
        <pre>
          {item.proposal.patch.split("\n").map((line, i) => (
            <span
              className={
                line.startsWith("+") && !line.startsWith("+++")
                  ? "added"
                  : line.startsWith("@@")
                    ? "hunk"
                    : ""
              }
              key={i}
            >
              {line}
              {"\n"}
            </span>
          ))}
        </pre>
      </div>
    );
  }

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to review
      </a>
      <aside
        id="main-navigation"
        className={`sidebar ${mobileNav ? "open" : ""}`}
      >
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            navigate("overview");
          }}
        >
          <Logo />
          <span>
            Mutant Review<span className="brand-subtitle">Front Desk</span>
          </span>
        </a>
        <button
          className="workspace-select"
          onClick={() => setDialog("connection")}
        >
          <span className="workspace-avatar">
            m<span>r</span>
          </span>
          <span>
            {connectedProject ? identity.namespace : "Demo workspace"}
            <small>{connectedProject ? identity.name : "Local demonstration"}</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <div className="nav-caption">Workspace</div>
        <nav aria-label="Main navigation">
          {navigation.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => navigate(key)}
              className={page === key ? "nav-item active" : "nav-item"}
              aria-current={page === key ? "page" : undefined}
            >
              <Icon size={18} />
              <span>{label}</span>
              {key === "findings" && survivors > 0 && (
                <span className="nav-count">{survivors}</span>
              )}
              {key === "lessons" && (
                <span className="nav-zero">
                  {evidence?.lessons.length || 0}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-rule" />
        <a
          className="nav-item external-nav"
          target="_blank"
          rel="noreferrer"
          href="https://docs.gitlab.com/user/duo_agent_platform/flows/custom/"
        >
          <Code2 size={18} />
          <span>Duo flow guide</span>
          <ArrowUpRight size={13} />
        </a>
        <div className="sidebar-bottom">
          <div className="agent-status">
            <span className="agent-symbol">
              <Sparkles size={16} />
            </span>
            <b>Assisted by design</b>
            <p>
              You approve the change.
              <br />
              Execution provides the proof.
            </p>
            <span className="small">
              <span className="tiny-dot purple-dot" /> Human approval required
            </span>
          </div>
          <button className="nav-item" onClick={() => setDialog("connection")}>
            <Settings2 size={17} />
            <span>Project connection</span>
          </button>
          <a
            className="nav-item"
            href="https://github.com/Darthh/Gitlab-Life-After-Code-Hackathon#readme"
            target="_blank"
            rel="noreferrer"
          >
            <HelpCircle size={17} />
            <span>Documentation</span>
            <ArrowUpRight size={13} />
          </a>
          <div className="profile">
            <span className="profile-avatar">D</span>
            <span>
              {connectedProject ? identity.name : "Demo project"}
              <small>Read-only evidence console</small>
            </span>
            <ShieldCheck size={16} />
          </div>
        </div>
      </aside>
      <div className="app-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              aria-label="Toggle navigation"
              aria-expanded={mobileNav}
              aria-controls="main-navigation"
              onClick={() => setMobileNav((v) => !v)}
            >
              <Menu size={20} />
            </button>
            <span className="crumb-workspace">Workspace</span>
            <ChevronRight size={12} />
            <span className="crumb-project">
              <span className="project-dot" />
              {connectedProject ? identity.name : "checkout-demo"}
            </span>
            <ChevronRight size={12} />
            <b>{currentLabel}</b>
          </div>
          <div className="topbar-right">
            <button
              className="search-trigger"
              onClick={() => setDialog("search")}
              aria-label="Search evidence"
            >
              <Search size={16} />
              <kbd>
                {navigator.userAgent.includes("Mac") ? "⌘ K" : "Ctrl K"}
              </kbd>
            </button>
            <span className="topbar-divider" />
            <Badge tone="purple" dot>
              {evidence?.source === "gitlab"
                ? signedDelivery
                  ? "Signed GitLab snapshot"
                  : "GitLab evidence"
                : "Local execution"}
            </Badge>
          </div>
        </header>
        <main id="main">
          <div className="page-heading">
            <div>
              <div className="page-kicker">
                <span className="project-square">
                  <GitMerge size={14} />
                </span>
                Checkout demo <span>/</span>{" "}
                {evidence?.provenance.mrIid
                  ? `Merge request !${evidence.provenance.mrIid}`
                  : "Boundary review"}
              </div>
              <h1>{page === "overview" ? "Review overview" : currentLabel}</h1>
              <p>
                {page === "overview"
                  ? "Passing tests are a start. Let’s see what they actually protect."
                  : page === "findings"
                    ? "A specific behavioral change. The evidence behind it."
                    : page === "verification"
                      ? "Follow the path from a proposed assertion to executable proof."
                      : page === "lessons"
                        ? "Keep what was verified. Bring it to the next review."
                        : "The actual work behind this review, with no invented savings."}
              </p>
            </div>
            <div className="heading-actions">
              <button
                className="icon-button refresh-button"
                aria-label="Refresh execution evidence"
                onClick={() => void refresh()}
              >
                <RefreshCw size={16} className={loading ? "spin" : ""} />
              </button>
              {evidence && (
                <a href="/api/evidence/download" className="button secondary">
                  <ArrowDownToLine size={15} />
                  Export evidence
                </a>
              )}
              {gitlabLink()}
            </div>
          </div>
          {loading && !evidence ? (
            <div className="loading-state">
              <LoaderCircle size={24} className="spin" />
              <p>Reading execution evidence…</p>
            </div>
          ) : error ? (
            <section className="panel error-panel">
              <TriangleAlert size={25} />
              <h2>Evidence isn’t available yet</h2>
              <p>{error}</p>
              <code>npm run demo</code>
              <button className="button primary" onClick={() => void refresh()}>
                Refresh evidence
                <RefreshCw size={14} />
              </button>
            </section>
          ) : (
            evidence && (
              <>
                <div className="revision-bar">
                  <span>
                    <GitBranch size={14} />
                    <b>
                      {evidence.source === "local"
                        ? "Local fixture"
                        : `MR !${evidence.provenance.mrIid}`}
                    </b>
                  </span>
                  <span>
                    <GitCommitHorizontal size={14} />
                    <code>{trimSha(evidence.provenance.headSha)}</code>
                  </span>
                  <span>
                    {evidence.source === "gitlab" && config?.evidenceJobUrl ? (
                      <a
                        className="text-button"
                        href={config.evidenceJobUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        CI job #{evidence.provenance.jobId}
                        <ExternalLink size={12} />
                      </a>
                    ) : (
                      <>
                        <Clock3 size={13} />
                        {new Date(evidence.createdAt).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                          timeZone: "America/Los_Angeles",
                        })}{" "}
                        PT
                      </>
                    )}
                  </span>
                  <span className="revision-scope">
                    {evidence.scope.files.length} source file
                    {evidence.scope.files.length === 1 ? "" : "s"} in scope
                  </span>
                  <Badge tone={evidence.scope.complete ? "green" : "amber"}>
                    <Check size={11} />
                    {evidence.scope.complete
                      ? "Scope complete"
                      : "Partial scope"}
                  </Badge>
                </div>
                {signedDelivery && (
                  <p className="small muted" role="status">
                    Delivery: signed GitLab artifact snapshot. Authenticated capture{" "}
                    {displayTime(config?.evidenceDelivery?.verifiedAt)}. Current MR head{" "}
                    <code>{trimSha(config?.evidenceDelivery?.currentHeadSha || undefined)}</code>{" "}
                    checked {displayTime(config?.evidenceDelivery?.currentHeadCheckedAt)}.
                  </p>
                )}
                {page === "overview" && (
                  <>
                    <section className="insight-banner">
                      <div className="insight-icon">
                        <FlaskConical size={25} />
                      </div>
                      <div className="insight-copy">
                        <div className="insight-title">
                          {survivors > 0
                            ? "Green tests. One unprotected boundary."
                            : isMeasured
                              ? "A closer look at what your tests protect."
                              : "This review needs execution evidence."}
                          <Badge tone="amber">
                            {survivors} surviving{" "}
                            {survivors === 1 ? "mutant" : "mutants"}
                          </Badge>
                        </div>
                        <p>
                          {survivors > 0
                            ? "An order of exactly $100 can lose free shipping without a single test failing."
                            : "Inspect the measured results below before making a review decision."}
                        </p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => navigate("findings")}
                      >
                        Inspect finding
                        <ArrowRight size={16} />
                      </button>
                      <div className="banner-pattern" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                        <span />
                        <span />
                      </div>
                    </section>
                    <div className="metrics-grid">
                      <Metric
                        title="Branch coverage"
                        value={percent(evidence.baseline.branchCoverage)}
                        icon={<Code2 size={16} />}
                        tone="green"
                        subtitle={`${evidence.baseline.tests} baseline tests ${evidence.baseline.status}`}
                        foot="Code executed by your tests"
                      />
                      <Metric
                        title="Mutation score"
                        value={percent(evidence.mutation.score)}
                        icon={<FlaskConical size={16} />}
                        tone="purple"
                        subtitle={`${evidence.mutation.counts.killed} of ${evidence.mutation.mutants.length} test-detected`}
                        foot="Behavior changes detected"
                      />
                      <Metric
                        title="Surviving mutants"
                        value={String(survivors).padStart(2, "0")}
                        icon={<TriangleAlert size={16} />}
                        tone="amber"
                        subtitle={`${evidence.findings.length} actionable finding`}
                        foot="Changes your tests missed"
                      />
                      <Metric
                        title="Verified lessons"
                        value={String(evidence.lessons.length).padStart(2, "0")}
                        icon={<BookOpen size={16} />}
                        tone="neutral"
                        subtitle="Awaiting approved repair"
                        foot="Learned from verified evidence"
                      />
                    </div>
                    <SavingsTiles
                      savings={evidence.savings}
                      policy={evidence.triage?.policy}
                    />
                    <div className="content-columns">
                      <div className="main-column">
                        <FindingDetail compact />
                        <section className="panel test-panel">
                          <div className="panel-heading">
                            <div className="panel-title">
                              <CheckCheck size={17} className="green-text" />
                              <h2>The missing middle</h2>
                            </div>
                            <Badge tone="neutral">Business contract</Badge>
                          </div>
                          <div className="boundary-cases">
                            <Boundary
                              amount="$99.99"
                              result="$5 shipping"
                              label="Below the threshold"
                              tested
                            />
                            <Boundary
                              amount="$100.00"
                              result="Free shipping"
                              label="Exactly at the threshold"
                              tested={false}
                            />
                            <Boundary
                              amount="$100.01"
                              result="Free shipping"
                              label="Above the threshold"
                              tested
                            />
                          </div>
                          <p className="test-panel-footer">
                            <BookOpen size={14} /> Orders of at least $100
                            receive free shipping.<span>SHIPPING-001</span>
                          </p>
                        </section>
                      </div>
                      <div className="side-column">
                        <Workflow
                          evidence={evidence}
                          onGitlab={() => setDialog("connection")}
                          link={config?.mrUrl || projectLink}
                        />
                        <section className="small-panel gate-card">
                          <div>
                            <ShieldCheck size={17} />
                            <h3>Mutation gate</h3>
                            <Badge tone="red">
                              {evidence.gate.status === "failed"
                                ? "Failed"
                                : evidence.gate.status}
                            </Badge>
                          </div>
                          <p>
                            {evidence.gate.reasons[0] ||
                              "No passing policy decision is available."}
                          </p>
                          <button
                            className="text-button"
                            onClick={() => navigate("ledger")}
                          >
                            See policy evidence
                            <ArrowRight size={14} />
                          </button>
                          <span className="gate-footnote">
                            {evidence.source === "local"
                              ? "Local decision · GitLab merge blocking unverified"
                              : "See GitLab for required merge checks"}
                          </span>
                        </section>
                      </div>
                    </div>
                    <section className="trust-strip">
                      <span className="trust-icon">
                        <ShieldCheck size={18} />
                      </span>
                      <div>
                        <b>Evidence first. Human in control.</b>
                        <span>
                          The public console is read-only. Every patch and
                          lesson needs its own approval.
                        </span>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => navigate("verification")}
                      >
                        How verification works
                        <ArrowUpRight size={14} />
                      </button>
                    </section>
                  </>
                )}
                {page === "findings" && (
                  <>
                    <div className="section-toolbar">
                      <div className="segmented">
                        <button className="active">
                          Findings <span>{evidence.findings.length}</span>
                        </button>
                        <button
                          onClick={() =>
                            document
                              .getElementById("mutants")
                              ?.scrollIntoView({ behavior: "smooth" })
                          }
                        >
                          All mutants{" "}
                          <span>{evidence.mutation.mutants.length}</span>
                        </button>
                      </div>
                      <span className="small muted">
                        Engine evidence and interpretation are shown separately.
                      </span>
                    </div>
                    <TriagePanel triage={evidence.triage} />
                    <FindingDetail />
                    <section className="panel mutants-panel" id="mutants">
                      <div className="panel-heading">
                        <h2>Mutation inventory</h2>
                        <label className="select-label">
                          <span className="sr-only">
                            Filter mutants by status
                          </span>
                          <select
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                          >
                            {[
                              "All mutants",
                              "Survived",
                              "Killed",
                              "NoCoverage",
                              "Timeout",
                              "Ignored",
                              "Pending",
                            ].map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Mutation</th>
                              <th>Operator</th>
                              <th>Location</th>
                              <th>Engine result</th>
                            </tr>
                          </thead>
                          <tbody>
                            {evidence.mutation.mutants
                              .filter(
                                (m) =>
                                  filter === "All mutants" ||
                                  m.status === filter,
                              )
                              .map((m) => (
                                <tr key={m.fingerprint}>
                                  <td>
                                    <code>{m.replacement}</code>
                                  </td>
                                  <td>{m.operator}</td>
                                  <td>
                                    <span className="muted">
                                      {m.path.split("/").pop()}:
                                    </span>
                                    {m.line}
                                  </td>
                                  <td>
                                    <Badge
                                      tone={
                                        m.status === "Killed"
                                          ? "green"
                                          : m.status === "Survived"
                                            ? "amber"
                                            : "neutral"
                                      }
                                    >
                                      {m.status === "Killed" ? (
                                        <Check size={12} />
                                      ) : (
                                        <Circle size={11} />
                                      )}
                                      {m.status}
                                    </Badge>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                        {!evidence.mutation.mutants.some(
                          (m) =>
                            filter === "All mutants" || m.status === filter,
                        ) && (
                          <div className="table-empty">
                            No mutants with this status in the current scope.
                          </div>
                        )}
                      </div>
                      <div className="table-caption">
                        Timeouts count as detected in the standard score.
                        Assertion kills are reported separately.
                      </div>
                    </section>
                  </>
                )}
                {page === "verification" && (
                  <>
                    <AssistedReceiptPanel />
                    <div className="notice">
                      <ShieldCheck size={18} />
                      <div>
                        <b>
                          {evidence.verification.status === "passed"
                            ? "Local sandbox proof passed"
                            : "Verification is not complete"}
                        </b>
                        <p>
                          {evidence.verification.scope}. An approved repair
                          commit and GitLab receipt are still required.
                        </p>
                      </div>
                      <Badge
                        tone={
                          evidence.verification.status === "passed"
                            ? "green"
                            : "amber"
                        }
                      >
                        {evidence.verification.status}
                      </Badge>
                    </div>
                    <div className="verification-checks">
                      {[
                        {
                          title: "Original implementation passes",
                          passed: evidence.verification.originalPasses,
                          description:
                            "The additional boundary assertion matches the contract.",
                        },
                        {
                          title: "Exact mutant fails",
                          passed: evidence.verification.mutantFails,
                          description:
                            "The new assertion detects the >= to > mutation.",
                        },
                        {
                          title: "Clean rerun reproduces",
                          passed: evidence.verification.cleanRerun,
                          description:
                            "Fresh execution confirms the same outcome.",
                        },
                      ].map((item) => (
                        <div className="panel proof-card" key={item.title}>
                          <span
                            className={`proof-icon ${item.passed ? "green-text" : "muted"}`}
                          >
                            {item.passed ? (
                              <CircleCheck size={24} />
                            ) : (
                              <Circle size={24} />
                            )}
                          </span>
                          <h3>{item.title}</h3>
                          <p>{item.description}</p>
                          <Badge tone={item.passed ? "green" : "neutral"}>
                            {item.passed ? "Executed" : "Not proven"}
                          </Badge>
                        </div>
                      ))}
                    </div>
                    {finding && (
                      <section className="panel receipt-detail">
                        <div className="panel-heading">
                          <div className="panel-title">
                            <ReceiptText size={18} />
                            <h2>Proposed repair</h2>
                          </div>
                          <Badge tone="amber">Approval pending</Badge>
                        </div>
                        <div className="receipt-body">
                          <Patch finding={finding} />
                          <dl className="evidence-details">
                            <div>
                              <dt>Patch SHA-256</dt>
                              <dd>
                                <code>{finding.proposal.patchHash}</code>
                              </dd>
                            </div>
                            <div>
                              <dt>Proposal</dt>
                              <dd>{finding.proposal.id}</dd>
                            </div>
                            <div>
                              <dt>Approval</dt>
                              <dd>Not recorded</dd>
                            </div>
                            <div>
                              <dt>Repair commit</dt>
                              <dd>Not committed</dd>
                            </div>
                            <div>
                              <dt>Test output</dt>
                              <dd>
                                {evidence.verification.logs
                                  .map(String)
                                  .map((log) => (
                                    <span className="log-path" key={log}>
                                      <Terminal size={12} />
                                      {log}
                                    </span>
                                  ))}
                              </dd>
                            </div>
                          </dl>
                          <div className="receipt-actions">
                            <button
                              className="button secondary"
                              onClick={() => void copy(finding.proposal.patch)}
                            >
                              {copied ? (
                                <Check size={14} />
                              ) : (
                                <Copy size={14} />
                              )}
                              {copied ? "Patch copied" : "Copy exact patch"}
                            </button>
                            {gitlabLink(
                              "Continue approval in GitLab",
                              "button primary",
                            )}
                          </div>
                        </div>
                      </section>
                    )}
                  </>
                )}
                {page === "lessons" && (
                  <>
                    <div className="lesson-intro">
                      <div>
                        <span className="lesson-hero-icon">
                          <BookOpen size={29} />
                        </span>
                        <h2>
                          A better test today.
                          <br />A useful lesson tomorrow.
                        </h2>
                        <p>
                          Lessons enter the library only after a successful
                          repair and explicit human approval. Future tasks
                          retrieve only the lessons that apply.
                        </p>
                      </div>
                      <div className="lesson-process">
                        <span>
                          <ShieldCheck size={16} />
                          Verified repair
                        </span>
                        <ChevronRight size={17} />
                        <span>
                          <Check size={16} />
                          Human approval
                        </span>
                        <ChevronRight size={17} />
                        <span>
                          <BookOpen size={16} />
                          Reusable lesson
                        </span>
                      </div>
                    </div>
                    <AssistedReceiptPanel lessonsOnly />
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>Approved lesson library</h2>
                        <Badge>{evidence.lessons.length} verified</Badge>
                      </div>
                      {evidence.lessons.length === 0 ? (
                        <Empty title="Your first lesson starts with a verified repair">
                          The inclusive-threshold finding is a candidate.
                          Approve the exact repair, verify it, then approve the
                          lesson in GitLab.
                        </Empty>
                      ) : (
                        <div className="receipt-body">
                          <pre>{JSON.stringify(evidence.lessons, null, 2)}</pre>
                        </div>
                      )}
                    </section>
                    <section className="lesson-candidate">
                      <span className="icon-tile purple">
                        <Sparkles size={18} />
                      </span>
                      <div>
                        <Badge tone="purple">Candidate · not saved</Badge>
                        <h3>
                          Test below, at, and above an inclusive boundary.
                        </h3>
                        <p>
                          For the next discount feature, derive the expected
                          value at its own threshold from its written contract.
                        </p>
                        <span className="small muted">
                          Retrieval is not the same as demonstrated application.
                          No successful reuse recorded yet.
                        </span>
                      </div>
                    </section>
                  </>
                )}
                {page === "ledger" && (
                  <>
                    <RepairLedger key={refreshes} projectUrl={projectLink} />
                    <SavingsTiles
                      savings={evidence.savings}
                      policy={evidence.triage?.policy}
                    />
                    <div className="ledger-summary">
                      <div>
                        <Clock3 size={19} />
                        <span>Total recorded work</span>
                        <strong>{formatTime(elapsed)}</strong>
                      </div>
                      <div>
                        <Zap size={19} />
                        <span>Stryker mutations</span>
                        <strong>
                          {evidence.metrics.freshExecutions ?? "—"}
                        </strong>
                      </div>
                      <div>
                        <Sparkles size={19} />
                        <span>Model calls</span>
                        <strong>{evidence.metrics.modelCalls ?? "—"}</strong>
                      </div>
                      <div>
                        <ReceiptText size={19} />
                        <span>Reported tokens</span>
                        <strong className="unavailable">
                          {evidence.metrics.tokens ?? "Unavailable"}
                        </strong>
                      </div>
                    </div>
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>Execution ledger</h2>
                        <Badge tone="purple">
                          {evidence.source === "local"
                            ? "Measured locally"
                            : "GitLab execution"}
                        </Badge>
                      </div>
                      <div className="ledger-rows">
                        {[
                          {
                            icon: CheckCheck,
                            title: "Baseline test suite",
                            description: `${evidence.baseline.tests} tests · ${percent(evidence.baseline.branchCoverage)} shipping branch coverage`,
                            value: formatTime(evidence.baseline.durationMs),
                            status: evidence.baseline.status,
                          },
                          {
                            icon: FlaskConical,
                            title: "Stryker mutation analysis",
                            description: `${evidence.mutation.mutants.length} generated · ${evidence.mutation.counts.killed} test-detected · ${survivors} survived`,
                            value: formatTime(evidence.mutation.durationMs),
                            status: evidence.mutation.status,
                          },
                          {
                            icon: ShieldCheck,
                            title: "Targeted sandbox verification",
                            description: `${evidence.verification.runs?.length ?? 0} fresh original / targeted mutant pairs. Separate from Stryker executions.`,
                            value: evidence.verification.runs
                              ? formatTime(
                                  evidence.verification.runs.reduce(
                                    (sum, run) =>
                                      sum +
                                      run.original.durationMs +
                                      run.mutant.durationMs,
                                    0,
                                  ),
                                )
                              : "Unavailable",
                            status: evidence.verification.status,
                          },
                          {
                            icon: RefreshCw,
                            title: "Incremental result reuse",
                            description:
                              "Verification always executes the targeted mutation fresh.",
                            value: String(
                              evidence.metrics.cachedResults ?? "Unavailable",
                            ),
                            status: "cached results",
                          },
                          {
                            icon: ShieldCheck,
                            title: "Approved and verified repairs",
                            description:
                              "Sandbox proofs do not count as approved repairs.",
                            value: String(
                              evidence.metrics.verifiedRepairs ?? 0,
                            ),
                            status: "recorded",
                          },
                          {
                            icon: Sparkles,
                            title: "GitLab Duo reasoning",
                            description:
                              "No completed model execution is claimed.",
                            value: "Not executed",
                            status: "pending",
                          },
                        ].map((row) => (
                          <div className="ledger-row" key={row.title}>
                            <span className="icon-tile">
                              <row.icon size={18} />
                            </span>
                            <div>
                              <b>{row.title}</b>
                              <p>{row.description}</p>
                            </div>
                            <strong>{row.value}</strong>
                            <span className="small muted">{row.status}</span>
                          </div>
                        ))}
                      </div>
                    </section>
                    <section className="policy-section">
                      <h2>Gate decision: {evidence.gate.status}</h2>
                      {evidence.gate.reasons.map((reason) => (
                        <p key={reason}>
                          <TriangleAlert size={15} />
                          {reason}
                        </p>
                      ))}
                      <p className="small muted">
                        The 90% threshold is demonstration project policy. No
                        token, monetary, or energy savings have been inferred.
                      </p>
                    </section>
                  </>
                )}
                <footer className="page-footer">
                  <span>
                    <span className="tiny-dot green-dot" />
                    Evidence from actual execution
                    <span className="footer-divider" />
                    Stryker {evidence.provenance.toolchain.stryker} + Vitest{" "}
                    {evidence.provenance.toolchain.vitest}
                  </span>
                  <span>
                    Built for the tests behind the green check.
                    <Logo />
                  </span>
                </footer>
              </>
            )
          )}
        </main>
      </div>
      {dialog && (
        <div className="modal-backdrop" onClick={() => setDialog(null)}>
          <section
            className={`modal ${dialog === "patch" ? "wide" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key !== "Tab") return;
              const focusable = Array.from(
                e.currentTarget.querySelectorAll<HTMLElement>(
                  'button, a, input, select, [tabindex="0"]',
                ),
              ).filter((el) => !(el as HTMLButtonElement).disabled);
              const first = focusable[0];
              const last = focusable[focusable.length - 1];
              if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last?.focus();
              } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first?.focus();
              }
            }}
          >
            <div className="modal-heading">
              <div className="panel-title">
                {dialog === "connection" ? (
                  <GitBranch size={19} />
                ) : dialog === "search" ? (
                  <Search size={19} />
                ) : (
                  <FileCode2 size={19} />
                )}
                <h2 id="dialog-title">
                  {dialog === "connection"
                    ? "Project connection"
                    : dialog === "search"
                      ? "Find your evidence"
                      : "Review the exact proposed patch"}
                </h2>
              </div>
              <button
                ref={closeRef}
                className="icon-button"
                aria-label="Close dialog"
                onClick={() => setDialog(null)}
              >
                <X size={18} />
              </button>
            </div>
            {dialog === "connection" ? (
              <div className="modal-body">
                <Badge tone="purple">
                  {config?.connected
                    ? signedDelivery
                      ? "Signed GitLab cache configured"
                      : "GitLab artifact adapter configured"
                    : "Local execution mode"}
                </Badge>
                <p>
                  The console reads execution artifacts from one configured
                  GitLab project. Approvals take place in GitLab.
                </p>
                <dl className="connection-details">
                  <div>
                    <dt>Evidence source</dt>
                    <dd>{config?.evidenceSource || "local"}</dd>
                  </div>
                  <div>
                    <dt>Artifact delivery</dt>
                    <dd>
                      {signedDelivery
                        ? "Signed cache · maximum age 24 hours"
                        : config?.evidenceDelivery?.mode === "artifact-api"
                          ? "GitLab artifact API"
                          : "Local execution files"}
                    </dd>
                  </div>
                  {signedDelivery && (
                    <>
                      <div>
                        <dt>Authenticated capture</dt>
                        <dd>{displayTime(config?.evidenceDelivery?.verifiedAt)}</dd>
                      </div>
                      <div>
                        <dt>Current MR head checked</dt>
                        <dd>{displayTime(config?.evidenceDelivery?.currentHeadCheckedAt)}</dd>
                      </div>
                    </>
                  )}
                  <div>
                    <dt>GitLab artifact access</dt>
                    <dd>
                      {config?.connected ? "Configured" : "Not configured"}
                    </dd>
                  </div>
                  <div>
                    <dt>Duo flow handle</dt>
                    <dd>{config?.flowHandle || "Not confirmed"}</dd>
                  </div>
                </dl>
                <p className="small muted">
                  Configure the project, MR and evidence job on the server using
                  .env.example. Credentials stay on the server.
                </p>
                <a
                  className="button primary"
                  href={
                    projectLink || "https://gitlab.com/mutant-review1/mutant-review"
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Mutant Review in GitLab
                  <ExternalLink size={14} />
                </a>
              </div>
            ) : dialog === "search" ? (
              <div className="modal-body">
                <input
                  aria-label="Search pages and evidence"
                  className="search-input"
                  placeholder="Search pages, findings, evidence…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <div className="search-results">
                  {navigation
                    .filter((n) =>
                      `${n.label} ${n.key === "findings" ? "shipping boundary mutant $100" : ""}`
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                    )
                    .map((n) => (
                      <button key={n.key} onClick={() => navigate(n.key)}>
                        <n.icon size={18} />
                        <span>{n.label}</span>
                        <ArrowRight size={16} />
                      </button>
                    ))}
                  {!navigation.some((n) =>
                    `${n.label} ${n.key === "findings" ? "shipping boundary mutant $100" : ""}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  ) && (
                    <p className="muted">
                      No matching evidence. Try “shipping” or “receipts”.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              finding && (
                <div className="modal-body">
                  <p>{finding.requirement}</p>
                  <Patch finding={finding} />
                  <p className="hash-label">
                    SHA-256 <code>{finding.proposal.patchHash}</code>
                  </p>
                  <div className="approval-explanation">
                    <ShieldCheck size={18} />
                    <span>
                      Approval is bound to this exact patch and source revision.
                      It does not authorize verification, a lesson, a merge, or
                      deployment.
                    </span>
                  </div>
                  <div className="receipt-actions">
                    <button
                      className="button secondary"
                      onClick={() => void copy(finding.proposal.patch)}
                    >
                      <Copy size={14} />
                      {copied ? "Copied" : "Copy patch"}
                    </button>
                    {gitlabLink("Open approval workflow", "button primary")}
                  </div>
                </div>
              )
            )}
          </section>
        </div>
      )}
    </>
  );
}

function Metric({
  title,
  value,
  icon,
  tone,
  subtitle,
  foot,
}: {
  title: string;
  value: string;
  icon: ReactNode;
  tone: string;
  subtitle: string;
  foot: string;
}) {
  return (
    <section className={`metric ${tone}`}>
      <div className="metric-label">
        {title}
        {icon}
      </div>
      <div className="metric-value">
        {value}
        <div className="metric-spark" aria-hidden="true">
          {value.endsWith("%") ? (
            <span className="metric-track">
              <i style={{ width: value }} />
            </span>
          ) : (
            icon
          )}
        </div>
      </div>
      <div className="metric-subtitle">
        <span className="tiny-dot" />
        {subtitle}
      </div>
      <p>{foot}</p>
    </section>
  );
}
function Boundary({
  amount,
  result,
  label,
  tested,
}: {
  amount: string;
  result: string;
  label: string;
  tested: boolean;
}) {
  return (
    <div className={`boundary ${tested ? "" : "missing"}`}>
      <span className="boundary-label">{label}</span>
      <strong>{amount}</strong>
      <span className="boundary-result">{result}</span>
      <span className="boundary-status">
        {tested ? <CircleCheck size={13} /> : <Circle size={13} />}{" "}
        {tested ? "Tested" : "Missing assertion"}
      </span>
    </div>
  );
}
function Workflow({
  evidence,
  onGitlab,
  link,
}: {
  evidence: Evidence;
  onGitlab: () => void;
  link?: string | null;
}) {
  const stages = [
    {
      title: "Baseline validated",
      caption: `${evidence.baseline.tests} tests ${evidence.baseline.status}`,
      status: evidence.baseline.status === "passed" ? "done" : "pending",
    },
    {
      title: "Mutation analysis",
      caption: `${evidence.mutation.mutants.length} mutants · ${formatTime(evidence.mutation.durationMs)}`,
      status: evidence.mutation.status === "complete" ? "done" : "pending",
    },
    {
      title: "Repair proposed",
      caption: `${evidence.findings.length} behavioral gap identified`,
      status: evidence.findings.length ? "done" : "pending",
    },
    {
      title: "Human approval",
      caption: "Review the exact test patch",
      status: "current",
    },
    {
      title: "Verify & learn",
      caption: "Fresh proof, then a lesson",
      status: "pending",
    },
  ];
  return (
    <section className="panel workflow">
      <div className="panel-heading">
        <h2>Review workflow</h2>
        <MoreHorizontal size={17} />
      </div>
      <div className="workflow-steps">
        {stages.map((s, i) => (
          <div className={`workflow-step ${s.status}`} key={s.title}>
            <span className="step-node">
              {s.status === "done" ? (
                <Check size={12} />
              ) : s.status === "current" ? (
                <span />
              ) : (
                i + 1
              )}
            </span>
            <div>
              <b>{s.title}</b>
              <small>{s.caption}</small>
              {s.status === "current" && (
                <Badge tone="amber">Awaiting approval</Badge>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="workflow-footer">
        <span>
          <ShieldCheck size={14} />
          Human approval is the next step
        </span>
        {link ? (
          <a
            className="button primary"
            href={link}
            target="_blank"
            rel="noreferrer"
          >
            Continue in GitLab
            <ArrowUpRight size={14} />
          </a>
        ) : (
          <button className="button primary" onClick={onGitlab}>
            Continue in GitLab
            <ArrowUpRight size={14} />
          </button>
        )}
      </div>
    </section>
  );
}

/** Measured counts only: a missing or null value reads "Not measured", never zero. */
const tally = (n: number | null | undefined) =>
  n == null ? "Not measured" : String(n).padStart(2, "0");
const oneLine = (code: string) => {
  const flat = code.replace(/\s+/g, " ").trim();
  return flat.length > 90 ? `${flat.slice(0, 89)}…` : flat;
};
function MutationLine({ original, replacement }: { original: string; replacement: string }) {
  return (
    <>
      <code>{oneLine(original)}</code>
      <span aria-hidden="true"> → </span>
      <span className="sr-only"> becomes </span>
      <code>{oneLine(replacement)}</code>
    </>
  );
}

function SavingsTiles({
  savings: s,
  policy,
}: {
  savings?: Evidence["savings"];
  policy?: string;
}) {
  const tone = (n: number | null | undefined, measured: string) =>
    n == null ? "neutral unmeasured" : measured;
  return (
    <section className="savings" aria-labelledby="savings-title">
      <h2 id="savings-title" className="section-label">
        Compute saved
      </h2>
      <div className="metrics-grid">
        <Metric
          title="Mutants avoided"
          value={tally(s?.mutantsAvoided)}
          icon={<Cpu size={16} />}
          tone={tone(s?.mutantsAvoided, "green")}
          subtitle={
            !s
              ? "Not recorded for this run"
              : s.mutantsWholeFiles != null
                ? `of ${s.mutantsWholeFiles} whole-file mutants · ${s.mutantsChangedLines} run`
                : `${s.mutantsChangedLines} run on changed lines · whole files not measured`
          }
          foot="Skipped by changed-line scoping"
        />
        <Metric
          title="Arid mutants filtered"
          value={tally(s?.aridFiltered)}
          icon={<Funnel size={16} />}
          tone={tone(s?.aridFiltered, "neutral")}
          subtitle={policy ? `Policy ${policy}` : "Deterministic noise filter"}
          foot="Removed before any AI call"
        />
        <Metric
          title="AI calls avoided"
          value={tally(s?.aiCallsAvoided)}
          icon={<Sparkles size={16} />}
          tone={tone(s?.aiCallsAvoided, "green")}
          subtitle="Arid + over-budget findings"
          foot="Tokens never spent on noise"
        />
        <Metric
          title="Lessons in agent memory"
          value={tally(s?.lessonsInMemory)}
          icon={<BookOpen size={16} />}
          tone={tone(s?.lessonsInMemory, "purple")}
          subtitle="Compiled into AGENTS.md"
          foot="Mistakes future agents skip"
        />
      </div>
    </section>
  );
}

function TriagePanel({ triage }: { triage?: Evidence["triage"] }) {
  if (!triage) return null;
  const ranked = [...triage.ranked].sort((a, b) => a.rank - b.rank);
  return (
    <section className="panel triage-panel" aria-labelledby="triage-title">
      <div className="panel-heading">
        <div className="panel-title">
          <span className="icon-tile amber">
            <ListFilter size={17} />
          </span>
          <h2 id="triage-title">Triage: commented on the MR</h2>
        </div>
        <Badge tone="purple">{triage.policy}</Badge>
      </div>
      <p className="triage-summary">
        {triage.considered} surviving considered · {triage.arid.length} arid
        filtered · {ranked.length} of 3 comments used · {triage.overflow} over
        budget
      </p>
      {ranked.length === 0 ? (
        <Empty icon={CircleCheck} title="Nothing worth a comment">
          No actionable surviving mutants remained after the arid filter.
        </Empty>
      ) : (
        <ol className="ledger-rows">
          {ranked.map((item) => (
            <li className="ledger-row" key={item.fingerprint}>
              <span className="icon-tile rank-tile">
                <span className="sr-only">Rank </span>
                {item.rank}
              </span>
              <div>
                <b className="mutation-line">
                  <MutationLine
                    original={item.original}
                    replacement={item.replacement}
                  />
                </b>
                <p>{item.why}</p>
                <span className="ledger-meta">
                  <span>
                    {item.path}:{item.line}
                  </span>
                  <span>{item.operator}</span>
                  <span>
                    {item.status === "NoCoverage" ? "No coverage" : "Survived"}
                  </span>
                </span>
              </div>
              <Badge
                tone={
                  item.priority === "high"
                    ? "red"
                    : item.priority === "medium"
                      ? "amber"
                      : "neutral"
                }
              >
                {item.priority} priority
              </Badge>
            </li>
          ))}
        </ol>
      )}
      <details className="receipt-patch-details triage-arid">
        <summary>
          {triage.arid.length} arid{" "}
          {triage.arid.length === 1 ? "mutant" : "mutants"} filtered before any
          AI call
        </summary>
        {triage.arid.length ? (
          <ul>
            {triage.arid.map((item) => (
              <li key={item.fingerprint}>
                <code>
                  {item.path}:{item.line}
                </code>{" "}
                — {item.reason}
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">None in this run.</p>
        )}
      </details>
    </section>
  );
}

/** Reads committed approval history; an absent ledger is an empty history, not an error. */
function RepairLedger({ projectUrl }: { projectUrl?: string | null }) {
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/ledger", { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error || "The repair ledger could not be read.");
        setEntries(result.entries);
      })
      .catch((err) => {
        if (err.name !== "AbortError") setError(err.message);
      });
    return () => controller.abort();
  }, []);
  const rows = [...(entries ?? [])].sort(
    (a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt),
  );
  const count = (kind: LedgerEntry["kind"]) =>
    rows.filter((entry) => entry.kind === kind).length;
  return (
    <section
      className="panel repair-ledger"
      aria-labelledby="repair-ledger-title"
      aria-busy={!entries && !error}
    >
      <div className="panel-heading">
        <div className="panel-title">
          <span className="icon-tile purple">
            <ShieldCheck size={17} />
          </span>
          <h2 id="repair-ledger-title">Useless tests caught</h2>
        </div>
        {entries && (
          <Badge tone="purple">
            {count("repaired")} repaired · {count("rejected-proposal")}{" "}
            hallucinations blocked
          </Badge>
        )}
      </div>
      {error ? (
        <div className="notice receipt-warning" role="alert">
          <TriangleAlert size={18} />
          <p>{error}</p>
        </div>
      ) : !entries ? (
        <p className="triage-summary" role="status">
          Reading the repair ledger…
        </p>
      ) : rows.length === 0 ? (
        <Empty icon={ShieldCheck} title="No repairs recorded yet">
          Approve a finding on an MR with <code>@mutant-review apply 1</code>.
        </Empty>
      ) : (
        <ol className="ledger-rows">
          {rows.map((entry) => {
            const mr = entry.mergeRequestIid;
            const mrUrl =
              projectUrl && mr ? `${projectUrl}/-/merge_requests/${mr}` : null;
            const who = entry.actor && `@${entry.actor.replace(/^@/, "")}`;
            return (
              <li className="ledger-row" key={entry.id}>
                <span
                  className={`icon-tile ${entry.kind === "repaired" ? "green" : entry.kind === "rejected-proposal" ? "amber" : ""}`}
                >
                  {entry.kind === "repaired" ? (
                    <CircleCheck size={18} />
                  ) : entry.kind === "rejected-proposal" ? (
                    <ShieldX size={18} />
                  ) : (
                    <TriangleAlert size={18} />
                  )}
                </span>
                <div>
                  <b>
                    {entry.kind === "repaired"
                      ? entry.test
                        ? `New test: “${entry.test.name}”`
                        : "Repaired"
                      : entry.kind === "rejected-proposal"
                        ? "AI draft rejected: did not fail on the mutant — hallucination blocked"
                        : "Override"}
                  </b>
                  {entry.mutant && (
                    <p className="mutation-line">
                      {entry.kind === "repaired" ? "Kills " : "Mutant "}
                      <MutationLine
                        original={entry.mutant.original}
                        replacement={entry.mutant.replacement}
                      />{" "}
                      at {entry.mutant.path}:{entry.mutant.line}
                    </p>
                  )}
                  <p>{entry.reason}</p>
                  <span className="ledger-meta">
                    {entry.kind === "repaired" ? (
                      <span>Approved by {who || "an unrecorded approver"}</span>
                    ) : (
                      who && <span>By {who}</span>
                    )}
                    {mrUrl ? (
                      <a href={mrUrl} target="_blank" rel="noreferrer">
                        MR !{mr}
                        <ArrowUpRight size={11} />
                      </a>
                    ) : (
                      mr && <span>MR !{mr}</span>
                    )}
                    {entry.test && <code>{entry.test.path}</code>}
                    <code>{trimSha(entry.headSha)}</code>
                    <span>{displayTime(entry.recordedAt)}</span>
                    {entry.lessonId && <span>Lesson {entry.lessonId}</span>}
                  </span>
                </div>
                {entry.kind !== "repaired" ? (
                  <Badge
                    tone={entry.kind === "rejected-proposal" ? "amber" : "neutral"}
                  >
                    {entry.kind === "rejected-proposal" ? "Blocked" : "Override"}
                  </Badge>
                ) : entry.scoreBefore == null && entry.scoreAfter == null ? (
                  <span className="small muted">Score not recorded</span>
                ) : (
                  <strong>
                    <span className="sr-only">Mutation score </span>
                    {percent(entry.scoreBefore)} → {percent(entry.scoreAfter)}
                  </strong>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
