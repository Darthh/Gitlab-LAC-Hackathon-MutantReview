import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Cpu,
  Factory,
  FlaskConical,
  GitPullRequestArrow,
  Leaf,
  MapPin,
  PlugZap,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  FOOTPRINT_SOURCES,
  GRID_REGIONS,
  footprint as price,
  formatGrams,
} from "../../../packages/review-core/src/footprint";
import type { Evidence, EvidenceFootprint } from "./evidence";

const wh = (value: number) =>
  value >= 1 ? `${value.toFixed(2)} Wh` : `${(value * 1000).toFixed(1)} mWh`;
const grams = (value: number | null | undefined) =>
  value == null ? "Not measured" : formatGrams(value);

function Tile({
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
        <span className="footprint-tile-value">{value}</span>
      </div>
      <div className="metric-subtitle">
        <span className="tiny-dot" />
        {subtitle}
      </div>
      <p>{foot}</p>
    </section>
  );
}

/** Compact line on the overview: what this review cost, linking to the full receipt. */
export function FootprintStrip({
  footprint: f,
  onOpen,
}: {
  footprint?: EvidenceFootprint | null;
  onOpen: () => void;
}) {
  if (!f) return null;
  return (
    <button className="footprint-strip" onClick={onOpen}>
      <span className="icon-tile green">
        <Leaf size={15} />
      </span>
      <span className="footprint-strip-copy">
        <b>This review cost {grams(f.actual.sciG)}</b>
        <span>
          SCI per merge-request review · {wh(f.actual.energyWh)} ·{" "}
          {f.actual.cpuSeconds} CPU-s{" "}
          {f.actual.cpuMeasured ? "measured" : "assumed"} · {f.region} grid
          {f.savedPercent ? ` · ${f.savedPercent.toFixed(0)}% of mutation energy avoided` : ""}
        </span>
      </span>
      <span className="text-button">
        View footprint
        <ArrowRight size={15} />
      </span>
    </button>
  );
}

interface EnergySummary {
  repository: string;
  measured: number;
  machine: string;
  changedLines: { cpuSeconds: number; energyWh: number; sciG: number; mutants: number };
  wholeFile: { cpuSeconds: number; energyWh: number; sciG: number; mutants: number };
  modelInput?: { findingsSent: number; findingsOpen: number; tokensAvoidedApprox: number; avoidedPercent: number } | null;
  savedPercent: number;
  projectionErrorPercent: number | null;
  reportUrl: string;
}

function Bar({
  label,
  value,
  max,
  detail,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  detail: string;
  tone: "green" | "amber" | "neutral" | "purple";
}) {
  const width = max > 0 ? Math.max(2, (100 * value) / max) : 0;
  return (
    <div className="footprint-bar">
      <div className="footprint-bar-label">
        <span>{label}</span>
        <b>{detail}</b>
      </div>
      <div
        className="footprint-bar-track"
        role="img"
        aria-label={`${label}: ${detail}`}
      >
        <i className={tone} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

const PRACTICES = (e: Evidence) => {
  const s = e.savings;
  const f = e.footprint;
  return [
    {
      icon: <FlaskConical size={15} />,
      title: "Mutate only the diff",
      body: "Stryker runs on the changed line ranges, never the whole file or suite.",
      effect: s?.mutantsWholeFiles != null ? `${s.mutantsChangedLines} of ${s.mutantsWholeFiles} mutants run here` : `${s?.mutantsChangedLines ?? 0} mutants run`,
    },
    {
      icon: <Sparkles size={15} />,
      title: "No model in CI, one model call at most",
      body: "Deterministic triage drops noise and caps findings at three before any AI runs; drafting happens once, only when a person asks.",
      effect: `${e.metrics.modelCalls ?? 0} model calls in this review · ${f?.modelCalls.avoided ?? s?.aiCallsAvoided ?? 0} findings filtered${s?.modelInput ? ` · ≈${s.modelInput.tokensAvoidedApprox.toLocaleString("en-US")} prompt tokens kept out` : ""}`,
    },
    {
      icon: <GitPullRequestArrow size={15} />,
      title: "Catch it before the pipeline",
      body: "The MCP pre-push check lets a coding agent verify its own tests locally, so a useless test never costs an MR pipeline or a review round.",
      effect: "mutation_check · verify_test",
    },
    {
      icon: <ShieldCheck size={15} />,
      title: "Check edited tests narrowly, and only when they change",
      body: "The lost-protection check runs only on MRs that edit, move or delete a test, mutates only the code those tests import on the target branch, and re-runs only what they caught.",
      effect: e.protection && e.protection.status !== "not-applicable"
        ? `${e.protection.rechecked} re-checked${e.protection.cost ? ` · ${e.protection.cost.cpuSeconds} CPU-s` : ""}${e.protection.scenario ? " (demo scenario)" : ""}`
        : "not needed in this review",
    },
    {
      icon: <PlugZap size={15} />,
      title: "Spend nothing on work that will be thrown away",
      body: "MR jobs are interruptible, docs-only MRs skip mutation entirely, and Stryker's incremental cache reuses results across pushes.",
      effect: "interruptible · rules:changes · incremental",
    },
    {
      icon: <Leaf size={15} />,
      title: "Learn once",
      body: "Approved repairs become rules in AGENTS.md, so agents stop writing the same useless test and the next review has less to find.",
      effect: `${s?.lessonsInMemory ?? 0} lessons in agent memory`,
    },
  ];
};

export function FootprintPage({ evidence }: { evidence: Evidence }) {
  const f = evidence.footprint;
  const [energy, setEnergy] = useState<EnergySummary | null>(null);
  const [region, setRegion] = useState(f?.region ?? "us-east1");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/energy", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then(setEnergy)
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  if (!f)
    return (
      <section className="panel error-panel">
        <Leaf size={25} />
        <h2>No footprint recorded for this run</h2>
        <p>
          Runs from before footprint accounting have no receipt. Run{" "}
          <code>npm run demo</code> or open an MR to record one.
        </p>
      </section>
    );
  const regions = Object.entries(GRID_REGIONS)
    .map(([name, info]) => ({ name, ...info, sciG: price(f.measured, info.gridIntensity).sciG }))
    .sort((a, b) => a.sciG - b.sciG);
  const worst = Math.max(...regions.map((item) => item.sciG));
  const picked = regions.find((item) => item.name === region) ?? regions[0]!;
  const comparison = f.changedLinesRun && f.projectedWholeFile ? [f.changedLinesRun, f.projectedWholeFile] : null;
  const wholeFileScope = comparison !== null && comparison[0].mutants === comparison[1].mutants;
  const dryRunSkipped = Boolean(evidence.savings?.wholeFileCount?.includes("no dry run"));
  const steps = f.steps ?? [];
  const biggestStep = Math.max(...steps.map((step) => step.sciG), 1e-9);
  return (
    <>
      <section className="footprint-hero panel">
        <div className="footprint-hero-total">
          <span className="icon-tile green">
            <Leaf size={17} />
          </span>
          <div>
            <span className="footprint-kicker">Software Carbon Intensity</span>
            <strong>{grams(f.actual.sciG)}</strong>
            <span>
              per merge-request review · range {grams(f.range.lowG)} –{" "}
              {grams(f.range.highG)}
            </span>
          </div>
        </div>
        <div className="footprint-equation" aria-label="SCI equation with this review's values">
          <div>
            <small>E · energy</small>
            <b>{wh(f.actual.energyWh)}</b>
            <span>{f.actual.cpuSeconds} CPU-s {f.actual.cpuMeasured ? "measured" : "assumed"} · {Math.round(f.actual.utilization * 100)}% of {f.machine.vCpus} vCPU</span>
          </div>
          <em>×</em>
          <div>
            <small>I · grid intensity</small>
            <b>{f.gridIntensity} g/kWh</b>
            <span>{f.region} · {GRID_REGIONS[f.region]?.location ?? ""}</span>
          </div>
          <em>+</em>
          <div>
            <small>M · embodied</small>
            <b>{grams(f.actual.embodiedG)}</b>
            <span>host share over 4 years</span>
          </div>
          <em>per</em>
          <div>
            <small>R · functional unit</small>
            <b>1 review</b>
            <span>one MR review job</span>
          </div>
        </div>
      </section>

      <div className="metrics-grid">
        <Tile
          title="Energy"
          value={wh(f.actual.energyWh)}
          icon={<PlugZap size={16} />}
          tone="green"
          subtitle={`PUE ${1.1} · CPU + memory`}
          foot="Reserved runner VM, measured CPU time"
        />
        <Tile
          title="CPU time"
          value={`${f.actual.cpuSeconds}s`}
          icon={<Cpu size={16} />}
          tone={f.actual.cpuMeasured ? "purple" : "neutral"}
          subtitle={f.actual.cpuMeasured ? "Measured from the process tree" : "Not measurable here: full load assumed"}
          foot={`${(f.measured.wallMs / 1000).toFixed(1)} s wall on ${f.machine.vCpus} vCPU / ${f.machine.memoryGb} GB`}
        />
        <Tile
          title="Mutation energy avoided"
          value={wholeFileScope ? "Nothing to skip" : f.savedPercent == null ? "Not projected" : `${f.savedPercent.toFixed(0)}%`}
          icon={<FlaskConical size={16} />}
          tone={f.savedPercent && !wholeFileScope ? "green" : "neutral unmeasured"}
          subtitle={wholeFileScope ? "This change spans the whole file" : comparison ? `${comparison[0].mutants} of ${comparison[1].mutants} mutants run` : "Needs a whole-file count"}
          foot="Changed lines vs whole files"
        />
        <Tile
          title="Embodied share"
          value={grams(f.actual.embodiedG)}
          icon={<Factory size={16} />}
          tone="neutral"
          subtitle={`${Math.round((100 * f.actual.embodiedG) / Math.max(f.actual.sciG, 1e-9))}% of this review`}
          foot="Server manufacturing, time-shared"
        />
      </div>

      <div className="footprint-columns">
        <section className="panel">
          <div className="panel-heading">
            <div className="panel-title">
              <span className="icon-tile green">
                <FlaskConical size={16} />
              </span>
              <h2>Changed lines vs whole files</h2>
            </div>
            <span className="badge green">This review</span>
          </div>
          <div className="footprint-body">
            {comparison ? (
              <>
                <Bar
                  label={`Changed lines · ${comparison[0].mutants} mutants (measured)`}
                  value={comparison[0].sciG}
                  max={comparison[1].sciG}
                  detail={grams(comparison[0].sciG)}
                  tone="green"
                />
                <Bar
                  label={`Whole files · ${comparison[1].mutants} mutants (projected)`}
                  value={comparison[1].sciG}
                  max={comparison[1].sciG}
                  detail={grams(comparison[1].sciG)}
                  tone="amber"
                />
                <p className="footprint-note">
                  {wholeFileScope
                    ? `This change touches every mutable line of its file, so scoping had nothing to skip${dryRunSkipped ? ", and the review skipped the whole-file dry run as well: there was nothing extra to count" : ""}. On real MRs scoping usually saves most of the work: see the open-source benchmark below.`
                    : "Projection: the whole-file dry run (fixed cost, measured) plus the measured cost per changed-line mutant times the whole-file count."}
                </p>
              </>
            ) : (
              <p className="footprint-note">
                No whole-file projection for this run: it needs at least one changed-line mutant and the
                whole-file count.
              </p>
            )}
            {steps.length > 0 && (
              <div className="footprint-steps">
                <h3>Where this review's energy went</h3>
                {steps.map((step) => (
                  <Bar
                    key={step.step}
                    label={`${step.step} · ${step.cpuSeconds} CPU-s`}
                    value={step.sciG}
                    max={biggestStep}
                    detail={`${wh(step.energyWh)} · ${grams(step.sciG)}`}
                    tone={step.step.startsWith("Stryker") ? "green" : "neutral"}
                  />
                ))}
                <p className="footprint-note">
                  The whole-file count is the price of measuring what scoping avoided; it is reported, not hidden.
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div className="panel-title">
              <span className="icon-tile purple">
                <MapPin size={16} />
              </span>
              <h2>Same review, other regions</h2>
            </div>
            <label className="footprint-select">
              <span className="sr-only">Compare region</span>
              <select value={region} onChange={(event) => setRegion(event.target.value)}>
                {regions.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="footprint-body">
            {regions.map((item) => (
              <Bar
                key={item.name}
                label={`${item.name} · ${item.location}${item.name === f.region ? " · this run" : ""}`}
                value={item.sciG}
                max={worst}
                detail={`${grams(item.sciG)} · ${item.cfePercent}% CFE`}
                tone={item.name === f.region ? "purple" : item.name === picked.name ? "green" : "neutral"}
              />
            ))}
            <p className="footprint-note">
              {picked.name === f.region
                ? "Pick a region to compare. GitLab's hosted Arm64 runners run in us-central1; set MUTANT_REVIEW_GRID_REGION for your own runners."
                : `In ${picked.name} this exact review would emit ${grams(picked.sciG)}, ${Math.round(100 - (100 * picked.sciG) / Math.max(f.actual.sciG, 1e-9))}% less. Only operational emissions change; energy and embodied share stay the same.`}
            </p>
          </div>
        </section>
      </div>

      {energy && (
        <section className="savings" aria-labelledby="energy-title">
          <h2 id="energy-title" className="section-label">
            Measured on {energy.measured} merged PRs of {energy.repository} ·{" "}
            <a href={energy.reportUrl} target="_blank" rel="noreferrer">
              methodology
            </a>
          </h2>
          <div className="metrics-grid">
            <Tile title="Energy avoided" value={`${energy.savedPercent.toFixed(0)}%`} icon={<Leaf size={16} />} tone="green" subtitle={`${wh(energy.changedLines.energyWh)} instead of ${wh(energy.wholeFile.energyWh)}`} foot={`${Math.round(energy.changedLines.cpuSeconds)} vs ${Math.round(energy.wholeFile.cpuSeconds)} CPU-s, both executed`} />
            <Tile title="SCI, all PRs" value={grams(energy.changedLines.sciG)} icon={<Factory size={16} />} tone="neutral" subtitle={`whole files: ${grams(energy.wholeFile.sciG)}`} foot={`us-east1 grid · ${energy.machine.split(",")[0]}`} />
            {energy.modelInput ? (
              <Tile title="Prompt input kept out" value={energy.modelInput.tokensAvoidedApprox >= 1000 ? `≈${Math.round(energy.modelInput.tokensAvoidedApprox / 1000)}k tokens` : `≈${energy.modelInput.tokensAvoidedApprox} tokens`} icon={<Sparkles size={16} />} tone="purple" subtitle={`${energy.modelInput.findingsSent} of ${energy.modelInput.findingsOpen} open mutants reach a prompt`} foot={`${energy.modelInput.avoidedPercent.toFixed(0)}% of per-finding context · ≈4 chars/token`} />
            ) : (
              <Tile title="CPU time" value={`${Math.round(energy.changedLines.cpuSeconds)}s`} icon={<Cpu size={16} />} tone="purple" subtitle={`whole files: ${Math.round(energy.wholeFile.cpuSeconds)}s`} foot={energy.machine} />
            )}
            <Tile title="Projection error" value={energy.projectionErrorPercent == null ? "n/a" : `${energy.projectionErrorPercent.toFixed(0)}%`} icon={<FlaskConical size={16} />} tone="neutral" subtitle="Per-MR estimate vs executed whole-file run" foot="Median absolute error" />
          </div>
        </section>
      )}

      <section className="panel footprint-practices">
        <div className="panel-heading">
          <div className="panel-title">
            <span className="icon-tile green">
              <Leaf size={16} />
            </span>
            <h2>Sustainable by design</h2>
          </div>
          <span className="badge neutral">Measured in this run</span>
        </div>
        <ol>
          {PRACTICES(evidence).map((practice) => (
            <li key={practice.title}>
              <span className="icon-tile">{practice.icon}</span>
              <div>
                <b>{practice.title}</b>
                <p>{practice.body}</p>
              </div>
              <code>{practice.effect}</code>
            </li>
          ))}
        </ol>
      </section>

      <section className="panel footprint-method">
        <div className="panel-heading">
          <div className="panel-title">
            <h2>Method and boundary</h2>
          </div>
        </div>
        <div className="footprint-body">
          <p>{f.boundary}</p>
          <p>
            Energy follows Cloud Carbon Footprint's GCP coefficients (0.71–4.26 W per vCPU by utilisation,
            0.392 W/GB of memory, PUE 1.1); the range uses lower AMD EPYC and higher earlier GCP coefficients.
            Grid intensity is Google's published 2025 location-based average for the region; the SCI standard
            prefers marginal rates, which are not published for these regions. Embodied emissions are a
            1,611 kgCO2e, 112-vCPU host over 4 years, time- and vCPU-shared. Model inference is outside the
            boundary because no provider publishes per-call energy; Mutant Review minimises the count instead.
          </p>
          <div className="footprint-links">
            {[
              ["SCI (ISO/IEC 21031)", FOOTPRINT_SOURCES.sci],
              ["CCF coefficients", FOOTPRINT_SOURCES.power],
              ["Google region carbon", FOOTPRINT_SOURCES.grid],
              ["GitLab runner regions", FOOTPRINT_SOURCES.runners],
              ["CI/CD carbon study", FOOTPRINT_SOURCES.ciCoefficients],
            ].map(([label, href]) => (
              <a key={href} href={href} target="_blank" rel="noreferrer">
                {label}
                <ArrowUpRight size={12} />
              </a>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
