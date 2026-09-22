"use client";

import { useEffect, useId, useState, useTransition, type KeyboardEvent } from "react";
import type { DeathView, FindingLabel, MatchView } from "@/lib/report/playerReport";
import { formatClock, plural } from "@/lib/report/format";
import { saveVerdict } from "@/app/actions";
import { DeathMarker, RIFT_UNITS, RiftMap, WARD_SIGHT_UNITS } from "./RiftMap";
import { MapLegend } from "./MapLegend";

type Answer = FindingLabel["verdict"];

/** What "right" means for each rule, so answers stay consistent between games. */
const JUDGING_GUIDE: Record<string, string> = {
  "deaths-without-vision":
    "No-ward deaths are right if, with your team's vision shown, no friendly ward was lighting up the spot where you died.",
  "died-with-unspent-gold":
    "Unspent-gold deaths are right if you had a chance to back and spend the gold before that fight.",
  "lane-differential":
    "Lane deficits are right if you really were that far behind your actual lane opponent. The pairing comes from role order and can be wrong.",
};

const ANSWERS: { value: Exclude<Answer, "">; label: string }[] = [
  { value: "tp", label: "Right" },
  { value: "fp", label: "Wrong" },
  { value: "unsure", label: "Can’t tell" },
];

interface MatchExplorerProps {
  match: MatchView;
  /** Death to select on load (from ?t= in the URL). */
  initialT: number | null;
  /** The rule's "a ward counts as close" distance, game units. */
  threshold: number;
}

export function MatchExplorer({ match, initialT, threshold }: MatchExplorerProps) {
  const [selectedT, setSelectedT] = useState<number | null>(initialT);
  const selected = match.deaths.find((d) => d.t === selectedT) ?? null;
  const deathTimes = new Set(match.deaths.map((d) => d.t));

  // Keep the URL in step so a selected death can be linked to directly.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedT === null) url.searchParams.delete("t");
    else url.searchParams.set("t", String(selectedT));
    window.history.replaceState(null, "", url);
  }, [selectedT]);

  const toggle = (t: number) => setSelectedT((cur) => (cur === t ? null : t));

  // Answers on findings, shown immediately and saved in the background.
  const [answers, setAnswers] = useState<Record<string, Answer>>(() =>
    Object.fromEntries(match.findingLabels.map((l) => [l.key, l.verdict])),
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [, startSaving] = useTransition();

  const judge = (key: string, chosen: Exclude<Answer, "">) => {
    const previous = answers[key] ?? "";
    const next: Answer = previous === chosen ? "" : chosen; // pressing it again clears it
    setAnswers((a) => ({ ...a, [key]: next }));
    setSaveError(null);
    startSaving(async () => {
      const result = await saveVerdict({ riotId: match.riotId, matchId: match.matchId, key, verdict: next });
      if (!result.ok) {
        setAnswers((a) => ({ ...a, [key]: previous }));
        setSaveError(result.message);
      }
    });
  };

  const checked = match.findingLabels.filter((l) => answers[l.key]).length;
  const rulesHere = [...new Set(match.findings.map((f) => f.ruleId))].filter((id) => JUDGING_GUIDE[id]);

  const unlisted = match.deaths.filter((d) => !match.findings.some((f) => f.gameTimeMs === d.t));

  return (
    <div className="match">
      <div className="match-map">
        <MatchMap match={match} selected={selected} threshold={threshold} onSelect={toggle} />
        <MapLegend wards={selected !== null} />
        <DeathPanel death={selected} threshold={threshold} />
      </div>

      <div>
        <div className="findings-head">
          <h2 className="section-title">Findings</h2>
          {match.canJudge && match.findings.length > 0 && (
            <p className="muted small">
              {checked} of {match.findings.length} checked against the replay
            </p>
          )}
        </div>

        {match.canJudge && rulesHere.length > 0 && (
          <details className="guide">
            <summary>How to judge a finding</summary>
            <p>
              Open this game&rsquo;s replay in the League client and go to the time shown. Then:
            </p>
            <ul>
              {rulesHere.map((id) => (
                <li key={id}>{JUDGING_GUIDE[id]}</li>
              ))}
            </ul>
            <p>Your answers are saved to labels.json and counted on the player page.</p>
          </details>
        )}

        {match.labelsError && (
          <p className="status status--error" role="alert">
            {match.labelsError}
          </p>
        )}
        {saveError && (
          <p className="status status--error" role="alert">
            {saveError}
          </p>
        )}

        {match.findings.length === 0 ? (
          <p className="muted">Nothing flagged in this game.</p>
        ) : (
          <ul className="findings">
            {match.findings.map((f, i) => {
              const linked = deathTimes.has(f.gameTimeMs);
              const key = match.findingLabels[i].key;
              const answer = answers[key] ?? "";
              const body = (
                <>
                  <span className="finding-time">{formatClock(f.gameTimeMs)}</span>
                  <span>
                    <span className="finding-title">{f.title}</span>
                    {f.severity === 3 && <span className="finding-sev">severe</span>}
                    <span className="finding-detail" style={{ display: "block" }}>
                      {f.detail}
                    </span>
                  </span>
                </>
              );
              return (
                <li key={`${f.ruleId}-${f.gameTimeMs}-${i}`}>
                  {linked ? (
                    <button
                      type="button"
                      className="finding"
                      aria-pressed={selectedT === f.gameTimeMs}
                      onClick={() => toggle(f.gameTimeMs)}
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="finding">{body}</div>
                  )}
                  {match.canJudge && (
                    <div
                      className="verdict"
                      role="group"
                      aria-label={`Was "${f.title}" at ${formatClock(f.gameTimeMs)} right?`}
                    >
                      <span className="verdict-question" aria-hidden="true">
                        Was this right?
                      </span>
                      {ANSWERS.map((a) => (
                        <button
                          key={a.value}
                          type="button"
                          className="verdict-button"
                          aria-pressed={answer === a.value}
                          disabled={match.labelsError !== null}
                          onClick={() => judge(key, a.value)}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {unlisted.length > 0 && (
          <p className="muted small" style={{ marginTop: 14 }}>
            {plural(unlisted.length, "other death")} {unlisted.length === 1 ? "isn't" : "aren't"} listed
            because nothing was flagged: {unlisted.filter((d) => d.verdict === "covered").length} with
            a ward close by, {unlisted.filter((d) => d.verdict === "abstained").length} too uncertain
            to judge. Pick them on the map.
          </p>
        )}
      </div>
    </div>
  );
}

interface MatchMapProps {
  match: MatchView;
  selected: DeathView | null;
  threshold: number;
  onSelect: (t: number) => void;
}

function MatchMap({ match, selected, threshold, onSelect }: MatchMapProps) {
  // useId can contain characters (":", "«") that break url(#...) references.
  const maskId = `fog-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const confident = selected?.wards.filter((w) => w.confident) ?? [];
  const unsure = selected?.wards.filter((w) => !w.confident) ?? [];

  const onKey = (t: number) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(t);
    }
  };

  return (
    <RiftMap
      label={
        selected
          ? `Map at ${formatClock(selected.t)}: your death and the ${plural(selected.wards.length, "friendly ward")} up at the time`
          : `Map of your ${plural(match.deaths.length, "death")} this game`
      }
    >
      {selected && (
        <>
          <defs>
            {/* Fog everywhere except what confidently-placed wards could see. */}
            <mask id={maskId} maskUnits="userSpaceOnUse" x={0} y={0} width={RIFT_UNITS} height={RIFT_UNITS}>
              <rect x={0} y={0} width={RIFT_UNITS} height={RIFT_UNITS} fill="white" />
              {confident.map((w, i) => (
                <circle key={i} cx={w.x} cy={w.y} r={WARD_SIGHT_UNITS} fill="black" />
              ))}
            </mask>
          </defs>
          <rect x={0} y={0} width={RIFT_UNITS} height={RIFT_UNITS} className="fog" mask={`url(#${maskId})`} />
          {confident.map((w, i) => (
            <g key={`c${i}`}>
              <circle cx={w.x} cy={w.y} r={WARD_SIGHT_UNITS} className="ward-sight" vectorEffect="non-scaling-stroke" />
              <circle cx={w.x} cy={w.y} r={w.uncertainty} className="ward-error" vectorEffect="non-scaling-stroke" />
              <circle cx={w.x} cy={w.y} r={170} className="ward-dot" vectorEffect="non-scaling-stroke" />
            </g>
          ))}
          {unsure.map((w, i) => (
            <circle key={`u${i}`} cx={w.x} cy={w.y} r={170} className="ward-dot ward-dot--unsure" vectorEffect="non-scaling-stroke" />
          ))}
          <circle cx={selected.x} cy={selected.y} r={threshold} className="threshold-ring" vectorEffect="non-scaling-stroke" />
        </>
      )}

      {match.deaths.map((d) => (
        <g
          key={d.t}
          role="button"
          tabIndex={0}
          aria-pressed={selected?.t === d.t}
          aria-label={`Death at ${formatClock(d.t)}, ${verdictWords(d)}`}
          onClick={() => onSelect(d.t)}
          onKeyDown={onKey(d.t)}
        >
          <DeathMarker
            x={d.x}
            y={d.y}
            verdict={d.verdict}
            size={260}
            selected={selected?.t === d.t}
            dimmed={selected !== null && selected.t !== d.t}
          />
        </g>
      ))}
    </RiftMap>
  );
}

function verdictWords(d: DeathView): string {
  if (d.verdict === "flagged") return "no friendly ward nearby";
  if (d.verdict === "covered") return "a ward was close";
  return "too uncertain to judge";
}

function DeathPanel({ death, threshold }: { death: DeathView | null; threshold: number }) {
  if (!death) {
    return (
      <div className="death-panel">
        <p>Pick a death on the map or in the list to see which friendly wards were up at that moment.</p>
      </div>
    );
  }

  const unsure = death.wards.filter((w) => !w.confident).length;
  const near = death.nearest === null ? null : Math.round(death.nearest).toLocaleString("en-US");
  const limit = threshold.toLocaleString("en-US");

  let verdict: string;
  if (death.verdict === "abstained") {
    verdict = `Not judged. ${unsure} of the ${plural(death.wards.length, "friendly ward")} up at the time couldn't be placed on the map confidently, so there's no honest answer here.`;
  } else if (death.wards.length === 0) {
    verdict = "No friendly wards were up anywhere on the map.";
  } else if (death.verdict === "covered") {
    verdict = `A friendly ward was about ${near} units away, within the ${limit} the rule counts as close.`;
  } else {
    verdict = `The nearest friendly ward was about ${near} units away. The rule counts a ward as close within ${limit}.`;
  }

  return (
    <div className="death-panel" aria-live="polite">
      <h3>Died at {formatClock(death.t)}</h3>
      <p>
        Killed by {death.killedBy}
        {death.assists.length > 0 && <>, with help from {death.assists.join(" and ")}</>}.
      </p>
      <p>{verdict}</p>
    </div>
  );
}
