import Link from "next/link";
import { notFound } from "next/navigation";
import { loadMatchView } from "@/lib/report/playerReport";
import { riotIdToSlug, slugToRiotId } from "@/lib/report/riotId";
import { formatLength, formatPlayedAt, plural } from "@/lib/report/format";
import { VISION_DISTANCE_UNITS } from "@/lib/rules/rules/deathsWithoutVision";
import { MatchExplorer } from "@/components/MatchExplorer";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string; matchId: string }>;
type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { slug, matchId } = await params;
  const riotId = slugToRiotId(slug);
  return { title: riotId ? `${riotId}, ${matchId}: Hindsight` : "Hindsight" };
}

export default async function MatchPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { slug, matchId } = await params;
  const riotId = slugToRiotId(slug);
  if (!riotId) notFound();

  const match = await loadMatchView(riotId, matchId);
  if (!match) notFound();

  const t = Number((await searchParams).t);
  const initialT = match.deaths.some((d) => d.t === t) ? t : null;
  const outcome = match.result === "win" ? "Won" : match.result === "loss" ? "Lost" : "Finished";

  return (
    <>
      <div className="page-head">
        <Link href={`/player/${riotIdToSlug(match.riotId)}`} className="crumb">
          Back to {match.riotId}&rsquo;s games
        </Link>
        <h1 className="title">
          {match.champion}, {match.side} side
        </h1>
        <p className="subtitle">
          {outcome} in {formatLength(match.durationMs)} on {formatPlayedAt(match.playedAt)}.{" "}
          {plural(match.deaths.length, "death")}, {plural(match.findings.length, "finding")}.
        </p>
      </div>

      <MatchExplorer match={match} initialT={initialT} threshold={VISION_DISTANCE_UNITS} />
    </>
  );
}
