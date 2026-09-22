import Link from "next/link";
import { notFound } from "next/navigation";
import { loadPlayerReport, type GameSummary, type PlayerReport } from "@/lib/report/playerReport";
import { riotIdToSlug, slugToRiotId } from "@/lib/report/riotId";
import { formatClock, formatLength, formatPlayedAt, plural } from "@/lib/report/format";
import { UNSPENT_GOLD_THRESHOLD } from "@/lib/rules/rules/diedWithUnspentGold";
import { DeathMarker, RiftMap } from "@/components/RiftMap";
import { MapLegend } from "@/components/MapLegend";
import { RefreshButton } from "@/components/RefreshButton";

export const dynamic = "force-dynamic";
// Loading a new player from Riot (the refresh action on this page) makes about
// 23 rate-limited requests; give it more than a host's short default limit.
export const maxDuration = 60;

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const riotId = slugToRiotId((await params).slug);
  return { title: riotId ? `${riotId}: Hindsight` : "Hindsight" };
}

export default async function PlayerPage({ params }: { params: Params }) {
  const riotId = slugToRiotId((await params).slug);
  if (!riotId) notFound();

  const report = await loadPlayerReport(riotId);
  if (!report) return <NotLoaded riotId={riotId} />;

  const slug = riotIdToSlug(report.riotId);
  const wins = report.games.filter((g) => g.result === "win").length;
  const losses = report.games.filter((g) => g.result === "loss").length;

  return (
    <>
      <div className="page-head">
        <h1 className="title">{report.riotId}</h1>
        <p className="subtitle">
          Last {plural(report.games.length, "ranked game")}: {wins} won, {losses} lost.
          {report.remakesSkipped > 0 && ` ${plural(report.remakesSkipped, "remake")} left out.`}
        </p>
        {report.games.length < report.wanted && (
          <p className="muted small">
            Only {report.games.length} real games are saved. Check for new games to fetch up to{" "}
            {report.wanted}.
          </p>
        )}
        <div className="actions">
          <RefreshButton riotId={report.riotId} label="Check for new games" quiet />
        </div>
      </div>

      <section className="overview" aria-labelledby="overview-title">
        <figure style={{ margin: 0 }}>
          <RiftMap label={`Map of every death in the last ${report.games.length} games`}>
            {report.games.flatMap((g) =>
              g.deaths.map((d) => (
                <a key={`${g.matchId}-${d.t}`} href={`/player/${slug}/match/${g.matchId}?t=${d.t}`}>
                  <title>{`${g.champion}, ${formatPlayedAt(g.playedAt)}, died at ${formatClock(d.t)}`}</title>
                  <DeathMarker x={d.x} y={d.y} verdict={d.verdict} compact />
                </a>
              )),
            )}
          </RiftMap>
          <MapLegend compact />
        </figure>

        <div>
          <h2 id="overview-title" className="headline">
            <VisionHeadline vision={report.vision} />
          </h2>
          <VisionDetail vision={report.vision} />
          <Rates games={report.games} />
          <TrustNote report={report} />
        </div>
      </section>

      <section aria-labelledby="games-title">
        <h2 id="games-title" className="section-title">
          Games
        </h2>
        <GamesTable
          games={report.games}
          slug={slug}
          judged={report.canJudge ? report.handCheck.judgedByMatch : null}
        />
      </section>
    </>
  );
}

function VisionHeadline({ vision }: { vision: PlayerReport["vision"] }) {
  if (vision.deaths === 0) return <>No deaths in these games.</>;
  return (
    <>
      In {vision.flagged} of your {vision.deaths} deaths, no friendly ward was near you.
    </>
  );
}

function VisionDetail({ vision }: { vision: PlayerReport["vision"] }) {
  if (vision.deaths === 0) return null;
  return (
    <p>
      In {vision.covered} you had a ward close by. The other {vision.abstained} aren&rsquo;t counted
      either way: for those moments the ward positions were too uncertain to judge, and a guess
      isn&rsquo;t worth showing you.
    </p>
  );
}

const RATE_LABELS: Record<string, string> = {
  "deaths-without-vision": "deaths with no friendly ward nearby",
  "died-with-unspent-gold": `deaths carrying ${UNSPENT_GOLD_THRESHOLD.toLocaleString("en-US")}+ unspent gold`,
  "lane-differential": "big gold or XP deficits to your lane opponent at 10 and 15 minutes",
};

function Rates({ games }: { games: GameSummary[] }) {
  if (games.length === 0) return null;
  const counts = new Map<string, number>(Object.keys(RATE_LABELS).map((id) => [id, 0]));
  for (const g of games) for (const f of g.findings) counts.set(f.ruleId, (counts.get(f.ruleId) ?? 0) + 1);
  const rows = [...counts].sort((a, b) => b[1] - a[1]);

  return (
    <ul className="rates" aria-label="Per game, on average">
      {rows.map(([ruleId, n]) => (
        <li key={ruleId}>
          <span className="rate-value">{(n / games.length).toFixed(1)}</span>
          <span>{RATE_LABELS[ruleId] ?? ruleId} per game</span>
        </li>
      ))}
    </ul>
  );
}

function TrustNote({ report }: { report: PlayerReport }) {
  const { tp, fp } = report.handCheck;
  const judged = tp + fp;
  return (
    <div className="trust">
      {judged === 0 ? (
        <p>
          None of these findings have been checked against replays yet. Until they are, treat them
          as places to look, not verdicts.
          {report.canJudge &&
            " Open a game below, watch its replay, and mark each finding right or wrong."}
        </p>
      ) : (
        <p>
          Checked against replays: {tp} of {judged} findings were right (
          {Math.round((tp / judged) * 100)}%).
          {judged < 30 && " That's too few checks to be sure yet."}
        </p>
      )}
      <p>
        Ward positions are estimated from where the player who placed them was standing: Riot&rsquo;s
        data records who placed a ward and when, but never where.
      </p>
    </div>
  );
}

function count(g: GameSummary, ruleId: string) {
  return g.findings.filter((f) => f.ruleId === ruleId).length;
}

function Count({ n }: { n: number }) {
  return <span className={n === 0 ? "zero" : undefined}>{n}</span>;
}

function GamesTable({
  games,
  slug,
  judged,
}: {
  games: GameSummary[];
  slug: string;
  /** Answers per match, or null to leave the Checked column out. */
  judged: Record<string, number> | null;
}) {
  return (
    <div className="table-wrap">
      <table className="games">
        <thead>
          <tr>
            <th scope="col">Champion</th>
            <th scope="col">Played</th>
            <th scope="col">Result</th>
            <th scope="col" className="num">Length</th>
            <th scope="col" className="num">No-ward deaths</th>
            <th scope="col" className="num">Unspent-gold deaths</th>
            <th scope="col" className="num">Lane deficits</th>
            {judged && <th scope="col" className="num">Checked</th>}
          </tr>
        </thead>
        <tbody>
          {games.map((g) => (
            <tr key={g.matchId}>
              <td>
                <span className={`side-mark side-mark--${g.side}`} aria-hidden="true" />
                <Link href={`/player/${slug}/match/${g.matchId}`}>{g.champion}</Link>
                <span className="muted small"> {g.side} side</span>
              </td>
              <td>{formatPlayedAt(g.playedAt)}</td>
              <td className={g.result === "loss" ? "result--loss" : undefined}>
                {g.result === "win" ? "Won" : g.result === "loss" ? "Lost" : "Unknown"}
              </td>
              <td className="num">{formatLength(g.durationMs)}</td>
              <td className="num">
                <Count n={count(g, "deaths-without-vision")} />
              </td>
              <td className="num">
                <Count n={count(g, "died-with-unspent-gold")} />
              </td>
              <td className="num">
                <Count n={count(g, "lane-differential")} />
              </td>
              {judged && (
                <td className="num">
                  <span className={judged[g.matchId] ? undefined : "zero"}>
                    {judged[g.matchId] ?? 0} of {g.findings.length}
                  </span>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NotLoaded({ riotId }: { riotId: string }) {
  return (
    <div className="empty">
      <h1 className="title" style={{ marginBottom: 16 }}>
        {riotId}
      </h1>
      <h2 className="section-title">These games haven&rsquo;t been loaded yet</h2>
      <p>
        Hindsight needs to download this player&rsquo;s recent ranked games from Riot once. After
        that they&rsquo;re saved and open without an API key.
      </p>
      <RefreshButton riotId={riotId} label="Load games from Riot" />
    </div>
  );
}
