import Link from "next/link";
import { listCachedAccounts } from "@/lib/cache/accountCache";
import { loadPlayerReport } from "@/lib/report/playerReport";
import { riotIdToSlug } from "@/lib/report/riotId";
import { DeathMarker, RiftMap } from "@/components/RiftMap";
import { OpenPlayerForm } from "@/components/OpenPlayerForm";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const saved = await listCachedAccounts();
  // The first saved player doubles as a demo that works without an API key.
  const demo = saved[0] ? await loadPlayerReport(saved[0].riotId) : null;
  const demoDeaths = demo?.games.flatMap((g) => g.deaths) ?? [];

  return (
    <div className="home">
      <section className="home-intro">
        <h1 className="title">Where did that game go wrong?</h1>
        <p className="lede">
          Hindsight reads the timeline of your recent ranked games and marks every death on the
          map, with whether your team had a ward nearby, how much unspent gold you were carrying,
          and how far behind your lane opponent you were.
        </p>

        <OpenPlayerForm />

        {saved.length > 0 && (
          <>
            <ul className="saved-players">
              {saved.map((a) => (
                <li key={a.riotId}>
                  <Link href={`/player/${riotIdToSlug(a.riotId)}`}>{a.riotId}</Link>{" "}
                  <span className="muted small">
                    {a.matchIds.length} saved matches, opens without an API key
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {demo && demoDeaths.length > 0 && (
        <figure className="home-map" style={{ margin: 0 }}>
          <RiftMap label={`Map of ${demoDeaths.length} deaths from ${demo.riotId}'s last ${demo.games.length} games`}>
            {demoDeaths.map((d, i) => (
              <DeathMarker key={i} x={d.x} y={d.y} verdict={d.verdict} compact />
            ))}
          </RiftMap>
          <figcaption>
            {demoDeaths.length} deaths from {demo.riotId}&rsquo;s last {demo.games.length} games.
            Solid marks are deaths with no friendly ward nearby.
          </figcaption>
        </figure>
      )}
    </div>
  );
}
