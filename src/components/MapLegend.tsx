import { DeathMarker, type MarkerVerdict } from "./RiftMap";

function Swatch({ verdict, compact }: { verdict: MarkerVerdict; compact?: boolean }) {
  return (
    <svg viewBox="-300 -300 600 600" aria-hidden="true">
      <DeathMarker x={0} y={0} verdict={verdict} size={230} compact={compact} />
    </svg>
  );
}

function WardSwatch({ unsure }: { unsure?: boolean }) {
  return (
    <svg viewBox="-10 -10 20 20" aria-hidden="true">
      {!unsure && <circle r={8.5} className="ward-error" />}
      <circle r={4} className={unsure ? "ward-dot ward-dot--unsure" : "ward-dot"} />
    </svg>
  );
}

/** `compact` matches maps drawn with compact markers (the overview maps). */
export function MapLegend({ wards, compact }: { wards?: boolean; compact?: boolean }) {
  return (
    <ul className="legend">
      <li>
        <Swatch verdict="flagged" compact={compact} /> No friendly ward nearby
      </li>
      <li>
        <Swatch verdict="covered" compact={compact} /> A ward was close
      </li>
      <li>
        <Swatch verdict="abstained" compact={compact} /> Too uncertain to judge
      </li>
      {wards && (
        <>
          <li>
            <WardSwatch /> Estimated ward, dashed ring = usual error
          </li>
          <li>
            <WardSwatch unsure /> Ward we couldn&rsquo;t place
          </li>
        </>
      )}
    </ul>
  );
}
