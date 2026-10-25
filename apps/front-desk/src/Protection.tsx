import type { ReactNode } from "react";
import {
  ArrowRight,
  FileDiff,
  FlaskConical,
  GitCompareArrows,
  Leaf,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Sparkles,
  UserCheck,
} from "lucide-react";
import { formatGrams } from "../../../packages/review-core/src/footprint";
import type { Evidence, EvidenceProtection } from "./evidence";

type Lost = EvidenceProtection["lost"][number];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** The engine writes `code` spans in its sentences (they also go into MR comments); render them as code. */
const prose = (text: string) => text.split(/`([^`]+)`/g).map((part, index) => (index % 2 ? <code key={index}>{part}</code> : part));
const file = (path: string) => path.split("/").pop() ?? path;
const flat = (code: string, max = 70) => {
  const text = code.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

function headline(p: EvidenceProtection) {
  switch (p.status) {
    case "lost":
      return {
        tone: "lost",
        icon: <ShieldAlert size={22} />,
        title: p.lost.length === 1 ? "A test edit removed protection" : `Test edits removed protection from ${p.lost.length} changes`,
        body: `On the target branch, a test failed when ${p.lost.length === 1 ? "this change was made" : "these changes were made"}. After the edit, every test still passes with ${p.lost.length === 1 ? "it" : "them"}. Coverage and green checks cannot show this: every line still runs.`,
      };
    case "held":
      return {
        tone: "held",
        icon: <ShieldCheck size={22} />,
        title: "Test edits kept every protection",
        body: p.reason ?? "The edited tests still notice everything they noticed on the target branch.",
      };
    case "not-applicable":
      return { tone: "neutral", icon: <ShieldCheck size={22} />, title: "No existing test changed", body: p.reason ?? "Nothing to compare." };
    default:
      return {
        tone: "unknown",
        icon: <ShieldQuestion size={22} />,
        title: "The protection check did not finish",
        body: `${p.reason ?? "Unknown reason."} The merge gate treats this as inconclusive, never as a pass.`,
      };
  }
}

/** Compact line on the overview, under the footprint strip. Hidden when no existing test changed. */
export function ProtectionStrip({ protection: p, onOpen }: { protection?: EvidenceProtection | null; onOpen: () => void }) {
  if (!p || p.status === "not-applicable") return null;
  const first = p.lost[0];
  const test = first?.caughtBy[0];
  return (
    <button className={`protection-strip ${p.status === "lost" ? "lost" : p.status === "held" ? "held" : "unknown"}`} onClick={onOpen}>
      <span className="protection-strip-icon">
        {p.status === "lost" ? <ShieldAlert size={15} /> : p.status === "held" ? <ShieldCheck size={15} /> : <ShieldQuestion size={15} />}
      </span>
      <span className="protection-strip-copy">
        <b>
          {p.status === "lost"
            ? `Weakened test caught: ${plural(p.lost.length, "change")} no longer noticed`
            : p.status === "held"
              ? `Test edits kept all ${p.rechecked} protections they had`
              : "Lost-protection check inconclusive"}
          {p.scenario && <span className="protection-demo-tag">Demo scenario 2 · separate MR</span>}
        </b>
        <span>
          {first && test ? (
            <>
              “{flat(test.name, 60)}” caught <code>{flat(first.original, 30)}</code> → <code>{flat(first.replacement, 30)}</code> on the target
              branch; after the edit no test does.
            </>
          ) : (
            p.reason
          )}
        </span>
      </span>
      <span className="text-button">
        View test changes
        <ArrowRight size={15} />
      </span>
    </button>
  );
}

function Step({ label, value, detail, tone = "" }: { label: string; value: ReactNode; detail: ReactNode; tone?: string }) {
  return (
    <div className={`protection-step ${tone}`}>
      <small>{label}</small>
      <b>{value}</b>
      <span>{detail}</span>
    </div>
  );
}

function TestDiff({ item }: { item: Lost }) {
  const diff = item.testDiff;
  if (!diff) return null;
  return (
    <div className="protection-diff" aria-label={`How the MR changed ${diff.name}`}>
      <div className="protection-diff-label">
        <FileDiff size={13} />
        <span>{diff.file}</span>
        <span className={`badge ${item.caughtBy[0]?.fate === "weakened" ? "dark-amber" : "dark-red"}`}>
          {item.caughtBy[0]?.fate === "weakened" ? "Assertion changed" : "Test removed"}
        </span>
      </div>
      <pre>
        {diff.lines.map((line, index) => (
          <span key={index} className={line.kind === "-" ? "del" : line.kind === "+" ? "add" : "ctx"}>
            <i aria-hidden="true">{line.kind === " " ? " " : line.kind}</i>
            <span className="sr-only">{line.kind === "-" ? "removed: " : line.kind === "+" ? "added: " : ""}</span>
            {line.text || " "}
            {"\n"}
          </span>
        ))}
      </pre>
    </div>
  );
}

function LostCard({ item, index }: { item: Lost; index: number }) {
  const test = item.caughtBy[0]!;
  return (
    <section className="panel protection-lost">
      <div className="panel-heading">
        <div className="panel-title">
          <span className="icon-tile red">
            <ShieldAlert size={15} />
          </span>
          <h2>
            Lost {index + 1}: <code>{item.path}:{item.line}</code>
          </h2>
        </div>
        <span className="badge red">{item.status === "NoCoverage" ? "No test runs it now" : "Survives every test now"}</span>
      </div>
      <div className="protection-lost-body">
        <div className="protection-lost-change">
          <h3>The change no test notices any more</h3>
          <div className="protection-mutation">
            <span>
              <small>Code</small>
              <code>{flat(item.original, 80)}</code>
            </span>
            <ArrowRight size={14} aria-hidden="true" />
            <span className="mutated">
              <small>Mutant ({item.operator})</small>
              <code>{flat(item.replacement, 80)}</code>
            </span>
          </div>
          <p className="protection-why">{prose(item.why)}</p>
        </div>
        <div className="protection-lost-test">
          <h3>The test that used to catch it</h3>
          <div className="protection-test-name">
            <b>{test.name}</b>
            <span>
              {file(test.file)}
              {test.line ? `:${test.line}` : ""} · {test.fate === "weakened" ? "edited in this change" : "removed, renamed or skipped"}
            </span>
          </div>
          {test.failure && (
            <p className="protection-failure">
              On the target branch it failed with <code>{flat(test.failure, 90)}</code>
            </p>
          )}
          <TestDiff item={item} />
        </div>
      </div>
    </section>
  );
}

export function ProtectionPage({ evidence, onFindings }: { evidence: Evidence; onFindings: () => void }) {
  const p = evidence.protection;
  if (!p)
    return (
      <section className="panel error-panel">
        <ShieldQuestion size={25} />
        <h2>No lost-protection result for this run</h2>
        <p>
          Runs from before the check have no result. Run <code>npm run demo</code> or open an MR that edits a test.
        </p>
      </section>
    );
  const head = headline(p);
  const gated = !p.scenario;
  return (
    <>
      {p.scenario && (
        <div className="protection-scenario">
          <span className="badge purple">Demonstration fixture</span>
          <span>
            A second, separate merge request, executed for real in a scratch repository: the target branch has the exact-$100 test that <code>apply 1</code>{" "}
            commits, and the change loosens <code>toBe(0)</code> to <code>toBeLessThanOrEqual(500)</code>. Shown here, not part of this review's gate.
          </span>
        </div>
      )}
      <section className={`panel protection-hero ${head.tone}`}>
        <div className="protection-hero-copy">
          <span className="protection-hero-icon">{head.icon}</span>
          <div>
            <span className="protection-kicker">Lost-protection check</span>
            <h2>{head.title}</h2>
            <p>{head.body}</p>
          </div>
        </div>
        <div className="protection-steps" aria-label="What the check ran">
          <Step label="Tests edited, moved or deleted" value={p.changedTests.length} detail={`${p.testsInRun.length} in the mutation run`} />
          <Step
            label="On the target branch"
            value={`${p.guarded} of ${p.baseMutants}`}
            detail={`mutants a changed test killed, in ${p.subjects.length ? p.subjects.map(file).join(", ") : "no imported code"}`}
          />
          <Step
            label="Re-checked at the head"
            value={p.rechecked}
            detail={p.onChangedLines ? `${p.onChangedLines} on changed lines go to the changed-line review` : "only those mutants, nothing else"}
          />
          <Step
            label={p.status === "lost" ? "Lost" : "Still caught"}
            value={p.status === "lost" ? `${p.lost.length} of ${p.rechecked}` : p.held}
            detail={p.status === "lost" ? `${p.held} still caught · gate ${gated ? "blocks" : "would block"}` : p.status === "held" ? "nothing lost" : "not compared"}
            tone={p.status === "lost" ? "lost" : p.status === "held" ? "held" : ""}
          />
        </div>
      </section>

      {p.lost.map((item, index) => (
        <LostCard key={item.fingerprint} item={item} index={index} />
      ))}

      <div className="protection-columns">
        <section className="panel">
          <div className="panel-heading">
            <div className="panel-title">
              <span className="icon-tile purple">
                <GitCompareArrows size={15} />
              </span>
              <h2>How the check works</h2>
            </div>
            <span className="badge neutral">Runs only when a test changes</span>
          </div>
          <ol className="protection-how">
            <li>
              <b>Mutate the target branch, narrowly.</b> Only the production files the edited tests import, in a detached worktree of the target
              branch, with the project's own Stryker configuration.
            </li>
            <li>
              <b>Keep what the edited tests caught.</b> Mutants a changed test killed there. Mutants only unchanged tests killed are still killed by
              them.
            </li>
            <li>
              <b>Re-run just those at the head.</b> Killed before and not now is protection the change removed, whoever made it: an agent turning a
              red build green, or a person tidying tests.
            </li>
          </ol>
          {p.cost && (
            <p className="protection-cost">
              <Leaf size={13} />
              This check cost {formatGrams(p.cost.sciG)} ({p.cost.cpuSeconds} CPU-s, measured) and runs only on MRs that edit, move or delete a test.
            </p>
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div className="panel-title">
              <span className="icon-tile">
                <UserCheck size={15} />
              </span>
              <h2>What happens next</h2>
            </div>
          </div>
          <ul className="protection-next">
            <li>
              <FlaskConical size={14} />
              <span>
                <b>Restore it.</b> Put the assertion back, or, if the requirement changed, take the new expected value from the new requirement.
              </span>
            </li>
            <li>
              <Sparkles size={14} />
              <span>
                <b>Or let the agent draft it.</b> Mentioning the flow ranks lost protection first; its test must pass on the code and fail on this
                mutant before you see it. <code>apply</code> commits it and teaches AGENTS.md not to loosen tests.
              </span>
            </li>
            <li>
              <ShieldCheck size={14} />
              <span>
                <b>Or waive it in writing.</b> A Maintainer's <code>override</code> with a reason passes the gate and opens a test-debt issue listing
                what was lost.
              </span>
            </li>
          </ul>
          {gated && p.lost.length > 0 && (
            <button className="text-button protection-findings" onClick={onFindings}>
              See it among the findings
              <ArrowRight size={15} />
            </button>
          )}
        </section>
      </div>
    </>
  );
}
