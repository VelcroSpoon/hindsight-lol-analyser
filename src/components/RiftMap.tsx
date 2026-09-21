import type { ReactNode } from "react";

/**
 * A schematic Summoner's Rift, drawn as SVG.
 *
 * Children are drawn in GAME coordinates (0–15000 on both axes, y pointing up,
 * blue base bottom-left) — the same units the timeline uses. The group they sit
 * in flips and scales them onto the drawing, so a ward's 900-unit sight radius
 * is simply r={900}. Anything with a stroke should set
 * vectorEffect="non-scaling-stroke" so line widths stay in screen pixels.
 *
 * No hooks: usable from server components and client components alike.
 */

/** Width/height of Summoner's Rift in game units (actual bounds are ~14870 x 14980). */
export const RIFT_UNITS = 15000;

/** A ward reveals roughly this far, in game units. */
export const WARD_SIGHT_UNITS = 900;

const VIEW = 1000;
const SCALE = VIEW / RIFT_UNITS;

interface RiftMapProps {
  /** Overlays, in game coordinates. */
  children?: ReactNode;
  /** Accessible description of what the map is showing. */
  label: string;
  className?: string;
}

export function RiftMap({ children, label, className }: RiftMapProps) {
  return (
    <svg
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      className={className ? `rift ${className}` : "rift"}
      role="img"
      aria-label={label}
    >
      <g transform={`translate(0 ${VIEW}) scale(${SCALE} ${-SCALE})`}>
        <RiftTerrain />
        {children}
      </g>
    </svg>
  );
}

/** The static map: land, bases, river, lanes, and the two big objective pits. */
function RiftTerrain() {
  return (
    <g aria-hidden="true">
      <rect x={0} y={0} width={RIFT_UNITS} height={RIFT_UNITS} className="rift-land" />

      {/* Bases: blue bottom-left, red top-right. */}
      <path d="M0 0 H4300 A4300 4300 0 0 1 0 4300 Z" className="rift-base rift-base--blue" />
      <path
        d="M15000 15000 H10700 A4300 4300 0 0 1 15000 10700 Z"
        className="rift-base rift-base--red"
      />

      {/* River: top-left to bottom-right, through both pits. */}
      <path
        d="M2400 12400 C4200 11000 5700 9400 7500 7500 C9300 5600 10800 4000 12600 2600"
        className="rift-river"
      />
      <circle cx={5000} cy={10450} r={760} className="rift-pit" />
      <circle cx={9850} cy={4400} r={760} className="rift-pit" />

      {/* Lanes. */}
      <path d="M1150 4100 V13100 Q1150 13850 1900 13850 H10900" className="rift-lane" />
      <path d="M4100 1150 H13100 Q13850 1150 13850 1900 V10900" className="rift-lane" />
      <path d="M3200 3200 L11800 11800" className="rift-lane" />
    </g>
  );
}

export type MarkerVerdict = "flagged" | "covered" | "abstained";

interface DeathMarkerProps {
  x: number;
  y: number;
  verdict: MarkerVerdict;
  /** Radius in game units. */
  size?: number;
  dimmed?: boolean;
  selected?: boolean;
  /**
   * For maps with many small markers: drop the inner glyphs (they blur at ~9px)
   * and let size carry importance — flagged largest, abstained smallest.
   */
  compact?: boolean;
}

/** Radius per verdict on compact (overview) maps, game units. */
const COMPACT_SIZE: Record<MarkerVerdict, number> = { flagged: 215, covered: 150, abstained: 120 };

/**
 * A death on the map. The verdict is carried by SHAPE, not only color:
 *   flagged   — solid disc, with a cross when large (no friendly ward nearby)
 *   covered   — open ring, with a dot when large (a ward was close)
 *   abstained — dashed ring (too uncertain to judge)
 */
export function DeathMarker({ x, y, verdict, size: sizeProp, dimmed, selected, compact }: DeathMarkerProps) {
  const size = sizeProp ?? (compact ? COMPACT_SIZE[verdict] : 230);
  const cls = [
    "death",
    `death--${verdict}`,
    compact ? "death--compact" : "",
    dimmed ? "death--dimmed" : "",
    selected ? "death--selected" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const arm = size * 0.5;

  return (
    <g className={cls} transform={`translate(${x} ${y})`}>
      {selected && <circle r={size * 1.9} className="death-halo" vectorEffect="non-scaling-stroke" />}
      <circle r={size} className="death-body" vectorEffect="non-scaling-stroke" />
      {!compact && verdict === "flagged" && (
        <path
          d={`M${-arm} ${-arm} L${arm} ${arm} M${-arm} ${arm} L${arm} ${-arm}`}
          className="death-cross"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {!compact && verdict === "covered" && <circle r={size * 0.28} className="death-dot" />}
    </g>
  );
}
